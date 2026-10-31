import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { pipelineStages, automationRules, units, distributionRules } from "@/db/schema";

export const STAGES = [
  { key: "novo_lead", name: "Novo lead", kind: "open", slaMinutes: 2 },
  { key: "aguardando_atendimento", name: "Aguardando atendimento", kind: "open", slaMinutes: 5 },
  { key: "em_atendimento", name: "Em atendimento", kind: "open", slaMinutes: 24 * 60 },
  { key: "cliente_interessado", name: "Cliente interessado", kind: "open", slaMinutes: 24 * 60 },
  { key: "qualificado", name: "Qualificado", kind: "open", slaMinutes: 24 * 60 },
  { key: "agendamento_realizado", name: "Agendamento realizado", kind: "open", slaMinutes: null },
  { key: "agendamento_confirmado", name: "Agendamento confirmado", kind: "open", slaMinutes: null },
  { key: "compareceu", name: "Compareceu à unidade", kind: "open", slaMinutes: null },
  { key: "proposta_apresentada", name: "Proposta apresentada", kind: "open", slaMinutes: 3 * 24 * 60 },
  { key: "venda_concluida", name: "Venda concluída", kind: "won", slaMinutes: null },
  { key: "nao_convertido", name: "Não convertido", kind: "lost", slaMinutes: null },
  { key: "pos_venda", name: "Pós-venda", kind: "post", slaMinutes: null },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];
export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s, i) => [s.key, { ...s, position: i + 1 }])) as Record<
  StageKey, (typeof STAGES)[number] & { position: number }
>;

export const DEFAULT_RULES = [
  { key: "novo_lead_distribuir", name: "Novo lead → distribuir pela regra da unidade", trigger: "lead_created", params: {}, action: "distribute", actionParams: {} },
  { key: "sem_atendimento_alerta", name: "Sem atendimento → alerta", trigger: "no_activity", params: { stageKey: "novo_lead", minutes: 2 }, action: "alert", actionParams: {} },
  { key: "sem_atendimento_reatribuir", name: "Sem atendimento → reatribuir (desligada)", trigger: "no_activity", params: { stageKey: "novo_lead", minutes: 10 }, action: "reassign", actionParams: {}, active: false },
  { key: "agendamento_mover", name: "Agendamento criado → Agendamento realizado", trigger: "appointment_created", params: {}, action: "move_stage", actionParams: { stageKey: "agendamento_realizado" } },
  { key: "agendamento_confirmado_mover", name: "Agendamento confirmado → Agendamento confirmado", trigger: "appointment_confirmed", params: {}, action: "move_stage", actionParams: { stageKey: "agendamento_confirmado" } },
  { key: "compareceu_mover", name: "Comparecimento → Compareceu à unidade", trigger: "appointment_attended", params: {}, action: "move_stage", actionParams: { stageKey: "compareceu" } },
  { key: "venda_mover", name: "Venda vinculada (PDV/ADM) → Venda concluída", trigger: "sale_matched", params: {}, action: "move_stage", actionParams: { stageKey: "venda_concluida" } },
] as const;

export const INITIAL_UNITS = [
  { slug: "sao-vicente", name: "São Vicente" },
  { slug: "campinas", name: "Campinas" },
  { slug: "sorocaba", name: "Sorocaba" },
  { slug: "piracicaba", name: "Piracicaba" },
];

/** Idempotente: cria etapas, regras padrão, unidades iniciais e regra de rodízio por unidade. Não sobrescreve ajustes do admin. */
export async function bootstrap(db: DB) {
  for (const [i, s] of STAGES.entries()) {
    await db.insert(pipelineStages).values({ key: s.key, name: s.name, position: i + 1, kind: s.kind, slaMinutes: s.slaMinutes })
      .onConflictDoNothing({ target: pipelineStages.key });
  }
  for (const r of DEFAULT_RULES) {
    await db.insert(automationRules).values({ ...r, params: r.params, actionParams: r.actionParams, active: "active" in r ? r.active : true })
      .onConflictDoNothing({ target: automationRules.key });
  }
  for (const u of INITIAL_UNITS) {
    await db.insert(units).values(u).onConflictDoNothing({ target: units.slug });
  }
  const all = await db.select().from(units);
  for (const u of all) {
    const has = await db.select({ id: distributionRules.id }).from(distributionRules)
      .where(and(eq(distributionRules.unitId, u.id), isNull(distributionRules.campaignId))).limit(1);
    if (!has.length) {
      await db.insert(distributionRules).values({ name: `Rodízio ${u.name}`, unitId: u.id, strategy: "round_robin", onlyAvailable: true });
    }
  }
}
