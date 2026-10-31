import Link from "next/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, contacts, users, units, pipelineStages } from "@/db/schema";
import { requireUser } from "@/server/session";
import { leadScope, isAdmin } from "@/server/scope";
import { PageHeader, Card, Badge, Empty, attrTone } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { createLeadAction } from "@/app/actions";
import { maskPhone } from "@/lib/phone";
import { dt, SOURCE_LABEL, ATTR_LABEL } from "@/lib/format";
import type { SP } from "@/server/filters";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const u = await requireUser(); const db = getDb();
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const showTest = sp.teste === "1";
  const qDigits = q.replace(/\D/g, "");
  const rows = await db.select({ l: leads, c: contacts, o: users, un: units, st: pipelineStages }).from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId)).leftJoin(users, eq(users.id, leads.ownerId))
    .leftJoin(units, eq(units.id, leads.unitId)).leftJoin(pipelineStages, eq(pipelineStages.key, leads.stageKey))
    .where(and(leadScope(u), showTest ? undefined : eq(leads.isTest, false),
      status ? eq(leads.status, status as "open") : undefined,
      q ? or(ilike(contacts.name, `%${q}%`), qDigits.length >= 4 ? ilike(contacts.phone, `%${qDigits}%`) : undefined) : undefined))
    .orderBy(desc(leads.createdAt)).limit(300);
  const allUnits = await db.select().from(units).where(eq(units.active, true));
  const myUnits = isAdmin(u) ? allUnits : allUnits.filter((x) => x.id === u.unitId);
  return (
    <>
      <PageHeader title="Leads" subtitle="Até 300 mais recentes dentro do seu acesso" />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card title="Lista">
          <form method="get" className="mb-4 flex flex-wrap gap-2">
            <input name="q" defaultValue={q} placeholder="Nome ou telefone" className="input h-8 w-44 text-xs" aria-label="Buscar" />
            <select name="status" defaultValue={status} className="input h-8 w-32 text-xs" aria-label="Status"><option value="">Todos</option><option value="open">Abertos</option><option value="won">Ganhos</option><option value="lost">Perdidos</option></select>
            <label className="flex items-center gap-1 text-xs text-ink-700"><input type="checkbox" name="teste" value="1" defaultChecked={showTest} className="accent-brand-700" />Teste</label>
            <button className="h-8 rounded-lg border border-ink-300 px-3 text-xs font-medium hover:bg-ink-100">Buscar</button>
          </form>
          {rows.length ? (
            <div className="overflow-x-auto"><table className="w-full min-w-[760px]">
              <thead className="border-b border-ink-200"><tr>{["Cliente", "Origem", "Atribuição", "Etapa", "Unidade", "Responsável", "Entrada"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-ink-100">{rows.map(({ l, c, o, un, st }) => (
                <tr key={l.id} className="hover:bg-paper-2">
                  <td className="td"><Link href={`/leads/${l.id}`} className="font-medium text-brand-800 hover:underline">{c.name ?? "Sem nome"}</Link><div className="text-xs text-ink-500">{maskPhone(c.phone)}</div></td>
                  <td className="td">{SOURCE_LABEL[l.sourcePlatform]}{l.isTest && <> <Badge tone="amber">Teste</Badge></>}</td>
                  <td className="td"><Badge tone={attrTone(l.attributionStatus)}>{ATTR_LABEL[l.attributionStatus]}</Badge></td>
                  <td className="td">{st?.name}{l.status === "lost" && l.lostReason ? <div className="text-xs text-ink-500">{l.lostReason}</div> : null}</td>
                  <td className="td">{un?.name ?? "—"}</td><td className="td">{o?.name ?? "—"}</td><td className="td whitespace-nowrap">{dt(l.createdAt)}</td>
                </tr>))}</tbody>
            </table></div>) : <Empty>Nenhum lead encontrado.</Empty>}
        </Card>
        <Card title="Cadastrar lead manual">
          <ActionForm action={createLeadAction} className="space-y-3">
            <div><label className="label" htmlFor="nl-name">Nome</label><input id="nl-name" name="name" required className="input" /></div>
            <div><label className="label" htmlFor="nl-phone">WhatsApp</label><input id="nl-phone" name="phone" required placeholder="(13) 99999-9999" className="input" /></div>
            <div><label className="label" htmlFor="nl-unit">Unidade</label><select id="nl-unit" name="unitId" required className="input" defaultValue={u.unitId ?? ""}><option value="" disabled>Selecione</option>{myUnits.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <div><label className="label" htmlFor="nl-src">Como conheceu (origem declarada)</label><input id="nl-src" name="declaredSource" placeholder="Ex.: indicação, passou na frente" className="input" /></div>
            <p className="text-xs text-ink-500">Lead manual entra com atribuição <b>desconhecida</b>: a origem declarada não é tratada como campanha.</p>
            <Submit className="w-full">Cadastrar</Submit>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
