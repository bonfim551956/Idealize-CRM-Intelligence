import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { automationRules, distributionRules, units, pipelineStages } from "@/db/schema";
import { requireUser } from "@/server/session";
import { isAdmin } from "@/server/scope";
import { Card, PageHeader, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { ruleAction, distributionAction } from "@/app/actions";

const TRIGGER: Record<string, string> = { lead_created: "Novo lead", no_activity: "Sem movimentação", appointment_created: "Agendamento criado", appointment_confirmed: "Agendamento confirmado", appointment_attended: "Comparecimento", sale_matched: "Venda vinculada" };
const ACTION: Record<string, string> = { distribute: "Distribuir", alert: "Gerar alerta", reassign: "Reatribuir", move_stage: "Mover etapa" };

export default async function Automacoes() {
  const u = await requireUser(); const db = getDb(); const admin = isAdmin(u);
  const [rules, dist, allUnits, stages] = await Promise.all([
    db.select().from(automationRules).orderBy(asc(automationRules.trigger)),
    db.select().from(distributionRules).orderBy(asc(distributionRules.name)),
    db.select().from(units), db.select().from(pipelineStages).orderBy(asc(pipelineStages.position)),
  ]);
  const visibleDist = admin ? dist : dist.filter((d) => d.unitId === u.unitId);
  return (
    <>
      <PageHeader title="Automações" subtitle="Regras ajustáveis sem mexer no código. Toda alteração fica no log de auditoria." />
      <Card title="Regras do pipeline">
        <ul className="divide-y divide-ink-100">{rules.map((r) => { const p = r.params as { stageKey?: string; minutes?: number }; return (
          <li key={r.id} className="py-3">
            <ActionForm action={ruleAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="ruleId" value={r.id} />
              <div className="min-w-[260px] flex-1"><div className="text-sm font-medium">{r.name}</div><div className="mt-1 flex gap-1"><Badge tone="blue">{TRIGGER[r.trigger] ?? r.trigger}</Badge><Badge>{ACTION[r.action] ?? r.action}</Badge></div></div>
              {r.trigger === "no_activity" && <>
                <select name="stageKey" defaultValue={p.stageKey} disabled={!admin} className="input h-8 w-52 text-xs" aria-label="Etapa">{stages.filter((s) => s.kind === "open").map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select>
                <label className="flex items-center gap-1 text-xs text-ink-700">após<input name="minutes" type="number" min={1} defaultValue={p.minutes} disabled={!admin} className="input h-8 w-20 text-xs" />min</label>
              </>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={r.active} disabled={!admin} className="h-4 w-4 accent-brand-700" />Ativa</label>
              {admin && <Submit size="sm" variant="secondary">Salvar</Submit>}
            </ActionForm>
          </li>); })}</ul>
        {!admin && <p className="mt-2 text-xs text-ink-500">Somente diretoria/administrador altera regras.</p>}
      </Card>
      <Card className="mt-6" title="Distribuição de leads">
        <ul className="divide-y divide-ink-100">{visibleDist.map((d) => (
          <li key={d.id} className="py-3">
            <ActionForm action={distributionAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="ruleId" value={d.id} />
              <div className="min-w-[200px] flex-1 text-sm font-medium">{d.name}<div className="text-xs font-normal text-ink-500">{allUnits.find((x) => x.id === d.unitId)?.name}{d.campaignId ? ` · campanha ${d.campaignId}` : ""}</div></div>
              <select name="strategy" defaultValue={d.strategy} className="input h-8 w-44 text-xs" aria-label="Estratégia"><option value="round_robin">Rodízio</option><option value="manual">Manual (gestor distribui)</option></select>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="onlyAvailable" defaultChecked={d.onlyAvailable} className="h-4 w-4 accent-brand-700" />Só disponíveis</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={d.active} className="h-4 w-4 accent-brand-700" />Ativa</label>
              <Submit size="sm" variant="secondary">Salvar</Submit>
            </ActionForm>
          </li>))}</ul>
        <p className="mt-2 text-xs text-ink-500">“Só disponíveis”: o vendedor liga/desliga a própria disponibilidade em Configurações. Sem ninguém disponível, o lead fica em “Aguardando atendimento” com alerta.</p>
      </Card>
    </>
  );
}
