import { eq, sql, like } from "drizzle-orm";
import type { DB } from "@/db";
import { units, users, unitRoutes, metaCampaigns, metaAdsets, metaAds, metaCreatives, metaAdInsights, leads, contacts, leadEvents } from "@/db/schema";
import { hashPassword } from "./auth";
import { enqueue, processInbox, splitWhatsAppWebhook } from "./ingest";
import { moveStage, touchActivity, createAppointment, setAppointmentStatus } from "./crm";
import { ingestSale } from "./sales";

/** Gerador determinístico (mesmos dados a cada execução) */
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

export const TEST_PASSWORD = "teste-local-123";

export async function seedTestData(db: DB, opts: { leadsPerUnit?: number; password?: string; createDirector?: boolean } = {}) {
  const r = rng(42);
  const allUnits = await db.select().from(units);
  const pw = await hashPassword(opts.password ?? TEST_PASSWORD);
  if (opts.createDirector !== false) await db.insert(users).values({ username: "diretoria.teste", name: "Diretoria (teste)", passwordHash: pw, role: "diretoria" }).onConflictDoNothing();
  const sellersByUnit: Record<string, string[]> = {};
  for (const u of allUnits) {
    await db.insert(users).values({ username: `gestor.${u.slug}`, name: `Gestor ${u.name} (teste)`, passwordHash: pw, role: "gestor", unitId: u.id }).onConflictDoNothing();
    for (const n of [1, 2]) await db.insert(users).values({ username: `vendedor${n}.${u.slug}`, name: `Vendedor ${n} ${u.name} (teste)`, passwordHash: pw, role: "vendedor", unitId: u.id }).onConflictDoNothing();
    await db.insert(unitRoutes).values({ sourceType: "wa_phone_number_id", value: `TESTE-WA-${u.slug}`, unitId: u.id }).onConflictDoNothing();
    sellersByUnit[u.id] = (await db.select().from(users).where(eq(users.unitId, u.id))).filter((x) => x.role === "vendedor").map((x) => x.id);
  }
  // Catálogo fictício (prefixo TESTE-) — substitui-se pelo real ao sincronizar a Marketing API
  const camps = [
    { id: "TESTE-C1", name: "[TESTE] Óculos 2 por R$199,90" },
    { id: "TESTE-C2", name: "[TESTE] Exame de vista + armação" },
    { id: "TESTE-C3", name: "[TESTE] Multifocal 10x sem juros" },
  ];
  for (const c of camps) {
    await db.insert(metaCampaigns).values({ ...c, adAccountId: "act_TESTE", status: "ACTIVE" }).onConflictDoNothing();
    for (const k of [1, 2]) {
      const adset = `${c.id}-S${k}`, ad = `${c.id}-A${k}`, cr = `${c.id}-CR${k}`;
      await db.insert(metaAdsets).values({ id: adset, campaignId: c.id, name: `${c.name} · Público ${k}` }).onConflictDoNothing();
      await db.insert(metaCreatives).values({ id: cr, name: k === 1 ? "Vídeo depoimento" : "Carrossel preços" }).onConflictDoNothing();
      await db.insert(metaAds).values({ id: ad, adsetId: adset, campaignId: c.id, creativeId: cr, name: `${c.name} · ${k === 1 ? "Vídeo" : "Carrossel"}` }).onConflictDoNothing();
      for (let d = 0; d < 30; d++) {
        const day = new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
        await db.insert(metaAdInsights).values({ adId: ad, day, spend: (20 + r() * 60).toFixed(2), impressions: Math.floor(2000 + r() * 4000), reach: Math.floor(1500 + r() * 3000), clicks: Math.floor(30 + r() * 90) }).onConflictDoNothing();
      }
    }
  }
  const firstNames = ["Ana", "Bruno", "Carla", "Diego", "Elaine", "Fábio", "Gabi", "Hugo", "Isa", "João", "Karen", "Lucas", "Maria", "Nina", "Otávio", "Paula"];
  let created = 0;
  const perUnit = opts.leadsPerUnit ?? 18;
  for (const u of allUnits) {
    for (let i = 0; i < perUnit; i++) {
      const isAd = r() < 0.8;
      const camp = camps[Math.floor(r() * camps.length)];
      const ad = `${camp.id}-A${r() < 0.5 ? 1 : 2}`;
      const phone = `55${["13", "19", "15", "19"][allUnits.indexOf(u)]}9${String(10000000 + Math.floor(r() * 89999999))}`;
      const msgId = `TESTE-wamid-${u.slug}-${i}`;
      const body = {
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: {
          messaging_product: "whatsapp", metadata: { phone_number_id: `TESTE-WA-${u.slug}` },
          contacts: [{ wa_id: phone, profile: { name: `${firstNames[Math.floor(r() * firstNames.length)]} Teste` } }],
          messages: [{ from: phone, id: msgId, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Olá! Quero saber mais (mensagem fictícia)" },
            ...(isAd ? { referral: { source_type: "ad", source_id: ad, source_url: "https://fb.me/teste", headline: camp.name, ctwa_clid: `TESTE-clid-${u.slug}-${i}` } } : {}) }],
        } }] }],
      };
      await enqueue(db, "whatsapp", `wa:${msgId}`, splitWhatsAppWebhook(body)[0].item);
      created++;
    }
  }
  await processInbox(db, { limit: 1000 });
  // só os leads nascidos das mensagens fictícias (nunca toca em leads reais existentes)
  const all = (await db.selectDistinct({ l: leads }).from(leads).innerJoin(leadEvents, eq(leadEvents.leadId, leads.id))
    .where(like(leadEvents.externalId, "wa:TESTE-wamid-%"))).map((x) => x.l);
  for (const [idx, l] of all.entries()) {
    await db.update(leads).set({ isTest: true }).where(eq(leads.id, l.id));
    await db.update(contacts).set({ isTest: true }).where(eq(contacts.id, l.contactId));
    const owner = l.ownerId ?? sellersByUnit[l.unitId!]?.[0];
    if (!owner) continue;
    const p = r();
    if (p < 0.12) continue; // fica em novo lead
    await touchActivity(db, l.id, owner);
    if (p < 0.25) { await moveStage(db, l.id, "nao_convertido", { byUserId: owner, reason: "Só pesquisando preço (teste)" }); continue; }
    await moveStage(db, l.id, "cliente_interessado", { byUserId: owner });
    if (p < 0.4) continue;
    await moveStage(db, l.id, "qualificado", { byUserId: owner });
    if (p < 0.5) continue;
    const appt = await createAppointment(db, l.id, new Date(Date.now() + 86400_000), owner);
    if (p < 0.6) continue;
    await setAppointmentStatus(db, appt.id, "confirmado", owner);
    if (p < 0.68) { await setAppointmentStatus(db, appt.id, "nao_compareceu", owner); continue; }
    await setAppointmentStatus(db, appt.id, "compareceu", owner);
    await moveStage(db, l.id, "proposta_apresentada", { byUserId: owner });
    if (p < 0.78) continue;
    const [c] = await db.select().from(contacts).where(eq(contacts.id, l.contactId));
    const unit = allUnits.find((x) => x.id === l.unitId)!;
    await ingestSale(db, { source: idx % 2 ? "pdv" : "adm", externalId: `TESTE-V${idx}`, phone: c.phone, amount: Math.round(199.9 + r() * 1400), soldAt: new Date(Date.now() + 1000), unitSlug: unit.slug, sellerName: "Teste", isTest: true });
  }
  // espalha a criação nos últimos 30 dias para o dashboard ter série temporal
  for (const l of all) {
    const createdAt = new Date(Date.now() - Math.floor(r() * 28) * 86400_000 - 3600_000);
    const [cur] = await db.select().from(leads).where(eq(leads.id, l.id));
    await db.update(leads).set({ createdAt, firstResponseAt: cur.firstResponseAt ? new Date(createdAt.getTime() + Math.floor(1 + r() * 25) * 60_000) : null }).where(eq(leads.id, l.id));
  }
  return { usuarios: "diretoria.teste / gestor.<unidade> / vendedor1.<unidade>", senha: opts.password ? "(aleatória)" : TEST_PASSWORD, leads: created };
}

/** Remove TODOS os dados fictícios (is_test / prefixo TESTE- / usuários "(teste)"). Dados reais não são tocados. */
export async function deleteTestData(db: DB) {
  const q = (s: string) => db.execute(sql.raw(s));
  const testLeads = "select id from leads where is_test = true";
  await q(`delete from capi_events where lead_id in (${testLeads})`);
  await q(`delete from lead_events where lead_id in (${testLeads})`);
  await q(`delete from lead_stage_history where lead_id in (${testLeads})`);
  await q(`delete from lead_attributions where lead_id in (${testLeads})`);
  await q(`delete from assignments where lead_id in (${testLeads})`);
  await q(`delete from appointments where lead_id in (${testLeads})`);
  await q(`delete from sales where is_test = true or lead_id in (${testLeads})`);
  await q(`delete from leads where is_test = true`);
  await q(`delete from contacts where is_test = true and id not in (select contact_id from leads)`);
  await q(`delete from webhook_inbox where dedupe_key like '%TESTE-%'`);
  await q(`delete from meta_ad_insights where ad_id like 'TESTE-%'`);
  await q(`delete from meta_ads where id like 'TESTE-%'`);
  await q(`delete from meta_adsets where id like 'TESTE-%'`);
  await q(`delete from meta_creatives where id like 'TESTE-%'`);
  await q(`delete from meta_campaigns where id like 'TESTE-%'`);
  await q(`delete from unit_routes where value like 'TESTE-%'`);
  await q(`update distribution_rules set cursor_user_id = null where cursor_user_id in (select id from users where name like '%(teste)')`);
  await q(`delete from sessions where user_id in (select id from users where name like '%(teste)')`);
  await q(`delete from users where name like '%(teste)' and id not in (select user_id from assignments) and id not in (select owner_id from leads where owner_id is not null)`);
}
