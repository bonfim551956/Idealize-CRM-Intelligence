import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../src/db";
import { bootstrap } from "../src/server/bootstrap";
import { mkdirSync } from "node:fs";

export async function runMigrations(opts: { url?: string; dataDir?: string } = {}) {
  if (!opts.url && !process.env.DATABASE_URL && !opts.dataDir?.startsWith("memory://")) mkdirSync("./.data", { recursive: true });
  const { db, pglite } = createDb(opts);
  if (pglite) await migratePglite(db, { migrationsFolder: "./drizzle" });
  else await migratePg(db as never, { migrationsFolder: "./drizzle" });
  await bootstrap(db);
  return { db, pglite };
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations().then(async ({ pglite }) => { await pglite?.close(); console.log("Migrações aplicadas + etapas/regras/unidades padrão."); });
}
