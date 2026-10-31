import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import type { DB } from "@/db";
import { users, sessions } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { audit } from "./crm";

export const SESSION_COOKIE = "icrm_session";
const SESSION_HOURS = 12;

export type SessionUser = typeof users.$inferSelect;

const DUMMY_HASH = bcrypt.hashSync("dummy-password", 10);
export const hashPassword = (p: string) => bcrypt.hash(p, 12);

export async function login(db: DB, username: string, password: string) {
  const [u] = await db.select().from(users).where(eq(users.username, username.trim().toLowerCase())).limit(1);
  // compara mesmo quando o usuário não existe (evita descobrir usuários pelo tempo de resposta)
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok || !u.active) { await audit(db, u?.id ?? null, "auth.login_failed", "user", u?.id ?? null, { username }); return null; }
  const token = randomToken();
  await db.insert(sessions).values({ tokenHash: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) });
  await audit(db, u.id, "auth.login", "user", u.id);
  return { token, user: u, maxAge: SESSION_HOURS * 3600 };
}

export async function userFromToken(db: DB, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db.select({ u: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  const u = rows[0]?.u;
  return u && u.active ? u : null;
}

export async function logout(db: DB, token: string | undefined) {
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}
