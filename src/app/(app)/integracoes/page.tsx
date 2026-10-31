import { notFound } from "next/navigation";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { units, unitRoutes, webhookInbox, capiEvents, metaCampaigns } from "@/db/schema";
import { requireUser } from "@/server/session";
import { isAdmin } from "@/server/scope";
import { inboxStats } from "@/server/ingest";
import { Card, PageHeader, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { routeAction, syncMetaAction, runJobsAction, testDataAction } from "@/app/actions";
import { dt } from "@/lib/format";
import { CheckCircle2, XCircle } from "lucide-react";

const ENV = [
  { k: "META_APP_SECRET", d: "Valida a assinatura dos webhooks" },
  { k: "META_WEBHOOK_VERIFY_TOKEN", d: "Handshake de assinatura do webhook" },
  { k: "META_SYSTEM_USER_TOKEN", d: "Marketing API, Lead Ads e resolução do anúncio" },
  { k: "META_DATASET_ID", d: "Conversions API (envio desligado)" },
  { k: "SALES_INGEST_KEY", d: "Entrada de vendas do ADM / PDV" },
  { k: "CRON_SECRET", d: "Fila e varredura de inatividade agendadas" },
  { k: "DATABASE_URL", d: "Postgres de produção (vazio = banco local)" },
];
const SRC: Record<string, string> = { wa_phone_number_id: "WhatsApp (phone_number_id)", page_id: "Página (page_id)", form_id: "Formulário (form_id)" };

export const maxDuration = 300;

export default async function Integracoes() {
  const u = await requireUser(); if (!isAdmin(u)) notFound();
  const db = getDb();
  const [stats, routes, allUnits, failures, capi, campCount] = await Promise.all([
    inboxStats(db), db.select().from(unitRoutes), db.select().from(units),
    db.select().from(webhookInbox).where(inArray(webhookInbox.status, ["failed", "dead"])).orderBy(desc(webhookInbox.receivedAt)).limit(20),
    db.select({ status: capiEvents.status, n: sql<number>`count(*)::int` }).from(capiEvents).groupBy(capiEvents.status),
    db.select({ n: sql<number>`count(*)::int` }).from(metaCampaigns).where(sql`${metaCampaigns.id} not like 'TESTE-%'`),
  ]);
  const ok = (k: string) => Boolean(process.env[k]);
  const sourceSummary = (s: string) => stats.filter((x) => x.source === s);
  return (
    <>
      <PageHeader title="Integrações" subtitle="Status real — nada aqui é simulado. Uma integração só conta como ativa depois de receber dados de verdade." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Credenciais (servidor)">
          <ul className="space-y-2">{ENV.map((e) => <li key={e.k} className="flex items-start gap-2 text-sm">
            {ok(e.k) ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-brand-700" aria-label="configurado" /> : <XCircle className="mt-0.5 h-4 w-4 text-ink-500" aria-label="pendente" />}
            <div><span className="font-mono text-xs">{e.k}</span><div className="text-xs text-ink-500">{e.d}</div></div></li>)}</ul>
          <p className="mt-3 text-xs text-ink-500">Valores nunca são exibidos. Envio para a Conversions API: <b>{process.env.META_CAPI_ENABLED === "true" ? "ligado" : "desligado"}</b>.</p>
        </Card>
        <Card title="Recebimento de eventos">
          <dl className="space-y-3 text-sm">{[["whatsapp", "WhatsApp Cloud API (Click-to-WhatsApp)"], ["leadgen", "Lead Ads (formulários)"], ["sales_adm", "Vendas — Sistema ADM"], ["sales_pdv", "Vendas — PDV"]].map(([k, label]) => {
            const s = sourceSummary(k); const total = s.reduce((a, b) => a + b.n, 0); const last = s.map((x) => x.last).sort().pop();
            return <div key={k} className="flex flex-wrap items-center justify-between gap-2"><dt>{label}</dt><dd className="flex gap-1">{total ? <><Badge tone="green">{total} recebidos</Badge>{s.filter((x) => x.status === "failed" || x.status === "dead").map((x) => <Badge key={x.status} tone="red">{x.n} {x.status === "dead" ? "falha definitiva" : "em retentativa"}</Badge>)}<span className="text-xs text-ink-500">último {dt(last)}</span></> : <Badge>Nunca recebeu</Badge>}</dd></div>;
          })}</dl>
          <div className="mt-4 rounded-lg bg-paper-2 p-3 text-xs text-ink-700">
            <div>Webhook Meta: <span className="font-mono">https://SEU-DOMINIO/api/webhooks/meta</span> (campos <b>messages</b> do WhatsApp e <b>leadgen</b> da Página)</div>
            <div className="mt-1">Vendas ADM/PDV: <span className="font-mono">POST https://SEU-DOMINIO/api/integrations/sales</span> com header X-Integration-Key</div>
          </div>
          <ActionForm action={runJobsAction} className="mt-3"><Submit size="sm" variant="secondary">Processar fila agora</Submit></ActionForm>
        </Card>
        <Card title="Roteamento de entrada → unidade">
          <p className="mb-3 text-xs text-ink-500">Define a unidade de cada lead pelo número de WhatsApp da loja (phone_number_id da Cloud API), página ou formulário. Sem rota, o lead entra “Sem unidade” e só a diretoria vê.</p>
          <ul className="mb-3 divide-y divide-ink-100 text-sm">{routes.map((r) => <li key={r.id} className="flex items-center justify-between py-2"><span><span className="text-xs text-ink-500">{SRC[r.sourceType]}</span> <span className="font-mono text-xs">{r.value}</span> → {allUnits.find((x) => x.id === r.unitId)?.name}</span>
            <ActionForm action={routeAction} hideOk><input type="hidden" name="delete" value={r.id} /><Submit size="sm" variant="ghost">Remover</Submit></ActionForm></li>)}</ul>
          <ActionForm action={routeAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <select name="sourceType" className="input" aria-label="Tipo">{Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input name="value" required placeholder="ID" className="input" aria-label="ID" />
            <select name="unitId" className="input" aria-label="Unidade">{allUnits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            <Submit variant="secondary">Salvar</Submit>
          </ActionForm>
        </Card>
        <Card title="Marketing API">
          <p className="mb-3 text-sm">{campCount[0]?.n ? `${campCount[0].n} campanhas reais sincronizadas.` : "Nenhuma campanha real sincronizada ainda."}</p>
          <ActionForm action={syncMetaAction} className="flex gap-2"><input name="adAccountId" required placeholder="act_1234567890" className="input" aria-label="Conta de anúncios" /><Submit variant="secondary">Sincronizar 30 dias</Submit></ActionForm>
          <p className="mt-3 text-xs text-ink-500">Conversions API: {capi.length ? capi.map((c) => `${c.n} ${c.status}`).join(" · ") : "nenhum evento preparado"}. Eventos ficam bloqueados até o mapeamento ser validado e o envio ser autorizado.</p>
        </Card>
        <Card title="Ambiente de teste" className="xl:col-span-2">
          <p className="mb-3 text-sm text-ink-700">Gera leads, vendas e campanhas FICTÍCIOS (marcados como teste e prefixo TESTE-) para conhecer as telas. Ficam escondidos dos números reais; apagar remove só o que é teste.</p>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={testDataAction}><input type="hidden" name="op" value="seed" /><Submit variant="secondary">Gerar dados de teste</Submit></ActionForm>
            <ActionForm action={testDataAction}><input type="hidden" name="op" value="delete" /><Submit variant="danger">Apagar todos os dados de teste</Submit></ActionForm>
          </div>
        </Card>
        {failures.length > 0 && <Card title="Falhas recentes" className="xl:col-span-2">
          <ul className="divide-y divide-ink-100 text-sm">{failures.map((f) => <li key={f.id} className="py-2"><Badge tone="red">{f.status}</Badge> <span className="font-mono text-xs">{f.dedupeKey}</span> · tentativa {f.attempts} · {dt(f.receivedAt)}<div className="text-xs text-red-700">{f.lastError}</div></li>)}</ul>
        </Card>}
      </div>
    </>
  );
}
