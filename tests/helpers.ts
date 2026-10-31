import { runMigrations } from "../scripts/migrate";
import { users, units, unitRoutes } from "../src/db/schema";
import { hashPassword } from "../src/server/auth";
import type { DB } from "../src/db";

export async function freshDb() {
  const { db } = await runMigrations({ dataDir: "memory://" });
  return db;
}

export async function setupUnits(db: DB) {
  const all = await db.select().from(units);
  const sv = all.find((u) => u.slug === "sao-vicente")!;
  const cps = all.find((u) => u.slug === "campinas")!;
  const pw = await hashPassword("x");
  const [v1] = await db.insert(users).values({ username: "v1", name: "V1", passwordHash: pw, role: "vendedor", unitId: sv.id }).returning();
  const [v2] = await db.insert(users).values({ username: "v2", name: "V2", passwordHash: pw, role: "vendedor", unitId: sv.id }).returning();
  const [vc] = await db.insert(users).values({ username: "vc", name: "VC", passwordHash: pw, role: "vendedor", unitId: cps.id }).returning();
  const [g] = await db.insert(users).values({ username: "gsv", name: "Gestor SV", passwordHash: pw, role: "gestor", unitId: sv.id }).returning();
  const [dir] = await db.insert(users).values({ username: "dir", name: "Dir", passwordHash: pw, role: "diretoria" }).returning();
  await db.insert(unitRoutes).values([{ sourceType: "wa_phone_number_id", value: "PNID-SV", unitId: sv.id }, { sourceType: "wa_phone_number_id", value: "PNID-CPS", unitId: cps.id }]);
  return { sv, cps, v1, v2, vc, g, dir };
}

export function waWebhook(opts: { msgId: string; from: string; pnid: string; adId?: string; clid?: string; text?: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "5513000000000", phone_number_id: opts.pnid },
      contacts: [{ profile: { name: "Cliente Fictício" }, wa_id: opts.from }],
      messages: [{ from: opts.from, id: opts.msgId, timestamp: "1730000000", type: "text", text: { body: opts.text ?? "Oi" },
        ...(opts.adId ? { referral: { source_type: "ad", source_id: opts.adId, source_url: "https://fb.me/x", headline: "Promo", ctwa_clid: opts.clid ?? "CLID" } } : {}) }],
    } }] }],
  };
}
