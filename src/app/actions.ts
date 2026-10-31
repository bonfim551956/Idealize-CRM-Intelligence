"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { leads, contacts, leadAttributions, automationRules, users, units, unitRoutes, appointments, sales, distributionRules } from "@/db/schema";
import { login, logout, hashPassword, SESSION_COOKIE } from "@/server/auth";
import { requireUser } from "@/server/session";
import { canSeeLead, canManage, isAdmin } from "@/server/scope";
import { moveStage, addEvent, touchActivity, createAppointment, setAppointmentStatus, assignLead, audit, runTrigger, runInactivitySweep, CrmError } from "@/server/crm";
import { linkSale, rejectSaleMatch } from "@/server/sales";
import { processInbox } from "@/server/ingest";
import { syncAccountStructure, syncInsights, metaConfigured } from "@/server/meta";
import { STAGE_BY_KEY, type StageKey } from "@/server/bootstrap";
import { normalizeBrPhone } from "@/lib/phone";
import { seedTestData, deleteTestData } from "@/server/testdata";
import { randomToken } from "@/lib/crypto";
import bcrypt from "bcryptjs";

export type ActionState = { ok?: string; error?: string } | null;

async function guard<T>(fn: () => Promise<T>, okMsg = "Salvo"): Promise<ActionState> {
  try { await fn(); revalidatePath("/", "layout"); return { ok: okMsg }; }
  catch (e) {
    if (e instanceof CrmError || e instanceof z.ZodError) return { error: e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : e.message };
    if ((e as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    console.error(e);
    return { error: "Erro inesperado — registrado no log do servidor" };
  }
}

async function leadFor(leadId: string) {
  const u = await requireUser();
  const [l] = await getDb().select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!l || !canSeeLead(u, l)) throw new CrmError("Lead não encontrado ou sem permissão");
  return { u, l };
}

/* ---------- autenticação ---------- */
export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await login(getDb(), String(fd.get("username") ?? ""), String(fd.get("password") ?? ""));
  if (!r) return { error: "Usuário ou senha inválidos" };
  (await cookies()).set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: r.maxAge });
  redirect("/");
}
export async function logoutAction() {
  const c = await cookies();
  await logout(getDb(), c.get(SESSION_COOKIE)?.value);
  c.delete(SESSION_COOKIE);
  redirect("/login");
}

/* ---------- lead ---------- */
export async function moveStageAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const { u, l } = await leadFor(String(fd.get("leadId")));
    const to = String(fd.get("stage")) as StageKey;
    if (!STAGE_BY_KEY[to]) throw new CrmError("Etapa inválida");
    await moveStage(getDb(), l.id, to, { byUserId: u.id, reason: String(fd.get("reason") ?? "") || undefined, actorRole: u.role });
    await getDb().update(leads).set({ firstResponseAt: l.firstResponseAt ?? new Date() }).where(eq(leads.id, l.id));
  }, "Etapa atualizada");
}

export async function addNoteAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const { u, l } = await leadFor(String(fd.get("leadId")));
    const body = z.string().trim().min(1, "Escreva a observação").max(4000).parse(fd.get("body"));
    await addEvent(getDb(), l.id, "note", body, null, u.id);
    await touchActivity(getDb(), l.id, u.id);
  }, "Observação registrada");
}

export async function nextActionAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const { u, l } = await leadFor(String(fd.get("leadId")));
    const text = z.string().trim().min(1, "Descreva a próxima ação").max(300).parse(fd.get("nextAction"));
    const at = fd.get("nextActionAt") ? new Date(String(fd.get("nextActionAt"))) : null;
    await getDb().update(leads).set({ nextAction: text, nextActionAt: at }).where(eq(leads.id, l.id));
    await addEvent(getDb(), l.id, "system", `Próxima ação: ${text}`, { at }, u.id);
  }, "Próxima ação definida");
}

export async function appointmentAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const { u, l } = await leadFor(String(fd.get("leadId")));
    const when = z.coerce.date({ message: "Data/hora inválida" }).parse(fd.get("scheduledAt"));
    await createAppointment(getDb(), l.id, when, u.id);
  }, "Agendamento registrado");
}

export async function appointmentStatusAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const [a] = await getDb().select().from(appointments).where(eq(appointments.id, String(fd.get("appointmentId")))).limit(1);
    if (!a) throw new CrmError("Agendamento não encontrado");
    const { u } = await leadFor(a.leadId);
    const st = z.enum(["confirmado", "compareceu", "nao_compareceu", "cancelado"]).parse(fd.get("status"));
    await setAppointmentStatus(getDb(), a.id, st, u.id);
  }, "Agendamento atualizado");
}

export async function reassignAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const { u, l } = await leadFor(String(fd.get("leadId")));
    if (!canManage(u)) throw new CrmError("Somente gestor/diretoria reatribui leads");
    await assignLead(getDb(), l.id, String(fd.get("userId")), "manual", { byUserId: u.id, force: true });
  }, "Responsável alterado");
}

const ManualLead = z.object({
  name: z.string().trim().min(2, "Nome obrigatório").max(200),
  phone: z.string().trim().min(8, "Telefone obrigatório"),
  unitId: z.string().min(1, "Selecione a unidade"),
  declaredSource: z.string().trim().max(200).optional(),
});

export async function createLeadAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    const d = ManualLead.parse(Object.fromEntries(fd));
    if (!isAdmin(u) && d.unitId !== u.unitId) throw new CrmError("Você só pode cadastrar leads da sua unidade");
    const phone = normalizeBrPhone(d.phone);
    if (!phone) throw new CrmError("Telefone brasileiro inválido");
    const db = getDb();
    let [c] = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
    if (!c) [c] = await db.insert(contacts).values({ phone, name: d.name, legalBasis: "contato_iniciado_pelo_titular", consentAt: new Date() }).returning();
    const [open] = await db.select().from(leads).where(and(eq(leads.contactId, c.id), eq(leads.unitId, d.unitId), eq(leads.status, "open"))).limit(1);
    if (open) throw new CrmError("Já existe um lead aberto para este telefone nesta unidade");
    const [l] = await db.insert(leads).values({ contactId: c.id, unitId: d.unitId, stageKey: "novo_lead", sourcePlatform: "manual", attributionStatus: "unknown" }).returning();
    await db.insert(leadAttributions).values({ leadId: l.id, kind: "declared", confidence: "unknown", platform: "manual", declaredSource: d.declaredSource || null, evidence: { by: u.id } });
    await audit(db, u.id, "lead.create", "lead", l.id, { source: "manual" });
    if (u.role === "vendedor") await assignLead(db, l.id, u.id, "manual_proprio", { byUserId: u.id });
    else await runTrigger(db, "lead_created", l.id);
  }, "Lead cadastrado");
}

/* ---------- vendas ---------- */
export async function reviewSaleAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    if (!canManage(u)) throw new CrmError("Sem permissão");
    const [s] = await getDb().select().from(sales).where(eq(sales.id, String(fd.get("saleId")))).limit(1);
    if (!s) throw new CrmError("Venda não encontrada");
    if (!isAdmin(u) && s.unitId !== u.unitId) throw new CrmError("Venda de outra unidade");
    if (fd.get("decision") === "reject") return rejectSaleMatch(getDb(), s.id, u.id);
    const leadId = String(fd.get("leadId") || s.leadId || "");
    if (!leadId) throw new CrmError("Informe o lead");
    const [l] = await getDb().select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!l || !canSeeLead(u, l)) throw new CrmError("Lead não encontrado");
    await linkSale(getDb(), s.id, l.id, "revisao_manual", { reviewedBy: u.id }, u.id);
  }, "Correspondência revisada");
}

/* ---------- automações / distribuição ---------- */
export async function ruleAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    if (!isAdmin(u)) throw new CrmError("Somente administrador/diretoria");
    const id = String(fd.get("ruleId"));
    const [r] = await getDb().select().from(automationRules).where(eq(automationRules.id, id)).limit(1);
    if (!r) throw new CrmError("Regra não encontrada");
    const params = { ...(r.params as object) } as Record<string, unknown>;
    if (fd.has("minutes")) params.minutes = z.coerce.number().int().min(1).max(10080).parse(fd.get("minutes"));
    if (fd.has("stageKey")) params.stageKey = String(fd.get("stageKey"));
    await getDb().update(automationRules).set({ active: fd.get("active") === "on", params, updatedAt: new Date() }).where(eq(automationRules.id, id));
    await audit(getDb(), u.id, "rule.update", "automation_rule", id, { active: fd.get("active") === "on", params });
  }, "Regra salva");
}

export async function distributionAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    const [r] = await getDb().select().from(distributionRules).where(eq(distributionRules.id, String(fd.get("ruleId")))).limit(1);
    if (!r || !(isAdmin(u) || (u.role === "gestor" && r.unitId === u.unitId))) throw new CrmError("Sem permissão");
    const strategy = z.enum(["round_robin", "manual"]).parse(fd.get("strategy"));
    await getDb().update(distributionRules).set({ strategy, onlyAvailable: fd.get("onlyAvailable") === "on", active: fd.get("active") === "on" }).where(eq(distributionRules.id, r.id));
    await audit(getDb(), u.id, "distribution.update", "distribution_rule", r.id, { strategy });
  }, "Distribuição salva");
}

export async function availabilityAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    await getDb().update(users).set({ available: fd.get("available") === "on" }).where(eq(users.id, u.id));
  }, "Disponibilidade atualizada");
}

/* ---------- configurações ---------- */
const UserForm = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "Usuário: 3–40 caracteres (letras, números, ponto)"),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["diretoria", "admin", "gestor", "vendedor"]),
  unitId: z.string().optional(),
  password: z.string().min(10, "Senha com no mínimo 10 caracteres"),
});

export async function createUserAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    const d = UserForm.parse(Object.fromEntries(fd));
    if (!isAdmin(u) && !(u.role === "gestor" && d.role === "vendedor" && d.unitId === u.unitId)) throw new CrmError("Gestor só cadastra vendedores da própria unidade");
    if ((d.role === "gestor" || d.role === "vendedor") && !d.unitId) throw new CrmError("Gestor e vendedor precisam de unidade");
    const exists = await getDb().select({ id: users.id }).from(users).where(eq(users.username, d.username)).limit(1);
    if (exists.length) throw new CrmError("Usuário já existe");
    const [n] = await getDb().insert(users).values({ username: d.username, name: d.name, role: d.role, unitId: d.unitId || null, passwordHash: await hashPassword(d.password) }).returning();
    await audit(getDb(), u.id, "user.create", "user", n.id, { role: d.role, unitId: d.unitId });
  }, "Usuário criado");
}

export async function toggleUserAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    const [t] = await getDb().select().from(users).where(eq(users.id, String(fd.get("userId")))).limit(1);
    if (!t || !(isAdmin(u) || (u.role === "gestor" && t.unitId === u.unitId && t.role === "vendedor"))) throw new CrmError("Sem permissão");
    if (t.id === u.id) throw new CrmError("Você não pode desativar a si mesmo");
    // desligamento não apaga registros: só desativa o acesso
    await getDb().update(users).set({ active: !t.active }).where(eq(users.id, t.id));
    await audit(getDb(), u.id, t.active ? "user.deactivate" : "user.activate", "user", t.id);
  }, "Usuário atualizado");
}

export async function unitAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    if (!isAdmin(u)) throw new CrmError("Somente administrador/diretoria");
    const name = z.string().trim().min(2).max(80).parse(fd.get("name"));
    const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const [n] = await getDb().insert(units).values({ name, slug }).onConflictDoNothing().returning();
    if (!n) throw new CrmError("Unidade já existe");
    await getDb().insert(distributionRules).values({ name: `Rodízio ${name}`, unitId: n.id });
    await audit(getDb(), u.id, "unit.create", "unit", n.id);
  }, "Unidade criada");
}

export async function routeAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    if (!isAdmin(u)) throw new CrmError("Somente administrador/diretoria");
    if (fd.get("delete")) { await getDb().delete(unitRoutes).where(eq(unitRoutes.id, String(fd.get("delete")))); return; }
    const sourceType = z.enum(["wa_phone_number_id", "page_id", "form_id"]).parse(fd.get("sourceType"));
    const value = z.string().trim().regex(/^[A-Za-z0-9_-]{3,64}$/, "ID inválido").parse(fd.get("value"));
    const unitId = z.string().min(1).parse(fd.get("unitId"));
    await getDb().insert(unitRoutes).values({ sourceType, value, unitId }).onConflictDoUpdate({ target: [unitRoutes.sourceType, unitRoutes.value], set: { unitId } });
    await audit(getDb(), u.id, "route.upsert", "unit_route", null, { sourceType, value, unitId });
  }, "Roteamento salvo");
}

export async function syncMetaAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    if (!isAdmin(u)) throw new CrmError("Somente administrador/diretoria");
    if (!metaConfigured()) throw new CrmError("Token da Meta não configurado (META_SYSTEM_USER_TOKEN). Nenhuma conexão foi feita.");
    const acc = z.string().trim().regex(/^(act_)?\d{5,20}$/, "ID da conta de anúncios inválido").parse(fd.get("adAccountId"));
    await syncAccountStructure(getDb(), acc);
    const until = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    await syncInsights(getDb(), acc, since, until);
    await audit(getDb(), u.id, "meta.sync", "ad_account", acc);
  }, "Sincronização concluída");
}

export async function runJobsAction(_: ActionState) {
  return guard(async () => {
    const u = await requireUser();
    if (!isAdmin(u)) throw new CrmError("Somente administrador/diretoria");
    await processInbox(getDb());
    await runInactivitySweep(getDb());
  }, "Fila processada e varredura de inatividade executada");
}

export async function changePasswordAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    const current = String(fd.get("current") ?? "");
    const next = z.string().min(10, "Nova senha com no mínimo 10 caracteres").max(200).parse(fd.get("next"));
    if (next !== fd.get("confirm")) throw new CrmError("A confirmação não confere");
    if (!(await bcrypt.compare(current, u.passwordHash))) throw new CrmError("Senha atual incorreta");
    await getDb().update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, u.id));
    await audit(getDb(), u.id, "user.password_change", "user", u.id);
  }, "Senha alterada");
}

export async function testDataAction(_: ActionState, fd: FormData) {
  return guard(async () => {
    const u = await requireUser();
    if (!isAdmin(u)) throw new CrmError("Somente administrador/diretoria");
    if (fd.get("op") === "delete") {
      await deleteTestData(getDb());
      await audit(getDb(), u.id, "testdata.delete", "system", null);
      return;
    }
    // usuários de teste nascem com senha aleatória não divulgada (não servem para login em produção)
    await seedTestData(getDb(), { leadsPerUnit: 10, password: randomToken(24), createDirector: false });
    await audit(getDb(), u.id, "testdata.seed", "system", null);
  }, fd.get("op") === "delete" ? "Dados de teste apagados" : "Dados de teste gerados (marque “Incluir dados de teste” nos filtros)");
}
