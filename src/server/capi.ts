import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { DB } from "@/db";
import { leads, leadAttributions, capiEvents } from "@/db/schema";
import { sha256 } from "@/lib/crypto";

/**
 * Mapeamento etapa do CRM → evento da Conversions API.
 *
 * IMPORTANTE: os nomes abaixo precisam ser conferidos na documentação oficial vigente ANTES de ligar o envio
 * (Conversions API para CRM — leads de formulário; Conversions API for Business Messaging — Click-to-WhatsApp).
 * `validated: false` impede o envio mesmo com META_CAPI_ENABLED=true.
 */
export const CAPI_MAPPING: Record<string, { leadAds?: string; ctwa?: string; validated: boolean }> = {
  novo_lead:              { leadAds: "Lead recebido",        ctwa: "LeadSubmitted", validated: false },
  em_atendimento:         { leadAds: "Lead contatado",        validated: false },
  qualificado:            { leadAds: "Lead qualificado",      ctwa: "QualifiedLead", validated: false },
  agendamento_realizado:  { leadAds: "Agendamento realizado", validated: false },
  proposta_apresentada:   { leadAds: "Oportunidade",          validated: false },
  venda_concluida:        { leadAds: "Venda concluída",       ctwa: "Purchase", validated: false },
};

/** Prepara (não envia) o evento para a etapa, se houver identificador da Meta. Idempotente por event_id. */
export async function prepareCapiEvent(db: DB, leadId: string, stageKey: string) {
  const map = CAPI_MAPPING[stageKey];
  if (!map) return null;
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;
  const [attr] = await db.select().from(leadAttributions)
    .where(and(eq(leadAttributions.leadId, leadId), eq(leadAttributions.kind, "first_touch")))
    .orderBy(desc(leadAttributions.capturedAt)).limit(1);
  const eventId = sha256(`${leadId}:${stageKey}`).slice(0, 32);
  const eventTime = Math.floor(Date.now() / 1000);
  let payload: Record<string, unknown> | null = null;
  let eventName = "";
  if (attr?.leadgenId && map.leadAds) {
    eventName = map.leadAds;
    payload = {
      event_name: eventName, event_time: eventTime, event_id: eventId, action_source: "system_generated",
      user_data: { lead_id: attr.leadgenId },
      custom_data: { event_source: "crm", lead_event_source: "Idealize CRM Intelligence" },
    };
  } else if (attr?.ctwaClid && map.ctwa) {
    eventName = map.ctwa;
    payload = {
      event_name: eventName, event_time: eventTime, event_id: eventId, action_source: "business_messaging", messaging_channel: "whatsapp",
      user_data: { ctwa_clid: attr.ctwaClid },
      ...(stageKey === "venda_concluida" ? { custom_data: { currency: "BRL", value: Number(lead.wonAmount) } } : {}),
    };
  }
  if (!payload) return null;
  const reason = !map.validated ? "Mapeamento ainda não validado na documentação oficial" : process.env.META_CAPI_ENABLED !== "true" ? "Envio desligado (META_CAPI_ENABLED)" : null;
  await db.insert(capiEvents).values({
    leadId, eventId, eventName, crmStage: stageKey, payload, status: reason ? "blocked" : "prepared", blockedReason: reason,
  }).onConflictDoNothing({ target: capiEvents.eventId });
  return { eventId, payload, blockedReason: reason };
}

/** Envio real — só roda com dataset, token, flag ligada e mapeamento validado. Nunca chamado automaticamente nesta fase. */
export async function sendPreparedCapiEvents(db: DB) {
  const { META_DATASET_ID, META_SYSTEM_USER_TOKEN, META_GRAPH_VERSION, META_CAPI_ENABLED } = process.env;
  if (META_CAPI_ENABLED !== "true" || !META_DATASET_ID || !META_SYSTEM_USER_TOKEN) return { sent: 0, skipped: "não configurado" };
  const pending = await db.select().from(capiEvents).where(and(eq(capiEvents.status, "prepared"), isNotNull(capiEvents.payload))).limit(100);
  let sent = 0;
  for (const ev of pending) {
    const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION ?? "v23.0"}/${META_DATASET_ID}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${META_SYSTEM_USER_TOKEN}` },
      body: JSON.stringify({ data: [ev.payload] }),
    });
    const json = await res.json().catch(() => ({}));
    await db.update(capiEvents).set({ status: res.ok ? "sent" : "failed", response: json, sentAt: res.ok ? new Date() : null }).where(eq(capiEvents.id, ev.id));
    if (res.ok) sent++;
  }
  return { sent };
}
