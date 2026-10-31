import { and, eq, type SQL } from "drizzle-orm";
import { leads } from "@/db/schema";
import type { SessionUser } from "./auth";

/**
 * Regra central de acesso a leads (evita vazamento entre unidades):
 * - diretoria/admin: rede toda
 * - gestor: somente leads da própria unidade
 * - vendedor: somente leads da própria unidade atribuídos a ele
 * Usuário sem unidade (e não diretoria/admin) não vê nada.
 */
export function leadScope(u: Pick<SessionUser, "id" | "role" | "unitId">): SQL | undefined {
  if (u.role === "diretoria" || u.role === "admin") return undefined;
  if (!u.unitId) return eq(leads.id, "__nenhum__");
  if (u.role === "gestor") return eq(leads.unitId, u.unitId);
  return and(eq(leads.unitId, u.unitId), eq(leads.ownerId, u.id));
}

export function canSeeLead(u: Pick<SessionUser, "id" | "role" | "unitId">, l: { unitId: string | null; ownerId: string | null }) {
  if (u.role === "diretoria" || u.role === "admin") return true;
  if (!u.unitId || l.unitId !== u.unitId) return false;
  return u.role === "gestor" || l.ownerId === u.id;
}

/** Unidades que o usuário pode filtrar */
export function unitScope(u: Pick<SessionUser, "role" | "unitId">): string | null | "all" {
  return u.role === "diretoria" || u.role === "admin" ? "all" : u.unitId;
}

export const canManage = (u: Pick<SessionUser, "role">) => u.role === "diretoria" || u.role === "admin" || u.role === "gestor";
export const isAdmin = (u: Pick<SessionUser, "role">) => u.role === "diretoria" || u.role === "admin";
