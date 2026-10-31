import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { sales, units, leads, contacts } from "@/db/schema";
import { requireUser } from "@/server/session";
import { isAdmin, canManage } from "@/server/scope";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { reviewSaleAction } from "@/app/actions";
import { brl, dt } from "@/lib/format";
import { maskPhone } from "@/lib/phone";

const STATUS: Record<string, { label: string; tone: "green" | "amber" | "gray" | "red" }> = {
  matched: { label: "Vinculada", tone: "green" }, pending_review: { label: "Revisar", tone: "amber" }, unmatched: { label: "Sem lead", tone: "gray" }, rejected: { label: "Rejeitada", tone: "red" },
};

export default async function Vendas() {
  const u = await requireUser(); const db = getDb();
  const scope = isAdmin(u) ? undefined : eq(sales.unitId, u.unitId ?? "__none__");
  const [pending, recent] = await Promise.all([
    db.select({ s: sales, un: units, l: leads, c: contacts }).from(sales).leftJoin(units, eq(units.id, sales.unitId)).leftJoin(leads, eq(leads.id, sales.leadId)).leftJoin(contacts, eq(contacts.id, leads.contactId))
      .where(and(scope, eq(sales.matchStatus, "pending_review"))).orderBy(desc(sales.soldAt)).limit(100),
    db.select({ s: sales, un: units }).from(sales).leftJoin(units, eq(units.id, sales.unitId))
      .where(and(scope, inArray(sales.matchStatus, ["matched", "unmatched", "rejected"]))).orderBy(desc(sales.soldAt)).limit(100),
  ]);
  return (
    <>
      <PageHeader title="Vendas" subtitle="Vendas recebidas do Sistema ADM e do PDV e o vínculo com o lead" />
      <Card title={`Correspondências para revisar (${pending.length})`}>
        {pending.length ? <ul className="divide-y divide-ink-100">{pending.map(({ s, un, l, c }) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="text-sm"><b>{s.source.toUpperCase()} #{s.externalId}</b> · {brl(s.amount)} · {un?.name ?? "—"} · {dt(s.soldAt)}
              <div className="text-xs text-ink-500">Cliente {s.customerName ?? "—"} {maskPhone(s.phone)} → lead sugerido {l ? <Link className="text-brand-800 hover:underline" href={`/leads/${l.id}`}>{c?.name} {maskPhone(c?.phone)}</Link> : "—"} · regra: {s.matchRule}</div></div>
            {canManage(u) && <div className="flex gap-2">
              <ActionForm action={reviewSaleAction} hideOk><input type="hidden" name="saleId" value={s.id} /><input type="hidden" name="decision" value="approve" /><Submit size="sm">Confirmar vínculo</Submit></ActionForm>
              <ActionForm action={reviewSaleAction} hideOk><input type="hidden" name="saleId" value={s.id} /><input type="hidden" name="decision" value="reject" /><Submit size="sm" variant="secondary">Não é este lead</Submit></ActionForm>
            </div>}
          </li>))}</ul> : <Empty>Nada para revisar.</Empty>}
      </Card>
      <Card className="mt-6" title="Últimas vendas">
        {recent.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px]">
          <thead className="border-b border-ink-200"><tr>{["Venda", "Valor", "Unidade", "Data", "Vínculo", "Regra"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-ink-100">{recent.map(({ s, un }) => (
            <tr key={s.id}><td className="td">{s.source.toUpperCase()} #{s.externalId}{s.isTest && <> <Badge tone="amber">Teste</Badge></>}</td><td className="td">{brl(s.amount)}</td><td className="td">{un?.name ?? "—"}</td><td className="td">{dt(s.soldAt)}</td>
              <td className="td">{s.leadId ? <Link href={`/leads/${s.leadId}`}><Badge tone={STATUS[s.matchStatus].tone}>{STATUS[s.matchStatus].label}</Badge></Link> : <Badge tone={STATUS[s.matchStatus].tone}>{STATUS[s.matchStatus].label}</Badge>}</td><td className="td text-xs text-ink-500">{s.matchRule}</td></tr>))}</tbody>
        </table></div> : <Empty>Nenhuma venda recebida ainda. Conecte o ADM/PDV em Integrações.</Empty>}
      </Card>
    </>
  );
}
