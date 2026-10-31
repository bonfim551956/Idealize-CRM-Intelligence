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
    const client = postgres(url, { max: 5, prepare: false });
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
