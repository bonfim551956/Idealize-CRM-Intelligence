import { and, asc, eq, isNull, or, desc } from "drizzle-orm";
import type { DB } from "@/db";
import {
  leads, leadStageHistory, leadEvents, auditLog, users, distributionRules, assignments, automationRules, appointments,
} from "@/db/schema";
import { STAGE_BY_KEY, type StageKey } from "./bootstrap";
import { prepareCapiEvent } from "./capi";

export class CrmError extends Error {}

export async function audit(db: DB, actorId: string | null, action: string, entity: string, entityId: string | null, data?: unknown) {
  await db.insert(auditLog).values({ actorId, action, entity, entityId, data: data ?? null });
}

export async function addEvent(db: DB, leadId: string, type: typeof leadEvents.$inferInsert.type, body: string | null, data?: unknown, actorId?: string | null, externalId?: string | null) {
  await db.insert(leadEvents).values({ leadId, type, body, data: data ?? null, actorId: actorId ?? null, externalId: externalId ?? null });
}

/**
 * Move o lead de etapa com histórico. Regras:
 * - "nao_convertido" exige motivo
 * - "venda_concluida" só pelo vínculo de venda (rule) ou por diretoria/admin/gestor com motivo
 */
export async function moveStage(db: DB, leadId: string, toStage: StageKey, opts: { byUserId?: string; byRule?: string; reason?: string; actorRole?: string } = {}) {
  const stage = STAGE_BY_KEY[toStage];
  if (!stage) throw new CrmError("Etapa inválida");
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new CrmError("Lead não encontrado");
  if (lead.stageKey === toStage) return lead;
  if (stage.kind === "lost" && !opts.reason?.trim()) throw new CrmError("Informe o motivo da perda");
  if (stage.kind === "won" && !opts.byRule && !(opts.actorRole && opts.actorRole !== "vendedor" && opts.reason?.trim())) {
    throw new CrmError("Venda concluída entra pelo vínculo com o PDV/ADM. Marcação manual: só gestor/diretoria, com justificativa.");
  }
  const now = new Date();
  const status = stage.kind === "won" || stage.kind === "post" ? "won" : stage.kind === "lost" ? "lost" : "open";
  const [updated] = await db.update(leads).set({
    stageKey: toStage, status, stageEnteredAt: now, lastActivityAt: now,
    lostReason: stage.kind === "lost" ? opts.reason!.trim() : lead.lostReason,
  }).where(eq(leads.id, leadId)).returning();
  await db.insert(leadStageHistory).values({
    leadId, fromStage: lead.stageKey, toStage, byUserId: opts.byUserId ?? null, byRule: opts.byRule ?? null, reason: opts.reason ?? null,
  });
  await audit(db, opts.byUserId ?? null, "lead.stage", "lead", leadId, { from: lead.stageKey, to: toStage, rule: opts.byRule, reason: opts.reason });
  await prepareCapiEvent(db, leadId, toStage);
  return updated;
}

/** Registra primeira resposta/atividade humana (tempo de primeira resposta e SLA) */
export async function touchActivity(db: DB, leadId: string, userId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return;
  const now = new Date();
  await db.update(leads).set({ lastActivityAt: now, firstResponseAt: lead.firstResponseAt ?? now }).where(eq(leads.id, leadId));
  if (lead.stageKey === "novo_lead" || lead.stageKey === "aguardando_atendimento") {
    await moveStage(db, leadId, "em_atendimento", { byUserId: userId, byRule: "primeira_interacao" });
  }
}

/* ===================== DISTRIBUIÇÃO ===================== */

/** Escolhe o próximo vendedor pelo rodízio da regra aplicável. Retorna null se não houver ninguém elegível. */
export async function pickNextSeller(db: DB, unitId: string, campaignId?: string | null) {
  const rules = await db.select().from(distributionRules)
    .where(and(eq(distributionRules.active, true), eq(distributionRules.unitId, unitId),
      campaignId ? or(eq(distributionRules.campaignId, campaignId), isNull(distributionRules.campaignId)) : isNull(distributionRules.campaignId)))
    .orderBy(asc(distributionRules.priority));
  // regra específica da campanha primeiro
  const rule = rules.find((r) => campaignId && r.campaignId === campaignId) ?? rules.find((r) => !r.campaignId);
  if (!rule || rule.strategy === "manual") return { rule, seller: null };
  const conds = [eq(users.unitId, unitId), eq(users.role, "vendedor"), eq(users.active, true)];
  if (rule.onlyAvailable) conds.push(eq(users.available, true));
  const sellers = await db.select().from(users).where(and(...conds)).orderBy(asc(users.username));
  if (!sellers.length) return { rule, seller: null };
  const idx = rule.cursorUserId ? sellers.findIndex((s) => s.id === rule.cursorUserId) : -1;
  const seller = sellers[(idx + 1) % sellers.length];
  await db.update(distributionRules).set({ cursorUserId: seller.id }).where(eq(distributionRules.id, rule.id));
  return { rule, seller };
}

/**
 * Atribui lead a um vendedor. Evita dois vendedores no mesmo lead:
 * só troca de dono se `force` (gestor/diretoria/regra de reatribuição autorizada).
 */
export async function assignLead(db: DB, leadId: string, userId: string, rule: string, opts: { byUserId?: string; force?: boolean } = {}) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new CrmError("Lead não encontrado");
  if (lead.ownerId && lead.ownerId !== userId && !opts.force) throw new CrmError("Lead já possui responsável");
  const [seller] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!seller || !seller.active) throw new CrmError("Vendedor inválido");
  if (lead.unitId && seller.unitId !== lead.unitId) throw new CrmError("Vendedor de outra unidade");
  await db.update(leads).set({ ownerId: userId }).where(eq(leads.id, leadId));
  await db.insert(assignments).values({ leadId, userId, previousUserId: lead.ownerId, rule, byUserId: opts.byUserId ?? null });
  await addEvent(db, leadId, "assignment", `Responsável: ${seller.name}`, { rule, previous: lead.ownerId }, opts.byUserId);
  await audit(db, opts.byUserId ?? null, "lead.assign", "lead", leadId, { to: userId, from: lead.ownerId, rule });
}

export async function distributeLead(db: DB, leadId: string, campaignId?: string | null) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead || lead.ownerId || !lead.unitId) return null;
  const { seller, rule } = await pickNextSeller(db, lead.unitId, campaignId);
  if (!seller) {
    await addEvent(db, leadId, "alert", rule?.strategy === "manual" ? "Distribuição manual: aguardando gestor" : "Nenhum vendedor disponível na unidade — lead na fila");
    if (lead.stageKey === "novo_lead") await moveStage(db, leadId, "aguardando_atendimento", { byRule: "sem_vendedor_disponivel" });
    return null;
  }
  await assignLead(db, leadId, seller.id, `rodizio:${rule!.id}`);
  return seller;
}

/* ===================== AUTOMAÇÕES ===================== */

export async function runTrigger(db: DB, trigger: string, leadId: string, ctx: { campaignId?: string | null } = {}) {
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.trigger, trigger), eq(automationRules.active, true)));
  for (const r of rules) {
    const ap = (r.actionParams ?? {}) as { stageKey?: StageKey };
    if (r.action === "distribute") await distributeLead(db, leadId, ctx.campaignId);
    else if (r.action === "move_stage" && ap.stageKey) {
      const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
      // não regride lead que já está em etapa posterior
      if (lead && STAGE_BY_KEY[lead.stageKey as StageKey].position < STAGE_BY_KEY[ap.stageKey].position) {
        await moveStage(db, leadId, ap.stageKey, { byRule: r.key });
      }
    }
  }
}

/** Varredura periódica: leads parados além do limite configurado → alerta / reatribuição autorizada */
export async function runInactivitySweep(db: DB, now = new Date()) {
  const rules = await db.select().from(automationRules).where(and(eq(automationRules.trigger, "no_activity"), eq(automationRules.active, true)));
  let alerts = 0, reassigned = 0;
  for (const r of rules) {
    const p = r.params as { stageKey?: string; minutes?: number };
    if (!p.stageKey || !p.minutes) continue;
    const limit = new Date(now.getTime() - p.minutes * 60_000);
    const stuck = await db.select().from(leads).where(and(eq(leads.stageKey, p.stageKey), eq(leads.status, "open")));
    for (const l of stuck.filter((x) => x.lastActivityAt < limit)) {
      const marker = `${r.key}:${l.id}:${l.stageEnteredAt.toISOString()}`;
      const exists = await db.select({ id: leadEvents.id }).from(leadEvents).where(eq(leadEvents.externalId, marker)).limit(1);
      if (exists.length) continue;
      if (r.action === "alert") {
        await addEvent(db, l.id, "alert", `Sem movimentação há mais de ${p.minutes} min em "${STAGE_BY_KEY[p.stageKey as StageKey]?.name}"`, { rule: r.key }, null, marker);
        alerts++;
      } else if (r.action === "reassign" && l.unitId) {
        const { seller } = await pickNextSeller(db, l.unitId);
        if (seller && seller.id !== l.ownerId) {
          await assignLead(db, l.id, seller.id, `reatribuicao:${r.key}`, { force: true });
          await addEvent(db, l.id, "system", "Reatribuído por inatividade", { rule: r.key }, null, marker);
          reassigned++;
        }
      }
    }
  }
  return { alerts, reassigned };
}

export async function createAppointment(db: DB, leadId: string, scheduledAt: Date, byUserId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) throw new CrmError("Lead não encontrado");
  const [a] = await db.insert(appointments).values({ leadId, unitId: lead.unitId, scheduledAt, createdBy: byUserId }).returning();
  await addEvent(db, leadId, "appointment", `Agendado para ${scheduledAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, { appointmentId: a.id }, byUserId);
  await touchActivity(db, leadId, byUserId);
  await runTrigger(db, "appointment_created", leadId);
  return a;
}

export async function setAppointmentStatus(db: DB, appointmentId: string, status: "confirmado" | "compareceu" | "nao_compareceu" | "cancelado", byUserId: string) {
  const [a] = await db.update(appointments).set({ status }).where(eq(appointments.id, appointmentId)).returning();
  if (!a) throw new CrmError("Agendamento não encontrado");
  await addEvent(db, a.leadId, "appointment", `Agendamento: ${status.replace("_", " ")}`, { appointmentId }, byUserId);
  if (status === "confirmado") await runTrigger(db, "appointment_confirmed", a.leadId);
  if (status === "compareceu") await runTrigger(db, "appointment_attended", a.leadId);
  return a;
}

export async function latestLeadForContact(db: DB, contactId: string, unitId: string | null) {
  const rows = await db.select().from(leads)
    .where(unitId ? and(eq(leads.contactId, contactId), eq(leads.unitId, unitId)) : eq(leads.contactId, contactId))
    .orderBy(desc(leads.createdAt)).limit(1);
  return rows[0] ?? null;
}
