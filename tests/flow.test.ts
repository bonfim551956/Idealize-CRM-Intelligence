import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "../src/db";
import { leads, leadAttributions, webhookInbox, metaAds, sales, leadStageHistory, leadEvents, capiEvents, automationRules, users } from "../src/db/schema";
import { enqueue, processInbox, splitWhatsAppWebhook } from "../src/server/ingest";
import { moveStage, CrmError, assignLead, runInactivitySweep, createAppointment, setAppointmentStatus } from "../src/server/crm";
import { ingestSale, linkSale } from "../src/server/sales";
import { leadScope, canSeeLead } from "../src/server/scope";
import { byCampaign, overview } from "../src/server/metrics";
import { login, userFromToken } from "../src/server/auth";
import { freshDb, setupUnits, waWebhook } from "./helpers";

let db: DB; let ctx: Awaited<ReturnType<typeof setupUnits>>;

async function receive(w: ReturnType<typeof waWebhook>) {
  for (const { dedupeKey, item } of splitWhatsAppWebhook(w)) await enqueue(db, "whatsapp", dedupeKey, item);
  return processInbox(db);
}

beforeEach(async () => {
  db = await freshDb();
  ctx = await setupUnits(db);
  await db.insert(metaAds).values({ id: "AD-1", adsetId: "SET-1", campaignId: "CAMP-1", creativeId: "CR-1", name: "Anúncio 1" });
});

describe("Click-to-WhatsApp → lead", () => {
  it("cria lead na unidade do número, com atribuição confirmada e distribuído", async () => {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV", adId: "AD-1", clid: "CLID-1" }));
    const [l] = await db.select().from(leads);
    expect(l.unitId).toBe(ctx.sv.id);
    expect(l.sourcePlatform).toBe("whatsapp_ctwa");
    expect(l.attributionStatus).toBe("confirmed");
    expect([ctx.v1.id, ctx.v2.id]).toContain(l.ownerId);
    const [a] = await db.select().from(leadAttributions).where(eq(leadAttributions.leadId, l.id));
    expect(a).toMatchObject({ kind: "first_touch", adId: "AD-1", campaignId: "CAMP-1", adsetId: "SET-1", creativeId: "CR-1", ctwaClid: "CLID-1" });
  });

  it("anúncio fora do catálogo e sem token → atribuição PARCIAL (só o ID), nunca inventa campanha", async () => {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV", adId: "AD-DESCONHECIDO" }));
    const [l] = await db.select().from(leads);
    const [a] = await db.select().from(leadAttributions);
    expect(l.attributionStatus).toBe("partial");
    expect(a.adId).toBe("AD-DESCONHECIDO");
    expect(a.campaignId).toBeNull();
  });

  it("mensagem orgânica → origem desconhecida", async () => {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV" }));
    const [l] = await db.select().from(leads);
    expect(l.sourcePlatform).toBe("whatsapp_organic");
    expect(l.attributionStatus).toBe("unknown");
  });

  it("webhook repetido não duplica; 2ª mensagem do mesmo contato não cria novo lead", async () => {
    const w = waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV", adId: "AD-1" });
    await receive(w); await receive(w);
    await receive(waWebhook({ msgId: "m2", from: "551399990001", pnid: "PNID-SV", text: "de novo" })); // mesmo número, formato legado
    expect(await db.select().from(leads)).toHaveLength(1);
    expect(await db.select().from(webhookInbox)).toHaveLength(2);
    expect((await db.select().from(leadEvents).where(eq(leadEvents.type, "message_in")))).toHaveLength(2);
  });

  it("novo clique em outro anúncio vira last_touch sem apagar o first_touch", async () => {
    await db.insert(metaAds).values({ id: "AD-2", campaignId: "CAMP-2", name: "Anúncio 2" });
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV", adId: "AD-1" }));
    await receive(waWebhook({ msgId: "m2", from: "5513999990001", pnid: "PNID-SV", adId: "AD-2" }));
    const attrs = await db.select().from(leadAttributions);
    expect(attrs.map((a) => `${a.kind}:${a.adId}`).sort()).toEqual(["first_touch:AD-1", "last_touch:AD-2"]);
  });

  it("rodízio alterna vendedores disponíveis e pula indisponíveis", async () => {
    for (let i = 1; i <= 4; i++) await receive(waWebhook({ msgId: `m${i}`, from: `551399999000${i}`, pnid: "PNID-SV" }));
    const owners = (await db.select().from(leads)).map((l) => l.ownerId);
    expect(new Set(owners).size).toBe(2);
    await db.update(users).set({ available: false }).where(eq(users.id, ctx.v1.id));
    await receive(waWebhook({ msgId: "m9", from: "5513999990009", pnid: "PNID-SV" }));
    const [newest] = await db.select().from(leads).innerJoin(leadEvents, eq(leadEvents.leadId, leads.id)).where(eq(leadEvents.externalId, "wa:m9"));
    expect(newest.leads.ownerId).toBe(ctx.v2.id);
  });

  it("falha no processamento vai para retentativa e não perde o item", async () => {
    await enqueue(db, "whatsapp", "wa:quebrado", { message: null });
    const r = await processInbox(db);
    expect(r.failed).toBe(1);
    const [it] = await db.select().from(webhookInbox);
    expect(it.status).toBe("failed");
    expect(it.attempts).toBe(1);
    expect(it.lastError).toBeTruthy();
  });
});

describe("pipeline", () => {
  it("perda exige motivo; histórico registrado; venda manual bloqueada para vendedor", async () => {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV" }));
    const [l] = await db.select().from(leads);
    await expect(moveStage(db, l.id, "nao_convertido", { byUserId: ctx.v1.id })).rejects.toBeInstanceOf(CrmError);
    await expect(moveStage(db, l.id, "venda_concluida", { byUserId: ctx.v1.id, actorRole: "vendedor", reason: "x" })).rejects.toBeInstanceOf(CrmError);
    await moveStage(db, l.id, "nao_convertido", { byUserId: ctx.v1.id, reason: "Preço" });
    const [after] = await db.select().from(leads);
    expect(after.status).toBe("lost");
    expect(after.lostReason).toBe("Preço");
    expect((await db.select().from(leadStageHistory)).length).toBeGreaterThanOrEqual(1);
  });

  it("agendamento e comparecimento movem etapas pelas automações", async () => {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV" }));
    const [l] = await db.select().from(leads);
    const a = await createAppointment(db, l.id, new Date(Date.now() + 86400_000), l.ownerId!);
    expect((await db.select().from(leads))[0].stageKey).toBe("agendamento_realizado");
    await setAppointmentStatus(db, a.id, "confirmado", l.ownerId!);
    await setAppointmentStatus(db, a.id, "compareceu", l.ownerId!);
    expect((await db.select().from(leads))[0].stageKey).toBe("compareceu");
  });

  it("não deixa outro vendedor pegar lead com dono sem autorização; bloqueia vendedor de outra unidade", async () => {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV" }));
    const [l] = await db.select().from(leads);
    const other = l.ownerId === ctx.v1.id ? ctx.v2 : ctx.v1;
    await expect(assignLead(db, l.id, other.id, "manual")).rejects.toThrow("já possui responsável");
    await expect(assignLead(db, l.id, ctx.vc.id, "manual", { force: true })).rejects.toThrow("outra unidade");
    await assignLead(db, l.id, other.id, "manual", { force: true, byUserId: ctx.g.id });
    expect((await db.select().from(leads))[0].ownerId).toBe(other.id);
  });

  it("varredura de inatividade gera alerta uma única vez", async () => {
    await db.update(users).set({ available: false }); // ninguém disponível → lead fica sem dono
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV" }));
    await db.update(automationRules).set({ params: { stageKey: "aguardando_atendimento", minutes: 2 } }).where(eq(automationRules.key, "sem_atendimento_alerta"));
    const later = new Date(Date.now() + 10 * 60_000);
    expect((await runInactivitySweep(db, later)).alerts).toBe(1);
    expect((await runInactivitySweep(db, later)).alerts).toBe(0);
  });
});

describe("vendas ADM/PDV", () => {
  async function leadComDono() {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV", adId: "AD-1", clid: "CLID" }));
    return (await db.select().from(leads))[0];
  }

  it("vincula venda pelo telefone, move para Venda concluída, soma faturamento e não duplica", async () => {
    const l = await leadComDono();
    const sale = { source: "pdv" as const, externalId: "OS-100", phone: "(13) 99999-0001", amount: 899.9, soldAt: new Date(Date.now() + 60_000), unitSlug: "sao-vicente" };
    const r1 = await ingestSale(db, sale);
    const r2 = await ingestSale(db, sale);
    expect(r1.sale.matchStatus).toBe("matched");
    expect(r2.duplicate).toBe(true);
    expect(await db.select().from(sales)).toHaveLength(1);
    const [after] = await db.select().from(leads).where(eq(leads.id, l.id));
    expect(after.stageKey).toBe("venda_concluida");
    expect(Number(after.wonAmount)).toBeCloseTo(899.9);
    // evento CAPI preparado mas BLOQUEADO (mapeamento não validado / envio desligado)
    const ev = (await db.select().from(capiEvents)).find((e) => e.crmStage === "venda_concluida");
    expect(ev?.status).toBe("blocked");
  });

  it("só 8 dígitos batendo → revisão manual, sem vincular automaticamente", async () => {
    await leadComDono();
    const r = await ingestSale(db, { source: "adm", externalId: "A1", phone: "(11) 99999-0001", amount: 300, soldAt: new Date(Date.now() + 60_000) });
    expect(r.sale.matchStatus).toBe("pending_review");
    expect((await db.select().from(leads))[0].stageKey).not.toBe("venda_concluida");
    await linkSale(db, r.sale.id, r.sale.leadId!, "revisao_manual", null, ctx.g.id);
    await expect(linkSale(db, r.sale.id, r.sale.leadId!, "revisao_manual", null, ctx.g.id)).rejects.toThrow("já vinculada");
  });

  it("venda sem correspondência fica como não vinculada (não cria lead nem venda fictícia)", async () => {
    const r = await ingestSale(db, { source: "adm", externalId: "A2", phone: "11988887777", amount: 100, soldAt: new Date() });
    expect(r.sale.matchStatus).toBe("unmatched");
    expect(await db.select().from(leads)).toHaveLength(0);
  });

  it("dashboard calcula conversão e faturamento por campanha", async () => {
    await leadComDono();
    await ingestSale(db, { source: "pdv", externalId: "OS-1", phone: "13999990001", amount: 1000, soldAt: new Date(Date.now() + 60_000), unitSlug: "sao-vicente" });
    const f = { from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 86400_000) };
    const rows = await byCampaign(db, ctx.dir, f);
    const c = rows.find((r) => r.key === "CAMP-1")!;
    expect(c).toMatchObject({ leads: 1, vendas: 1, faturamento: 1000 });
    expect((await overview(db, ctx.dir, f))!.agendamentos).toBe(1); // venda implica ter passado pelas etapas anteriores
  });
});

describe("permissões multiunidade", () => {
  it("gestor e vendedor nunca veem leads de outra unidade", async () => {
    await receive(waWebhook({ msgId: "m1", from: "5513999990001", pnid: "PNID-SV" }));
    await receive(waWebhook({ msgId: "m2", from: "5519999990002", pnid: "PNID-CPS" }));
    const all = await db.select().from(leads);
    const count = async (u: typeof ctx.v1) => (await db.select().from(leads).where(leadScope(u))).length;
    expect(await count(ctx.dir)).toBe(2);
    expect(await count(ctx.g)).toBe(1);
    expect(await count(ctx.vc)).toBe(1);
    const svLead = all.find((l) => l.unitId === ctx.sv.id)!;
    expect(canSeeLead(ctx.vc, svLead)).toBe(false);
    const notMine = svLead.ownerId === ctx.v1.id ? ctx.v2 : ctx.v1;
    expect(canSeeLead(notMine, svLead)).toBe(false);
    expect(canSeeLead(ctx.g, svLead)).toBe(true);
    const f = { from: new Date(Date.now() - 86400_000), to: new Date(Date.now() + 86400_000) };
    expect((await overview(db, ctx.g, f))!.leads).toBe(1);
  });

  it("login: senha errada falha; sessão válida identifica o usuário; inativo não entra", async () => {
    expect(await login(db, "v1", "errada")).toBeNull();
    const s = await login(db, "V1", "x");
    expect((await userFromToken(db, s!.token))?.id).toBe(ctx.v1.id);
    await db.update(users).set({ active: false }).where(eq(users.id, ctx.v1.id));
    expect(await userFromToken(db, s!.token)).toBeNull();
  });
});

describe("dados de teste", () => {
  it("gerar e apagar mexe só no que é teste", async () => {
    const { seedTestData, deleteTestData } = await import("../src/server/testdata");
    await receive(waWebhook({ msgId: "real-1", from: "5513999990001", pnid: "PNID-SV" })); // lead real
    await seedTestData(db, { leadsPerUnit: 2, password: "aleatoria-123456", createDirector: false });
    expect((await db.select().from(leads)).length).toBeGreaterThan(1);
    await deleteTestData(db);
    const rest = await db.select().from(leads);
    expect(rest).toHaveLength(1);
    expect(rest[0].isTest).toBe(false);
    expect((await db.select().from(metaAds)).filter((a) => a.id.startsWith("TESTE-"))).toHaveLength(0);
  });
});
