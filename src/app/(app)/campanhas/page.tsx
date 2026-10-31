import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { units, metaCampaigns } from "@/db/schema";
import { requireUser } from "@/server/session";
import { isAdmin } from "@/server/scope";
import { parseFilters, type SP } from "@/server/filters";
import { byCampaign, byAd } from "@/server/metrics";
import { Card, PageHeader, Empty } from "@/components/ui";
import { FiltersBar, TestBanner } from "@/components/filters";
import { CampaignTable } from "@/components/tables";

export default async function Campanhas({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams; const u = await requireUser(); const db = getDb();
  const f = parseFilters(sp, u);
  const allUnits = await db.select().from(units);
  if (f.campaignId) {
    const [camp] = await db.select().from(metaCampaigns).where(eq(metaCampaigns.id, f.campaignId));
    const ads = await byAd(db, u, f);
    return (
      <>
        <PageHeader title={camp?.name ?? `Campanha ${f.campaignId}`} subtitle="Anúncios e criativos desta campanha" actions={<Link href="/campanhas" className="text-sm font-medium text-brand-800 hover:underline">← Todas as campanhas</Link>} />
        <FiltersBar sp={sp as Record<string, string>} units={allUnits} showUnit={isAdmin(u)} extra={<input type="hidden" name="campanha" value={f.campaignId} />} />
        <TestBanner on={!!f.includeTest} />
        <Card title="Por anúncio">{ads.length ? <CampaignTable rows={ads} first="Anúncio" /> : <Empty>Nenhum lead desta campanha no período.</Empty>}</Card>
      </>
    );
  }
  const rows = await byCampaign(db, u, f);
  return (
    <>
      <PageHeader title="Campanhas" subtitle="Qual anúncio gera venda real — não só contato. Clique numa campanha para ver anúncios." />
      <FiltersBar sp={sp as Record<string, string>} units={allUnits} showUnit={isAdmin(u)} />
      <TestBanner on={!!f.includeTest} />
      <Card title="Comparativo">{rows.length ? <CampaignTable rows={rows} drill /> : <Empty>Nenhum lead no período.</Empty>}</Card>
      <p className="mt-3 text-xs text-ink-500">CPL = investimento ÷ leads · CPA = investimento ÷ vendas · ROAS = faturamento atribuído ÷ investimento. Investimento vem da Marketing API (Insights); faturamento das vendas do ADM/PDV vinculadas ao lead.</p>
    </>
  );
}
