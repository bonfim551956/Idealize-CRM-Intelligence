import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, contacts, users, units, pipelineStages, leadAttributions, leadEvents, leadStageHistory, appointments, sales, metaCampaigns, metaAds, metaAdsets, metaCreatives } from "@/db/schema";
import { requireUser } from "@/server/session";
import { canSeeLead, canManage } from "@/server/scope";
import { Card, Badge, attrTone, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { StageMover } from "@/components/stage-mover";
import { addNoteAction, nextActionAction, appointmentAction, appointmentStatusAction, reassignAction } from "@/app/actions";
import { maskPhone } from "@/lib/phone";
import { brl, dt, SOURCE_LABEL, ATTR_LABEL } from "@/lib/format";
import { MessageSquare, StickyNote, AlertTriangle, UserCheck, CalendarDays, Receipt, Cog, ArrowRightLeft } from "lucide-react";

const KIND_LABEL: Record<string, string> = { first_touch: "Primeiro contato", last_touch: "Último contato", declared: "Origem declarada", technical: "Origem técnica" };
const ICON = { message_in: MessageSquare, message_out: MessageSquare, note: StickyNote, alert: AlertTriangle, assignment: UserCheck, appointment: CalendarDays, sale: Receipt, system: Cog, stage: ArrowRightLeft };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const u = await requireUser(); const db = getDb();
  const [row] = await db.select({ l: leads, c: contacts, o: users, un: units }).from(leads).innerJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(users, eq(users.id, leads.ownerId)).leftJoin(units, eq(units.id, leads.unitId)).where(eq(leads.id, id)).limit(1);
  if (!row || !canSeeLead(u, row.l)) notFound();
  const { l, c, o, un } = row;
  const [stages, attrs, events, hist, appts, linkedSales, sellers] = await Promise.all([
    db.select().from(pipelineStages).orderBy(asc(pipelineStages.position)),
    db.select({ a: leadAttributions, camp: metaCampaigns, ad: metaAds, set: metaAdsets, cr: metaCreatives }).from(leadAttributions)
      .leftJoin(metaCampaigns, eq(metaCampaigns.id, leadAttributions.campaignId)).leftJoin(metaAds, eq(metaAds.id, leadAttributions.adId))
      .leftJoin(metaAdsets, eq(metaAdsets.id, leadAttributions.adsetId)).leftJoin(metaCreatives, eq(metaCreatives.id, leadAttributions.creativeId))
      .where(eq(leadAttributions.leadId, id)).orderBy(asc(leadAttributions.capturedAt)),
    db.select({ e: leadEvents, who: users.name }).from(leadEvents).leftJoin(users, eq(users.id, leadEvents.actorId)).where(eq(leadEvents.leadId, id)).orderBy(desc(leadEvents.at)).limit(200),
    db.select({ h: leadStageHistory, who: users.name }).from(leadStageHistory).leftJoin(users, eq(users.id, leadStageHistory.byUserId)).where(eq(leadStageHistory.leadId, id)).orderBy(desc(leadStageHistory.at)),
    db.select().from(appointments).where(eq(appointments.leadId, id)).orderBy(desc(appointments.scheduledAt)),
    db.select().from(sales).where(eq(sales.leadId, id)),
    l.unitId ? db.select().from(users).where(and(eq(users.unitId, l.unitId), eq(users.role, "vendedor"), eq(users.active, true))) : Promise.resolve([]),
  ]);
  const stageName = (k: string | null) => stages.find((s) => s.key === k)?.name ?? k ?? "—";
  const timeline = [
    ...events.map(({ e, who }) => ({ at: e.at, type: e.type, body: e.body, who })),
    ...hist.map(({ h, who }) => ({ at: h.at, type: "stage" as const, body: `${stageName(h.fromStage)} → ${stageName(h.toStage)}${h.reason ? ` · ${h.reason}` : ""}${h.byRule ? ` (regra: ${h.byRule})` : ""}`, who })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <PageHeader title={c.name ?? "Lead sem nome"} subtitle={`${maskPhone(c.phone)} · ${un?.name ?? "Sem unidade"} · entrou ${dt(l.createdAt)}`}
        actions={<div className="flex flex-wrap gap-2"><Badge tone="blue">{SOURCE_LABEL[l.sourcePlatform]}</Badge><Badge tone={attrTone(l.attributionStatus)}>Atribuição {ATTR_LABEL[l.attributionStatus].toLowerCase()}</Badge>{l.isTest && <Badge tone="amber">Teste</Badge>}</div>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="Origem do lead">
            {attrs.length ? <div className="grid gap-4 md:grid-cols-2">{attrs.map(({ a, camp, ad, set, cr }) => (
              <div key={a.id} className="rounded-lg border border-ink-200 p-3">
                <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">{KIND_LABEL[a.kind]}</span><Badge tone={attrTone(a.confidence)}>{ATTR_LABEL[a.confidence]}</Badge></div>
                <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
                  <dt className="text-ink-500">Campanha</dt><dd>{camp?.name ?? (a.campaignId ? `ID ${a.campaignId}` : "—")}</dd>
                  <dt className="text-ink-500">Conjunto</dt><dd>{set?.name ?? (a.adsetId ? `ID ${a.adsetId}` : "—")}</dd>
                  <dt className="text-ink-500">Anúncio</dt><dd>{ad?.name ?? (a.adId ? `ID ${a.adId}` : "—")}</dd>
                  <dt className="text-ink-500">Criativo</dt><dd>{cr?.name ?? (a.creativeId ? `ID ${a.creativeId}` : "—")}</dd>
                  {a.headline && <><dt className="text-ink-500">Título</dt><dd>{a.headline}</dd></>}
                  {a.ctwaClid && <><dt className="text-ink-500">ctwa_clid</dt><dd className="truncate font-mono">{a.ctwaClid}</dd></>}
                  {a.leadgenId && <><dt className="text-ink-500">Lead ID Meta</dt><dd className="font-mono">{a.leadgenId}</dd></>}
                  {a.declaredSource && <><dt className="text-ink-500">Declarada</dt><dd>{a.declaredSource}</dd></>}
                  <dt className="text-ink-500">Capturado</dt><dd>{dt(a.capturedAt)}</dd>
                </dl>
              </div>))}</div> : <p className="text-sm text-ink-500">Sem registro de origem.</p>}
            <p className="mt-3 text-xs text-ink-500">Atribuição do CRM, baseada nos identificadores recebidos. Não substitui a atribuição oficial do Gerenciador de Anúncios.</p>
          </Card>

          <Card title="Histórico e conversa">
            <ActionForm action={addNoteAction} className="mb-4">
              <input type="hidden" name="leadId" value={l.id} />
              <label className="label" htmlFor="note">Nova observação</label>
              <textarea id="note" name="body" rows={2} required className="input h-auto py-2" placeholder="O que foi conversado, objeções, interesse…" />
              <div className="mt-2 flex justify-end"><Submit size="sm">Registrar</Submit></div>
            </ActionForm>
            <ol className="space-y-3">{timeline.map((t, i) => { const Icon = ICON[t.type as keyof typeof ICON] ?? Cog; return (
              <li key={i} className="flex gap-3">
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${t.type === "message_in" ? "bg-brand-50 text-brand-800" : t.type === "alert" ? "bg-red-50 text-red-700" : "bg-ink-100 text-ink-700"}`}><Icon className="h-3.5 w-3.5" aria-hidden /></div>
                <div className="min-w-0"><p className="whitespace-pre-wrap break-words text-sm">{t.body}</p><p className="text-xs text-ink-500">{dt(t.at)}{t.who ? ` · ${t.who}` : t.type === "message_in" ? " · cliente (WhatsApp)" : ""}</p></div>
              </li>); })}</ol>
            <p className="mt-4 rounded-lg bg-paper-2 p-3 text-xs text-ink-500">Mensagens recebidas aparecem aqui quando o número da loja estiver na API oficial do WhatsApp (Cloud API). Responder pelo CRM ainda não está habilitado.</p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Etapa">
            <p className="mb-2 text-sm"><b>{stageName(l.stageKey)}</b>{l.lostReason && l.status === "lost" ? ` · ${l.lostReason}` : ""}</p>
            <StageMover leadId={l.id} current={l.stageKey} stages={stages} canMarkWon={canManage(u)} />
          </Card>
          <Card title="Responsável">
            <p className="text-sm">{o?.name ?? "Sem responsável"}</p>
            {canManage(u) && sellers.length > 0 && <ActionForm action={reassignAction} className="mt-3 flex gap-2">
              <input type="hidden" name="leadId" value={l.id} />
              <select name="userId" defaultValue={o?.id ?? ""} className="input" aria-label="Novo responsável">{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <Submit size="md" variant="secondary">Trocar</Submit>
            </ActionForm>}
          </Card>
          <Card title="Próxima ação">
            {l.nextAction && <p className="mb-2 text-sm">{l.nextAction}{l.nextActionAt ? ` · ${dt(l.nextActionAt)}` : ""}</p>}
            <ActionForm action={nextActionAction} className="space-y-2">
              <input type="hidden" name="leadId" value={l.id} />
              <input name="nextAction" required placeholder="Ex.: ligar para confirmar exame" className="input" aria-label="Próxima ação" />
              <input type="datetime-local" name="nextActionAt" className="input" aria-label="Quando" />
              <Submit size="sm" variant="secondary">Definir</Submit>
            </ActionForm>
          </Card>
          <Card title="Agendamentos">
            <ActionForm action={appointmentAction} className="mb-3 grid gap-2">
              <input type="hidden" name="leadId" value={l.id} />
              <input type="datetime-local" name="scheduledAt" required className="input" aria-label="Data e hora" />
              <Submit variant="secondary">Agendar</Submit>
            </ActionForm>
            <ul className="space-y-2">{appts.map((a) => (
              <li key={a.id} className="rounded-lg border border-ink-200 p-2 text-sm">
                <div className="flex justify-between"><span>{dt(a.scheduledAt)}</span><Badge tone={a.status === "compareceu" ? "green" : a.status === "nao_compareceu" || a.status === "cancelado" ? "red" : "gray"}>{a.status.replace("_", " ")}</Badge></div>
                {(a.status === "agendado" || a.status === "confirmado") && <ActionForm action={appointmentStatusAction} className="mt-2 flex gap-2" hideOk>
                  <input type="hidden" name="appointmentId" value={a.id} />
                  <select name="status" className="input h-8 text-xs" aria-label="Status do agendamento" defaultValue={a.status === "agendado" ? "confirmado" : "compareceu"}>
                    {a.status === "agendado" && <option value="confirmado">Confirmar</option>}<option value="compareceu">Compareceu</option><option value="nao_compareceu">Não compareceu</option><option value="cancelado">Cancelar</option>
                  </select><Submit size="sm" variant="secondary">OK</Submit>
                </ActionForm>}
              </li>))}</ul>
          </Card>
          <Card title="Vendas vinculadas">
            {linkedSales.length ? <ul className="space-y-1 text-sm">{linkedSales.map((s) => <li key={s.id} className="flex justify-between"><span>{s.source.toUpperCase()} #{s.externalId}</span><span>{brl(s.amount)} {s.matchStatus !== "matched" && <Badge tone="amber">{s.matchStatus === "pending_review" ? "em revisão" : s.matchStatus}</Badge>}</span></li>)}</ul>
              : <p className="text-sm text-ink-500">Nenhuma venda vinculada. A venda entra automaticamente pelo ADM/PDV.</p>}
            <p className="mt-2 text-sm font-semibold">Total: {brl(l.wonAmount)}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
