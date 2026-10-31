import { and, desc, eq, lte, gte, like, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { sales, contacts, leads, units } from "@/db/schema";
import { normalizeBrPhone, phoneTail8 } from "@/lib/phone";
import { hashCpf } from "@/lib/crypto";
import { addEvent, audit, runTrigger, CrmError } from "./crm";

export const SaleInputSchema = z.object({
  source: z.enum(["adm", "pdv"]),
  externalId: z.string().min(1).max(120),
  customerExternalId: z.string().max(120).optional().nullable(),
  customerName: z.string().max(200).optional().nullable(),
  cpf: z.string().max(20).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  amount: z.coerce.number().nonnegative(),
  soldAt: z.coerce.date(),
  unitSlug: z.string().max(60).optional().nullable(),
  sellerName: z.string().max(200).optional().nullable(),
  products: z.array(z.object({ name: z.string(), qty: z.coerce.number().optional(), amount: z.coerce.number().optional() })).optional().nullable(),
  isTest: z.boolean().optional(),
});
export type SaleInput = z.infer<typeof SaleInputSchema>;

const WINDOW_DAYS = 365;

/** Registra a venda (idempotente por origem+ID) e tenta vincular ao lead. Nunca cria venda duplicada. */
export async function ingestSale(db: DB, raw: unknown) {
  const s = SaleInputSchema.parse(raw);
  const [unit] = s.unitSlug ? await db.select().from(units).where(eq(units.slug, s.unitSlug)).limit(1) : [];
  const phone = normalizeBrPhone(s.phone);
  const inserted = await db.insert(sales).values({
    source: s.source, externalId: s.externalId, customerExternalId: s.customerExternalId, customerName: s.customerName,
    cpfHash: hashCpf(s.cpf), phone, amount: s.amount.toFixed(2), soldAt: s.soldAt, unitId: unit?.id ?? null,
    sellerName: s.sellerName, products: s.products ?? null, isTest: s.isTest ?? false,
  }).onConflictDoNothing({ target: [sales.source, sales.externalId] }).returning();
  if (!inserted.length) {
    const [existing] = await db.select().from(sales).where(and(eq(sales.source, s.source), eq(sales.externalId, s.externalId))).limit(1);
    return { sale: existing, duplicate: true };
  }
  const sale = inserted[0];
  const match = await findMatch(db, sale);
  if (match.status === "matched") {
    await linkSale(db, sale.id, match.leadId!, match.rule, match.evidence, null);
  } else {
    await db.update(sales).set({ matchStatus: match.status, matchRule: match.rule, matchEvidence: match.evidence, leadId: match.leadId ?? null }).where(eq(sales.id, sale.id));
  }
  const [final] = await db.select().from(sales).where(eq(sales.id, sale.id));
  return { sale: final, duplicate: false };
}

type Match = { status: "matched" | "pending_review" | "unmatched"; leadId?: string; rule: string; evidence: Record<string, unknown> };

export async function findMatch(db: DB, sale: typeof sales.$inferSelect): Promise<Match> {
  const since = new Date(sale.soldAt.getTime() - WINDOW_DAYS * 86400_000);
  if (sale.phone) {
    const [c] = await db.select().from(contacts).where(eq(contacts.phone, sale.phone)).limit(1);
    if (c) {
      const cands = await db.select().from(leads)
        .where(and(eq(leads.contactId, c.id), lte(leads.createdAt, sale.soldAt), gte(leads.createdAt, since)))
        .orderBy(desc(leads.createdAt));
      const sameUnit = sale.unitId ? cands.filter((l) => l.unitId === sale.unitId) : [];
      const chosen = sameUnit[0] ?? (cands.length === 1 ? cands[0] : null);
      if (chosen) return { status: "matched", leadId: chosen.id, rule: sameUnit.length ? "telefone_exato_mesma_unidade" : "telefone_exato", evidence: { phone: sale.phone, candidates: cands.length } };
      if (cands.length > 1) return { status: "pending_review", leadId: cands[0].id, rule: "telefone_exato_varias_unidades", evidence: { candidates: cands.map((l) => l.id) } };
    }
  }
  const tail = phoneTail8(sale.phone);
  if (tail) {
    const partial = await db.select().from(contacts).where(like(contacts.phone, `%${tail}`)).limit(5);
    if (partial.length) {
      const [l] = await db.select().from(leads).where(and(eq(leads.contactId, partial[0].id), lte(leads.createdAt, sale.soldAt))).orderBy(desc(leads.createdAt)).limit(1);
      if (l) return { status: "pending_review", leadId: l.id, rule: "telefone_parcial_8_digitos", evidence: { tail, contacts: partial.length } };
    }
  }
  return { status: "unmatched", rule: "sem_correspondencia", evidence: { phone: sale.phone ?? null } };
}

export async function linkSale(db: DB, saleId: string, leadId: string, rule: string, evidence: unknown, byUserId: string | null) {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  if (!sale) throw new CrmError("Venda não encontrada");
  if (sale.matchStatus === "matched") throw new CrmError("Venda já vinculada");
  await db.update(sales).set({ leadId, matchStatus: "matched", matchRule: rule, matchEvidence: evidence ?? null, reviewedBy: byUserId, reviewedAt: byUserId ? new Date() : null }).where(eq(sales.id, saleId));
  await db.update(leads).set({ wonAmount: sql`${leads.wonAmount} + ${sale.amount}` }).where(eq(leads.id, leadId));
  await addEvent(db, leadId, "sale", `Venda ${sale.source.toUpperCase()} #${sale.externalId}: R$ ${Number(sale.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, { saleId, rule }, byUserId);
  await audit(db, byUserId, "sale.link", "sale", saleId, { leadId, rule });
  await runTrigger(db, "sale_matched", leadId);
}

export async function rejectSaleMatch(db: DB, saleId: string, byUserId: string) {
  await db.update(sales).set({ matchStatus: "rejected", leadId: null, reviewedBy: byUserId, reviewedAt: new Date() }).where(eq(sales.id, saleId));
  await audit(db, byUserId, "sale.reject_match", "sale", saleId);
}
