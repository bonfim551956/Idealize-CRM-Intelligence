import { and, eq, lte, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { webhookInbox, contacts, leads, leadAttributions, unitRoutes, metaAds } from "@/db/schema";
import { normalizeBrPhone } from "@/lib/phone";
import { addEvent, audit, runTrigger, latestLeadForContact } from "./crm";
import { resolveAd, fetchLeadgen, metaConfigured, type AdHierarchy } from "./meta";
import { ingestSale, type SaleInput } from "./sales";

/* ===================== FILA (caixa de entrada idempotente) ===================== */

export async function enqueue(db: DB, source: typeof webhookInbox.$inferInsert.source, dedupeKey: string, payload: unknown) {
  const rows = await db.insert(webhookInbox).values({ source, dedupeKey, payload: payload as object })
    .onConflictDoNothing({ target: webhookInbox.dedupeKey }).returning({ id: webhookInbox.id });
  return { inserted: rows.length > 0, id: rows[0]?.id };
}

const MAX_ATTEMPTS = 6;

/** Processa itens pendentes com retentativa exponencial; após MAX_ATTEMPTS vai para "dead" (registro de falha). */
export async function processInbox(db: DB, opts: { limit?: number; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const items = await db.select().from(webhookInbox)
    .where(and(inArray(webhookInbox.status, ["pending", "failed"]), lte(webhookInbox.nextAttemptAt, now)))
    .orderBy(webhookInbox.receivedAt).limit(opts.limit ?? 50);
  const result = { done: 0, failed: 0, ignored: 0 };
  for (const it of items) {
    // trava otimista: só processa se ainda estiver no status lido
    const locked = await db.update(webhookInbox).set({ status: "processing", attempts: it.attempts + 1 })
      .where(and(eq(webhookInbox.id, it.id), eq(webhookInbox.status, it.status))).returning({ id: webhookInbox.id });
    if (!locked.length) continue;
    try {
      const r = await handle(db, it.source, it.payload, opts.fetchImpl);
      await db.update(webhookInbox).set({ status: r === "ignored" ? "ignored" : "done", processedAt: new Date(), lastError: null }).where(eq(webhookInbox.id, it.id));
      r === "ignored" ? result.ignored++ : result.done++;
    } catch (e) {
      const attempts = it.attempts + 1;
      const delayMin = Math.min(2 ** attempts, 120);
      await db.update(webhookInbox).set({
        status: attempts >= MAX_ATTEMPTS ? "dead" : "failed", lastError: String((e as Error).message ?? e).slice(0, 2000),
        nextAttemptAt: new Date(now.getTime() + delayMin * 60_000),
      }).where(eq(webhookInbox.id, it.id));
      result.failed++;
    }
  }
  return result;
}

async function handle(db: DB, source: string, payload: unknown, fetchImpl?: typeof fetch): Promise<"ok" | "ignored"> {
  if (source === "whatsapp") return handleWhatsAppMessage(db, payload as WaInboxItem, fetchImpl);
  if (source === "leadgen") return handleLeadgen(db, payload as LeadgenInboxItem, fetchImpl);
  if (source === "sales_adm" || source === "sales_pdv") { await ingestSale(db, payload as SaleInput); return "ok"; }
  return "ignored";
}

/* ===================== WHATSAPP CLOUD API (Click-to-WhatsApp) ===================== */

type WaReferral = {
  source_url?: string; source_id?: string; source_type?: string; body?: string; headline?: string;
  media_type?: string; image_url?: string; video_url?: string; thumbnail_url?: string; ctwa_clid?: string;
};
type WaMessage = { from: string; id: string; timestamp: string; type: string; text?: { body: string }; referral?: WaReferral };
export type WaInboxItem = { phoneNumberId: string; displayPhone?: string; profileName?: string; message: WaMessage };

/** Quebra o webhook bruto (object=whatsapp_business_account) em uma mensagem por item da fila */
export function splitWhatsAppWebhook(body: unknown): { dedupeKey: string; item: WaInboxItem }[] {
  const out: { dedupeKey: string; item: WaInboxItem }[] = [];
  const b = body as { object?: string; entry?: { changes?: { field?: string; value?: any }[] }[] };
  if (b?.object !== "whatsapp_business_account") return out;
  for (const e of b.entry ?? []) for (const c of e.changes ?? []) {
    if (c.field !== "messages" || !c.value?.messages) continue; // status de entrega etc. não geram lead
    const v = c.value;
    for (const m of v.messages as WaMessage[]) {
      const contact = (v.contacts ?? []).find((x: any) => x.wa_id === m.from);
      out.push({
        dedupeKey: `wa:${m.id}`,
        item: { phoneNumberId: v.metadata?.phone_number_id, displayPhone: v.metadata?.display_phone_number, profileName: contact?.profile?.name, message: m },
      });
    }
  }
  return out;
}

async function unitFor(db: DB, sourceType: "wa_phone_number_id" | "page_id" | "form_id", value?: string | null) {
  if (!value) return null;
  const [r] = await db.select().from(unitRoutes).where(and(eq(unitRoutes.sourceType, sourceType), eq(unitRoutes.value, value))).limit(1);
  return r?.unitId ?? null;
}

async function upsertContact(db: DB, phone: string | null, name: string | null, isTest = false) {
  if (phone) {
    const [existing] = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
    if (existing) {
      if (!existing.name && name) await db.update(contacts).set({ name }).where(eq(contacts.id, existing.id));
      return existing;
    }
  }
  const [c] = await db.insert(contacts).values({ phone, name, isTest, legalBasis: "legitimo_interesse_contato_iniciado_pelo_titular", consentAt: new Date() }).returning();
  return c;
}

async function tryResolveAd(db: DB, adId: string, fetchImpl?: typeof fetch): Promise<AdHierarchy | null> {
  // 1) catálogo já sincronizado da Marketing API
  const [local] = await db.select().from(metaAds).where(eq(metaAds.id, adId)).limit(1);
  if (local?.campaignId) return { adId, adName: local.name ?? undefined, adsetId: local.adsetId ?? undefined, campaignId: local.campaignId, creativeId: local.creativeId ?? undefined };
  // 2) consulta direta (se houver token); sem token → atribuição parcial (só o ID do anúncio)
  if (!metaConfigured()) return null;
  return resolveAd(db, adId, fetchImpl); // erro aqui → retentativa da fila
}

async function handleWhatsAppMessage(db: DB, it: WaInboxItem, fetchImpl?: typeof fetch): Promise<"ok" | "ignored"> {
  const m = it.message;
  const phone = normalizeBrPhone(m.from);
  const unitId = await unitFor(db, "wa_phone_number_id", it.phoneNumberId);
  const contact = await upsertContact(db, phone ?? `wa:${m.from}`, it.profileName ?? null);
  const ref = m.referral;
  const isAd = ref?.source_type === "ad" && !!ref.source_id;

  let lead = await latestLeadForContact(db, contact.id, unitId);
  const reopen = !lead || lead.status !== "open";
  let created = false;

  let hierarchy: AdHierarchy | null = null;
  if (isAd) hierarchy = await tryResolveAd(db, ref!.source_id!, fetchImpl);

  if (reopen) {
    [lead] = await db.insert(leads).values({
      contactId: contact.id, unitId, stageKey: "novo_lead", sourcePlatform: isAd ? "whatsapp_ctwa" : "whatsapp_organic",
      attributionStatus: isAd ? (hierarchy?.campaignId ? "confirmed" : "partial") : "unknown",
    }).returning();
    created = true;
  }
  const L = lead!;

  if (isAd) {
    const attr = {
      leadId: L.id, confidence: (hierarchy?.campaignId ? "confirmed" : "partial") as "confirmed" | "partial", platform: "meta_ctwa",
      adId: ref!.source_id, adsetId: hierarchy?.adsetId, campaignId: hierarchy?.campaignId, creativeId: hierarchy?.creativeId,
      adAccountId: hierarchy?.accountId, sourceUrl: ref!.source_url, ctwaClid: ref!.ctwa_clid, headline: ref!.headline, evidence: { referral: ref, phoneNumberId: it.phoneNumberId },
    };
    const hasFirst = !created && (await db.select({ id: leadAttributions.id }).from(leadAttributions)
      .where(and(eq(leadAttributions.leadId, L.id), eq(leadAttributions.kind, "first_touch"))).limit(1)).length > 0;
    await db.insert(leadAttributions).values({ ...attr, kind: hasFirst ? "last_touch" : "first_touch" });
    if (!hasFirst && !created) await db.update(leads).set({ attributionStatus: attr.confidence }).where(eq(leads.id, L.id));
  } else if (created) {
    await db.insert(leadAttributions).values({ leadId: L.id, kind: "first_touch", confidence: "unknown", platform: "whatsapp", evidence: { reason: "mensagem sem referral de anúncio", phoneNumberId: it.phoneNumberId } });
  }

  await addEvent(db, L.id, "message_in", m.text?.body ?? `[${m.type}]`, { waMessageId: m.id, type: m.type, referral: ref ?? null }, null, `wa:${m.id}`);
  await db.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, L.id));
  if (created) {
    await audit(db, null, "lead.create", "lead", L.id, { source: "whatsapp", ad: ref?.source_id ?? null });
    await runTrigger(db, "lead_created", L.id, { campaignId: hierarchy?.campaignId });
  }
  return "ok";
}

/* ===================== LEAD ADS (formulário instantâneo) ===================== */

export type LeadgenInboxItem = { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string; adgroup_id?: string; created_time?: number };

export function splitLeadgenWebhook(body: unknown): { dedupeKey: string; item: LeadgenInboxItem }[] {
  const b = body as { object?: string; entry?: { changes?: { field?: string; value?: LeadgenInboxItem }[] }[] };
  if (b?.object !== "page") return [];
  return (b.entry ?? []).flatMap((e) => (e.changes ?? []).filter((c) => c.field === "leadgen" && c.value?.leadgen_id)
    .map((c) => ({ dedupeKey: `leadgen:${c.value!.leadgen_id}`, item: c.value! })));
}

function field(data: { name: string; values: string[] }[] | undefined, ...names: string[]) {
  const f = data?.find((x) => names.includes(x.name.toLowerCase()));
  return f?.values?.[0] ?? null;
}

async function handleLeadgen(db: DB, it: LeadgenInboxItem, fetchImpl?: typeof fetch): Promise<"ok" | "ignored"> {
  if (!metaConfigured()) throw new Error("Lead Ads: token da Meta não configurado — item mantido na fila para retentativa");
  const lg = await fetchLeadgen(it.leadgen_id, fetchImpl);
  const phone = normalizeBrPhone(field(lg.field_data, "phone_number", "telefone", "whatsapp"));
  const name = field(lg.field_data, "full_name", "nome", "nome_completo");
  const email = field(lg.field_data, "email");
  const unitId = (await unitFor(db, "form_id", lg.form_id ?? it.form_id)) ?? (await unitFor(db, "page_id", it.page_id));
  const contact = await upsertContact(db, phone, name);
  if (email && !contact.email) await db.update(contacts).set({ email }).where(eq(contacts.id, contact.id));
  const existing = await latestLeadForContact(db, contact.id, unitId);
  const hierarchy = lg.ad_id ? await resolveAd(db, lg.ad_id, fetchImpl).catch(() => null) : null;
  const confirmed = Boolean(lg.campaign_id ?? hierarchy?.campaignId);
  let lead = existing && existing.status === "open" ? existing : null;
  const created = !lead;
  if (!lead) {
    [lead] = await db.insert(leads).values({ contactId: contact.id, unitId, stageKey: "novo_lead", sourcePlatform: "lead_ads", attributionStatus: confirmed ? "confirmed" : "partial" }).returning();
  }
  await db.insert(leadAttributions).values({
    leadId: lead.id, kind: created ? "first_touch" : "last_touch", confidence: confirmed ? "confirmed" : "partial", platform: "meta_lead_ads",
    leadgenId: lg.id, formId: lg.form_id ?? it.form_id, pageId: it.page_id, adId: lg.ad_id ?? it.ad_id,
    adsetId: lg.adset_id ?? hierarchy?.adsetId, campaignId: lg.campaign_id ?? hierarchy?.campaignId, creativeId: hierarchy?.creativeId,
    evidence: { webhook: it, created_time: lg.created_time },
  });
  await addEvent(db, lead.id, "system", "Formulário de Lead Ads recebido", { leadgenId: lg.id, fields: lg.field_data?.map((f) => f.name) }, null, `leadgen:${lg.id}`);
  if (created) {
    await audit(db, null, "lead.create", "lead", lead.id, { source: "lead_ads", leadgen: lg.id });
    await runTrigger(db, "lead_created", lead.id, { campaignId: lg.campaign_id ?? hierarchy?.campaignId });
  }
  return "ok";
}

/* ===================== Status para a tela de Integrações ===================== */
export async function inboxStats(db: DB) {
  const rows = await db.select({ source: webhookInbox.source, status: webhookInbox.status, n: sql<number>`count(*)::int`, last: sql<string>`max(received_at)` })
    .from(webhookInbox).groupBy(webhookInbox.source, webhookInbox.status);
  return rows;
}

