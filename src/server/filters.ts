import type { Filters } from "./metrics";
import type { SessionUser } from "./auth";
import { isAdmin } from "./scope";

export type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export function parseFilters(sp: SP, u: SessionUser): Filters & { days: number } {
  const days = Math.min(Math.max(Number(one(sp.dias) ?? 30) || 30, 1), 365);
  const to = one(sp.ate) ? new Date(`${one(sp.ate)}T23:59:59-03:00`) : new Date(Date.now() + 60_000);
  const from = one(sp.de) ? new Date(`${one(sp.de)}T00:00:00-03:00`) : new Date(to.getTime() - days * 86400_000);
  return {
    days, from, to,
    unitId: isAdmin(u) ? one(sp.unidade) ?? null : u.unitId,
    ownerId: one(sp.vendedor) ?? null,
    campaignId: one(sp.campanha) ?? null,
    source: one(sp.origem) ?? null,
    includeTest: one(sp.teste) === "1",
  };
}
