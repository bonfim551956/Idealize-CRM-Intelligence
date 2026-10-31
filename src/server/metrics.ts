import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db";
import type { SessionUser } from "./auth";
import { leadScope } from "./scope";

export type Filters = { from: Date; to: Date; unitId?: string | null; campaignId?: string | null; ownerId?: string | null; source?: string | null; includeTest?: boolean };

export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

export type FunnelRow = {
  key: string | null; label: string | null; leads: number; atendidos: number; qualificados: number; agendamentos: number;
  comparecimentos: number; vendas: number; faturamento: number; tempo_resp_min: number | null;
};

/**
 * Funil agregado. "Alcançou etapa" considera o histórico (um lead perdido depois de qualificado conta como qualificado).
 * Posições: 3 em_atendimento · 5 qualificado · 6 agendamento · 8 compareceu · 10 venda.
 */
async function funnel(db: DB, u: SessionUser, f: Filters, group: { key: SQL; label: SQL; join?: SQL }): Promise<FunnelRow[]> {
  const scope = leadScope(u);
  const where = sql.join([
    sql`leads.created_at >= ${f.from.toISOString()} and leads.created_at < ${f.to.toISOString()}`,
    f.includeTest ? sql`true` : sql`leads.is_test = false`,
    f.unitId ? sql`leads.unit_id = ${f.unitId}` : sql`true`,
    f.ownerId ? sql`leads.owner_id = ${f.ownerId}` : sql`true`,
    f.source ? sql`leads.source_platform = ${f.source}` : sql`true`,
    f.campaignId ? sql`fa.campaign_id = ${f.campaignId}` : sql`true`,
    scope ? sql`(${scope})` : sql`true`,
  ], sql` and `);
  const res = await db.execute(sql`
    with base as (
      select leads.id, leads.unit_id, leads.owner_id, leads.source_platform, leads.created_at, leads.first_response_at, leads.stage_key,
             fa.campaign_id, fa.ad_id, fa.creative_id
      from leads
      left join lateral (
        select campaign_id, ad_id, creative_id from lead_attributions a
        where a.lead_id = leads.id and a.kind = 'first_touch' order by a.captured_at asc limit 1
      ) fa on true
      where ${where}
    ),
    reached as (
      select lead_id, max(position) as maxpos from (
        select h.lead_id, s.position from lead_stage_history h join pipeline_stages s on s.key = h.to_stage where s.kind <> 'lost'
        union all
        select b.id, s.position from base b join pipeline_stages s on s.key = b.stage_key where s.kind <> 'lost'
      ) x group by lead_id
    ),
    rev as (select lead_id, sum(amount)::float as total from sales where match_status = 'matched' group by lead_id)
    select ${group.key} as key, ${group.label} as label,
      count(*)::int as leads,
      count(*) filter (where b.first_response_at is not null or coalesce(r.maxpos,1) >= 3)::int as atendidos,
      count(*) filter (where coalesce(r.maxpos,1) >= 5)::int as qualificados,
      count(*) filter (where coalesce(r.maxpos,1) >= 6)::int as agendamentos,
      count(*) filter (where coalesce(r.maxpos,1) >= 8)::int as comparecimentos,
      count(*) filter (where coalesce(rv.total,0) > 0)::int as vendas,
      coalesce(sum(rv.total),0)::float as faturamento,
      round(avg(extract(epoch from (b.first_response_at - b.created_at))/60)::numeric, 1)::float as tempo_resp_min
    from base b
    left join reached r on r.lead_id = b.id
    left join rev rv on rv.lead_id = b.id
    ${group.join ?? sql``}
    group by 1, 2
    order by leads desc
  `);
  return rowsOf<FunnelRow>(res);
}

export const overview = (db: DB, u: SessionUser, f: Filters) => funnel(db, u, f, { key: sql`'total'`, label: sql`'Total'` }).then((r) => r[0] ?? null);

export const byUnit = (db: DB, u: SessionUser, f: Filters) =>
  funnel(db, u, f, { key: sql`b.unit_id`, label: sql`coalesce(un.name, 'Sem unidade')`, join: sql`left join units un on un.id = b.unit_id` });

export const bySeller = (db: DB, u: SessionUser, f: Filters) =>
  funnel(db, u, f, { key: sql`b.owner_id`, label: sql`coalesce(us.name, 'Sem responsável')`, join: sql`left join users us on us.id = b.owner_id` });

export const bySource = (db: DB, u: SessionUser, f: Filters) => funnel(db, u, f, { key: sql`b.source_platform`, label: sql`b.source_platform` });

export type CampaignRow = FunnelRow & { investimento: number; cpl: number | null; cpa: number | null; roas: number | null };

async function withSpend(db: DB, rows: FunnelRow[], f: Filters, level: "campaign" | "ad"): Promise<CampaignRow[]> {
  const res = await db.execute(level === "campaign"
    ? sql`select a.campaign_id as key, sum(i.spend)::float as spend from meta_ad_insights i join meta_ads a on a.id = i.ad_id
          where i.day >= ${f.from.toISOString().slice(0, 10)} and i.day < ${f.to.toISOString().slice(0, 10)} group by 1`
    : sql`select i.ad_id as key, sum(i.spend)::float as spend from meta_ad_insights i
          where i.day >= ${f.from.toISOString().slice(0, 10)} and i.day < ${f.to.toISOString().slice(0, 10)} group by 1`);
  const spend = new Map(rowsOf<{ key: string; spend: number }>(res).map((r) => [r.key, r.spend]));
  return rows.map((r) => {
    const inv = r.key ? spend.get(r.key) ?? 0 : 0;
    return { ...r, investimento: inv, cpl: inv && r.leads ? inv / r.leads : null, cpa: inv && r.vendas ? inv / r.vendas : null, roas: inv ? r.faturamento / inv : null };
  });
}

/** Tabela de inteligência de anúncios. Leads sem campanha identificada aparecem como "Origem desconhecida / parcial". */
export async function byCampaign(db: DB, u: SessionUser, f: Filters) {
  const rows = await funnel(db, u, f, {
    key: sql`b.campaign_id`, label: sql`coalesce(mc.name, case when b.campaign_id is null then 'Origem desconhecida / parcial' else 'Campanha ' || b.campaign_id end)`,
    join: sql`left join meta_campaigns mc on mc.id = b.campaign_id`,
  });
  return withSpend(db, rows, f, "campaign");
}

export async function byAd(db: DB, u: SessionUser, f: Filters) {
  const rows = await funnel(db, u, f, {
    key: sql`b.ad_id`, label: sql`coalesce(ma.name, case when b.ad_id is null then 'Sem anúncio identificado' else 'Anúncio ' || b.ad_id end)`,
    join: sql`left join meta_ads ma on ma.id = b.ad_id`,
  });
  return withSpend(db, rows, f, "ad");
}
