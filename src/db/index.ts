import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { PgliteDatabase } from "drizzle-orm/pglite";

export type DB = PgliteDatabase<typeof schema>;

const g = globalThis as unknown as { __db?: DB; __pglite?: PGlite };

/** Cria a conexão: Postgres real se DATABASE_URL existir; senão banco local embutido (PGlite). */
export function createDb(opts: { url?: string; dataDir?: string } = {}): { db: DB; pglite?: PGlite } {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    // O pooler do Supabase em modo transação (porta 6543) trava quando várias consultas
    // são enviadas em paralelo na mesma conexão (pipelining do postgres.js). O modo sessão
    // (porta 5432, mesmo host, IPv4) não tem essa limitação.
    const finalUrl = url.replace(/(\.pooler\.supabase\.com):6543\//, "$1:5432/");
    const client = postgres(finalUrl, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 10 });
    return { db: drizzlePg(client, { schema }) as unknown as DB };
  }
  const pglite = new PGlite(opts.dataDir ?? process.env.PGLITE_DIR ?? "./.data/pglite");
  return { db: drizzlePglite(pglite, { schema }), pglite };
}

export function getDb(): DB {
  if (!g.__db) {
    const { db, pglite } = createDb();
    g.__db = db;
    g.__pglite = pglite;
  }
  return g.__db;
}

export { schema };
