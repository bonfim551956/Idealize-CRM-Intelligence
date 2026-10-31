import { getDb } from "@/db";
import { units, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/server/session";
import { isAdmin } from "@/server/scope";
import { parseFilters, type SP } from "@/server/filters";
import { overview, byUnit, bySeller, byCampaign, type FunnelRow } from "@/server/metrics";
import { Card, Kpi, PageHeader, Empty } from "@/components/ui";
import { FiltersBar, TestBanner } from "@/components/filters";
import { brl, int, pct } from "@/lib/format";
import Link from "next/link";
import { CampaignTable, FunnelTable } from "@/components/tables";

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const u = await requireUser(); const db = getDb();
  const f = parseFilters(sp, u);
  const [ov, unitsRows, sellerRows, camp, allUnits, sellers] = await Promise.all([
    overview(db, u, f), byUnit(db, u, f), bySeller(db, u, f), byCampaign(db, u, f),
    db.select().from(units).where(eq(units.active, true)),
    db.select().from(users).where(and(eq(users.role, "vendedor"), f.unitId ? eq(users.unitId, f.unitId) : undefined)),
  ]);
  const o: FunnelRow = ov ?? { key: null, label: null, leads: 0, atendidos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0, vendas: 0, faturamento: 0, tempo_resp_min: null };
  const inv = camp.reduce((s, c) => s + c.investimento, 0);
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Do anúncio à venda real — atribuição do CRM (não é a atribuição oficial da Meta)" />
      <FiltersBar sp={sp as Record<string, string>} units={allUnits} sellers={sellers} showUnit={isAdmin(u)} />
      <TestBanner on={!!f.includeTest} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Leads" value={int(o.leads)} hint={`${int(o.leads - o.atendidos)} pendentes`} />
        <Kpi label="Atendidos" value={int(o.atendidos)} hint={pct(o.atendidos, o.leads)} />
        <Kpi label="Qualificados" value={int(o.qualificados)} hint={pct(o.qualificados, o.leads)} />
        <Kpi label="Agendamentos" value={int(o.agendamentos)} hint={`${int(o.comparecimentos)} compareceram`} />
        <Kpi label="Vendas" value={int(o.vendas)} hint={`Conversão ${pct(o.vendas, o.leads)}`} />
        <Kpi label="Faturamento atribuído" value={brl(o.faturamento)} hint={o.tempo_resp_min != null ? `1ª resposta média ${o.tempo_resp_min} min` : "Sem respostas no período"} />
      </div>

      <Card className="mt-6" title="Inteligência de anúncios" action={<Link href="/campanhas" className="text-xs font-medium text-brand-800 hover:underline">Abrir campanhas →</Link>}>
        {camp.length ? <CampaignTable rows={camp} /> : <Empty>Nenhum lead no período.</Empty>}
        {inv === 0 && camp.length > 0 && <p className="mt-3 text-xs text-ink-500">Investimento zerado: a Marketing API ainda não foi sincronizada (Integrações).</p>}
      </Card>

      <div className="mt-6 grid gap-6">
        <Card title="Por vendedor"><FunnelTable rows={sellerRows} first="Vendedor" /></Card>
        <Card title="Por unidade"><FunnelTable rows={unitsRows} first="Unidade" /></Card>
      </div>
    </>
  );
}

