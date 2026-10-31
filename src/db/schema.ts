import {
  pgTable, text, timestamp, boolean, integer, numeric, jsonb, uniqueIndex, index, date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ============ ESTRUTURA MULTIUNIDADE / ACESSO ============ */

export const units = pgTable("units", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** Papéis: diretoria (tudo), admin (tudo + configuração), gestor (sua unidade), vendedor (seus leads na sua unidade) */
export const users = pgTable("users", {
  id: id(),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["diretoria", "admin", "gestor", "vendedor"] }).notNull(),
  unitId: text("unit_id").references(() => units.id),
  active: boolean("active").notNull().default(true),
  /** disponível para receber leads no rodízio */
  available: boolean("available").notNull().default(true),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Roteamento de entrada → unidade (ex.: phone_number_id do WhatsApp da loja, page_id, form_id) */
export const unitRoutes = pgTable("unit_routes", {
  id: id(),
  sourceType: text("source_type", { enum: ["wa_phone_number_id", "page_id", "form_id"] }).notNull(),
  value: text("value").notNull(),
  unitId: text("unit_id").notNull().references(() => units.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("unit_routes_src").on(t.sourceType, t.value)]);

/* ============ CATÁLOGO META (espelho da Marketing API) ============ */

export const metaCampaigns = pgTable("meta_campaigns", {
  id: text("id").primaryKey(), // ID oficial da Meta
  adAccountId: text("ad_account_id"),
  name: text("name"),
  status: text("status"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});
export const metaAdsets = pgTable("meta_adsets", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id"),
  name: text("name"),
  status: text("status"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});
export const metaAds = pgTable("meta_ads", {
  id: text("id").primaryKey(),
  adsetId: text("adset_id"),
  campaignId: text("campaign_id"),
  creativeId: text("creative_id"),
  name: text("name"),
  status: text("status"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});
export const metaCreatives = pgTable("meta_creatives", {
  id: text("id").primaryKey(),
  name: text("name"),
  thumbnailUrl: text("thumbnail_url"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
});
/** Métricas diárias por anúncio (Insights API, level=ad) */
export const metaAdInsights = pgTable("meta_ad_insights", {
  adId: text("ad_id").notNull(),
  day: date("day").notNull(),
  spend: numeric("spend", { precision: 14, scale: 2 }).notNull().default("0"),
  impressions: integer("impressions").notNull().default(0),
  reach: integer("reach").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
}, (t) => [uniqueIndex("meta_ad_insights_pk").on(t.adId, t.day)]);

/* ============ CRM ============ */

export const contacts = pgTable("contacts", {
  id: id(),
  name: text("name"),
  /** E.164 normalizado, ex.: +5513999999999 */
  phone: text("phone").unique(),
  email: text("email"),
  /** base legal LGPD registrada na captação */
  legalBasis: text("legal_basis"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: createdAt(),
});

export const pipelineStages = pgTable("pipeline_stages", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  kind: text("kind", { enum: ["open", "won", "lost", "post"] }).notNull().default("open"),
  /** minutos máximos sem movimentação antes de alerta (null = sem SLA) */
  slaMinutes: integer("sla_minutes"),
});

export const leads = pgTable("leads", {
  id: id(),
  contactId: text("contact_id").notNull().references(() => contacts.id),
  unitId: text("unit_id").references(() => units.id),
  ownerId: text("owner_id").references(() => users.id),
  stageKey: text("stage_key").notNull(),
  status: text("status", { enum: ["open", "won", "lost"] }).notNull().default("open"),
  sourcePlatform: text("source_platform", {
    enum: ["whatsapp_ctwa", "whatsapp_organic", "lead_ads", "manual", "site", "unknown"],
  }).notNull(),
  attributionStatus: text("attribution_status", { enum: ["confirmed", "partial", "unknown"] }).notNull().default("unknown"),
  lostReason: text("lost_reason"),
  nextAction: text("next_action"),
  nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  wonAmount: numeric("won_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("leads_unit_idx").on(t.unitId), index("leads_owner_idx").on(t.ownerId), index("leads_contact_idx").on(t.contactId)]);

/**
 * Atribuição — várias linhas por lead, nunca sobrescritas.
 * kind: first_touch | last_touch | declared (informado pelo cliente/vendedor) | technical (evidência técnica pura)
 * confidence: confirmed (ID oficial da Meta presente) | partial | unknown
 * Isto é atribuição do CRM — NÃO é a atribuição oficial da Meta.
 */
export const leadAttributions = pgTable("lead_attributions", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id),
  kind: text("kind", { enum: ["first_touch", "last_touch", "declared", "technical"] }).notNull(),
  confidence: text("confidence", { enum: ["confirmed", "partial", "unknown"] }).notNull(),
  platform: text("platform"),
  adAccountId: text("ad_account_id"),
  campaignId: text("campaign_id"),
  adsetId: text("adset_id"),
  adId: text("ad_id"),
  creativeId: text("creative_id"),
  formId: text("form_id"),
  pageId: text("page_id"),
  sourceUrl: text("source_url"),
  ctwaClid: text("ctwa_clid"),
  fbclid: text("fbclid"),
  leadgenId: text("leadgen_id"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  headline: text("headline"),
  declaredSource: text("declared_source"),
  /** payload original preservado como evidência */
  evidence: jsonb("evidence"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("attr_lead_idx").on(t.leadId), index("attr_ad_idx").on(t.adId), index("attr_campaign_idx").on(t.campaignId)]);

export const leadStageHistory = pgTable("lead_stage_history", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  byUserId: text("by_user_id"),
  byRule: text("by_rule"),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("hist_lead_idx").on(t.leadId)]);

/** Linha do tempo: mensagens recebidas, notas, alertas, atribuições, tarefas */
export const leadEvents = pgTable("lead_events", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id),
  type: text("type", {
    enum: ["message_in", "message_out", "note", "alert", "assignment", "appointment", "sale", "system"],
  }).notNull(),
  body: text("body"),
  data: jsonb("data"),
  actorId: text("actor_id"),
  externalId: text("external_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("events_lead_idx").on(t.leadId), uniqueIndex("events_external_uq").on(t.externalId)]);

export const assignments = pgTable("assignments", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id),
  userId: text("user_id").notNull().references(() => users.id),
  previousUserId: text("previous_user_id"),
  rule: text("rule").notNull(),
  byUserId: text("by_user_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const appointments = pgTable("appointments", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id),
  unitId: text("unit_id").references(() => units.id),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["agendado", "confirmado", "compareceu", "nao_compareceu", "cancelado"] }).notNull().default("agendado"),
  createdBy: text("created_by"),
  createdAt: createdAt(),
});

/** Regras de distribuição por unidade (e opcionalmente por campanha) */
export const distributionRules = pgTable("distribution_rules", {
  id: id(),
  name: text("name").notNull(),
  unitId: text("unit_id").references(() => units.id),
  campaignId: text("campaign_id"),
  strategy: text("strategy", { enum: ["round_robin", "manual"] }).notNull().default("round_robin"),
  onlyAvailable: boolean("only_available").notNull().default(true),
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
  /** último vendedor que recebeu (cursor do rodízio) */
  cursorUserId: text("cursor_user_id"),
  createdAt: createdAt(),
});

/**
 * Regras de automação configuráveis (sem alterar código).
 * trigger: lead_created | appointment_created | appointment_attended | sale_matched | no_activity
 * params: parâmetros do gatilho (ex.: { stageKey, minutes })
 * action: move_stage | distribute | alert | reassign
 */
export const automationRules = pgTable("automation_rules", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  trigger: text("trigger").notNull(),
  params: jsonb("params").notNull().default({}),
  action: text("action").notNull(),
  actionParams: jsonb("action_params").notNull().default({}),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ============ INTEGRAÇÕES / EVENTOS ============ */

/** Caixa de entrada idempotente de webhooks + fila de processamento com retentativa */
export const webhookInbox = pgTable("webhook_inbox", {
  id: id(),
  source: text("source", { enum: ["whatsapp", "leadgen", "sales_adm", "sales_pdv"] }).notNull(),
  dedupeKey: text("dedupe_key").notNull().unique(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["pending", "processing", "done", "failed", "dead", "ignored"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (t) => [index("inbox_status_idx").on(t.status, t.nextAttemptAt)]);

/** Vendas recebidas do ADM / PDV, com correspondência ao lead */
export const sales = pgTable("sales", {
  id: id(),
  source: text("source", { enum: ["adm", "pdv"] }).notNull(),
  externalId: text("external_id").notNull(),
  customerExternalId: text("customer_external_id"),
  customerName: text("customer_name"),
  /** hash SHA-256 do CPF (nunca o CPF puro) */
  cpfHash: text("cpf_hash"),
  phone: text("phone"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
  unitId: text("unit_id").references(() => units.id),
  sellerName: text("seller_name"),
  products: jsonb("products"),
  leadId: text("lead_id").references(() => leads.id),
  matchStatus: text("match_status", { enum: ["matched", "pending_review", "unmatched", "rejected"] }).notNull().default("unmatched"),
  matchRule: text("match_rule"),
  matchEvidence: jsonb("match_evidence"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  isTest: boolean("is_test").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sales_source_ext").on(t.source, t.externalId), index("sales_phone_idx").on(t.phone)]);

/** Eventos preparados para a Conversions API (envio desligado por padrão) */
export const capiEvents = pgTable("capi_events", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id),
  /** event_id único → deduplicação na Meta */
  eventId: text("event_id").notNull().unique(),
  eventName: text("event_name").notNull(),
  crmStage: text("crm_stage").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["prepared", "blocked", "sent", "failed"] }).notNull().default("prepared"),
  blockedReason: text("blocked_reason"),
  response: jsonb("response"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  data: jsonb("data"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
