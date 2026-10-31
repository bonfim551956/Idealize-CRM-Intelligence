import type { DB } from "@/db";
import { metaAds, metaAdsets, metaCampaigns, metaCreatives, metaAdInsights } from "@/db/schema";

/** Cliente mínimo da Graph/Marketing API. Token só no servidor, enviado no header (nunca na URL). */
export function metaConfigured() {
  return Boolean(process.env.META_SYSTEM_USER_TOKEN);
}

export class MetaApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) { super(message); }
}

async function graph<T>(path: string, params: Record<string, string> = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) throw new MetaApiError("META_SYSTEM_USER_TOKEN não configurado", 0, null);
  const v = process.env.META_GRAPH_VERSION ?? "v23.0";
  const url = path.startsWith("https://") ? path : `https://graph.facebook.com/${v}/${path}?${new URLSearchParams(params)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new MetaApiError((body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`, res.status, body);
  return body as T;
}

async function graphAll<T>(path: string, params: Record<string, string>, fetchImpl?: typeof fetch): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(path, params, fetchImpl);
  out.push(...page.data);
  let guard = 0;
  while (page.paging?.next && guard++ < 200) {
    page = await graph(page.paging.next, {}, fetchImpl);
    out.push(...page.data);
  }
  return out;
}

export type AdHierarchy = { adId: string; adName?: string; adsetId?: string; campaignId?: string; creativeId?: string; accountId?: string };

/** Resolve campanha/conjunto/criativo a partir do ID do anúncio (ex.: referral.source_id do Click-to-WhatsApp) */
export async function resolveAd(db: DB, adId: string, fetchImpl?: typeof fetch): Promise<AdHierarchy> {
  const ad = await graph<{ id: string; name?: string; adset_id?: string; campaign_id?: string; account_id?: string; creative?: { id: string; name?: string; thumbnail_url?: string } }>(
    adId, { fields: "id,name,adset_id,campaign_id,account_id,creative{id,name,thumbnail_url}" }, fetchImpl);
  const now = new Date();
  await db.insert(metaAds).values({ id: ad.id, name: ad.name, adsetId: ad.adset_id, campaignId: ad.campaign_id, creativeId: ad.creative?.id, syncedAt: now })
    .onConflictDoUpdate({ target: metaAds.id, set: { name: ad.name, adsetId: ad.adset_id, campaignId: ad.campaign_id, creativeId: ad.creative?.id, syncedAt: now } });
  if (ad.creative?.id) {
    await db.insert(metaCreatives).values({ id: ad.creative.id, name: ad.creative.name, thumbnailUrl: ad.creative.thumbnail_url, syncedAt: now })
      .onConflictDoUpdate({ target: metaCreatives.id, set: { name: ad.creative.name, thumbnailUrl: ad.creative.thumbnail_url, syncedAt: now } });
  }
  return { adId: ad.id, adName: ad.name, adsetId: ad.adset_id, campaignId: ad.campaign_id, creativeId: ad.creative?.id, accountId: ad.account_id };
}

export type LeadgenData = {
  id: string; created_time?: string; ad_id?: string; adset_id?: string; campaign_id?: string; form_id?: string;
  field_data?: { name: string; values: string[] }[];
};

/** Busca os dados autorizados do lead de formulário (requer leads_retrieval) */
export function fetchLeadgen(leadgenId: string, fetchImpl?: typeof fetch) {
  return graph<LeadgenData>(leadgenId, { fields: "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data" }, fetchImpl);
}

/** Sincroniza campanhas, conjuntos e anúncios de uma conta (act_XXXX) */
export async function syncAccountStructure(db: DB, adAccountId: string, fetchImpl?: typeof fetch) {
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const now = new Date();
  const camps = await graphAll<{ id: string; name: string; effective_status?: string }>(`${act}/campaigns`, { fields: "id,name,effective_status", limit: "200" }, fetchImpl);
  for (const c of camps) await db.insert(metaCampaigns).values({ id: c.id, adAccountId: act, name: c.name, status: c.effective_status, syncedAt: now })
    .onConflictDoUpdate({ target: metaCampaigns.id, set: { name: c.name, status: c.effective_status, syncedAt: now } });
  const sets = await graphAll<{ id: string; name: string; campaign_id: string; effective_status?: string }>(`${act}/adsets`, { fields: "id,name,campaign_id,effective_status", limit: "200" }, fetchImpl);
  for (const s of sets) await db.insert(metaAdsets).values({ id: s.id, campaignId: s.campaign_id, name: s.name, status: s.effective_status, syncedAt: now })
    .onConflictDoUpdate({ target: metaAdsets.id, set: { name: s.name, status: s.effective_status, syncedAt: now } });
  const ads = await graphAll<{ id: string; name: string; adset_id: string; campaign_id: string; effective_status?: string; creative?: { id: string } }>(`${act}/ads`, { fields: "id,name,adset_id,campaign_id,effective_status,creative{id}", limit: "200" }, fetchImpl);
  for (const a of ads) await db.insert(metaAds).values({ id: a.id, name: a.name, adsetId: a.adset_id, campaignId: a.campaign_id, creativeId: a.creative?.id, status: a.effective_status, syncedAt: now })
    .onConflictDoUpdate({ target: metaAds.id, set: { name: a.name, adsetId: a.adset_id, campaignId: a.campaign_id, creativeId: a.creative?.id, status: a.effective_status, syncedAt: now } });
  return { campaigns: camps.length, adsets: sets.length, ads: ads.length };
}

/** Insights diários por anúncio (investimento, impressões, alcance, cliques) */
export async function syncInsights(db: DB, adAccountId: string, since: string, until: string, fetchImpl?: typeof fetch) {
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const rows = await graphAll<{ ad_id: string; date_start: string; spend?: string; impressions?: string; reach?: string; clicks?: string }>(
    `${act}/insights`, { level: "ad", time_increment: "1", fields: "ad_id,spend,impressions,reach,clicks", time_range: JSON.stringify({ since, until }), limit: "500" }, fetchImpl);
  const now = new Date();
  for (const r of rows) {
    const v = { adId: r.ad_id, day: r.date_start, spend: r.spend ?? "0", impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0), clicks: Number(r.clicks ?? 0), syncedAt: now };
    await db.insert(metaAdInsights).values(v).onConflictDoUpdate({ target: [metaAdInsights.adId, metaAdInsights.day], set: { spend: v.spend, impressions: v.impressions, reach: v.reach, clicks: v.clicks, syncedAt: now } });
  }
  return { rows: rows.length };
}

