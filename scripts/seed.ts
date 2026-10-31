/**
 * Ambiente de TESTE: cria usuários de teste e leads FICTÍCIOS (is_test = true, IDs de anúncio "TESTE-...").
 * Nunca usa dados reais de clientes. Rode só em banco local/homologação.
 */
import { runMigrations } from "./migrate";
import { seedTestData } from "../src/server/testdata";

runMigrations().then(async ({ db, pglite }) => {
  if (process.env.DATABASE_URL && process.env.ALLOW_TEST_SEED !== "true") throw new Error("Seed bloqueado fora do banco local (defina ALLOW_TEST_SEED=true em homologação)");
  const r = await seedTestData(db);
  console.log(JSON.stringify(r, null, 2));
  await pglite?.close();
});
