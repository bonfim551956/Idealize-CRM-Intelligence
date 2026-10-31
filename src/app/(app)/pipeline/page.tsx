import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, contacts, users, pipelineStages, units } from "@/db/schema";
import { requireUser } from "@/server/session";
import { leadScope, isAdmin, canManage } from "@/server/scope";
import { PageHeader, Badge, attrTone } from "@/components/ui";
import { StageMover } from "@/components/stage-mover";
import { maskPhone } from "@/lib/phone";
import { since, SOURCE_LABEL, ATTR_LABEL } from "@/lib/format";
import type { SP } from "@/server/filters";
import clsx from "clsx";

export default async function Pipeline({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const u = await requireUser(); const db = getDb();
  const unitFilter = isAdmin(u) && typeof sp.unidade === "string" && sp.unidade ? sp.unidade : null;
  const showTest = sp.teste === "1";
  const stages = await db.select().from(pipelineStages).orderBy(asc(pipelineStages.position));
  const conds = [leadScope(u), unitFilter ? eq(leads.unitId, unitFilter) : undefined, showTest ? undefined : eq(leads.isTest, false),
    inArray(leads.stageKey, stages.filter((s) => s.kind !== "lost").map((s) => s.key))];
  const rows = await db.select({ l: leads, c: contacts, o: users }).from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId)).leftJoin(users, eq(users.id, leads.ownerId))
    .where(and(...conds)).orderBy(asc(leads.stageEnteredAt)).limit(600);
  const allUnits = isAdmin(u) ? await db.select().from(units) : [];
  const now = Date.now();
  return (
    <>
      <PageHeader title="Pipeline" subtitle="Cards com borda vermelha passaram do SLA da etapa. Perdidos ficam em Leads." actions={
        <form method="get" className="flex items-center gap-2">
          {isAdmin(u) && <select name="unidade" defaultValue={unitFilter ?? ""} className="input w-44" aria-label="Unidade"><option value="">Todas as unidades</option>{allUnits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
          <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" name="teste" value="1" defaultChecked={showTest} className="h-4 w-4 accent-brand-700" />Teste</label>
          <button className="h-10 rounded-lg border border-ink-300 px-4 text-sm font-medium hover:bg-ink-100">Filtrar</button>
        </form>} />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.filter((s) => s.kind !== "lost").map((s) => {
          const items = rows.filter((r) => r.l.stageKey === s.key);
          return (
            <section key={s.key} className="flex w-72 shrink-0 flex-col rounded-xl bg-paper-2 ring-1 ring-ink-200" aria-label={s.name}>
              <header className="flex items-center justify-between px-3 py-3"><h2 className="text-sm font-semibold">{s.name}</h2><Badge>{items.length}</Badge></header>
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.map(({ l, c, o }) => {
                  const late = s.slaMinutes != null && l.status === "open" && now - l.lastActivityAt.getTime() > s.slaMinutes * 60_000;
                  return (
                    <article key={l.id} className={clsx("rounded-lg border bg-paper p-3 shadow-sm", late ? "border-red-300" : "border-ink-200")}>
                      <Link href={`/leads/${l.id}`} className="block text-sm font-medium text-ink hover:text-brand-800">{c.name ?? "Sem nome"}</Link>
                      <div className="text-xs text-ink-500">{maskPhone(c.phone)}</div>
                      <div className="mt-2 flex flex-wrap gap-1"><Badge tone="blue">{SOURCE_LABEL[l.sourcePlatform]}</Badge><Badge tone={attrTone(l.attributionStatus)}>{ATTR_LABEL[l.attributionStatus]}</Badge>{l.isTest && <Badge tone="amber">Teste</Badge>}</div>
                      <div className="mt-2 flex justify-between text-xs text-ink-500"><span>{o?.name ?? "Sem responsável"}</span><span className={late ? "font-semibold text-red-700" : ""}>{since(l.stageEnteredAt)}</span></div>
                      <StageMover compact leadId={l.id} current={l.stageKey} stages={stages} canMarkWon={canManage(u)} />
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
