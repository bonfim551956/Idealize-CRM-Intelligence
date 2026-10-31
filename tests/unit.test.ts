import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { normalizeBrPhone, phoneTail8 } from "../src/lib/phone";
import { verifyMetaSignature, hashCpf } from "../src/lib/crypto";
import { splitWhatsAppWebhook, splitLeadgenWebhook } from "../src/server/ingest";
import { waWebhook } from "./helpers";

describe("telefone", () => {
  it("normaliza formatos brasileiros", () => {
    expect(normalizeBrPhone("5513999998888")).toBe("+5513999998888");
    expect(normalizeBrPhone("551399998888")).toBe("+5513999998888"); // wa_id legado sem o 9
    expect(normalizeBrPhone("(13) 99999-8888")).toBe("+5513999998888");
    expect(normalizeBrPhone("1332223333")).toBe("+551332223333"); // fixo
    expect(normalizeBrPhone("+1 415 555 0100")).toBeNull();
    expect(normalizeBrPhone("")).toBeNull();
    expect(phoneTail8("+5513999998888")).toBe("99998888");
  });
});

describe("assinatura do webhook Meta", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ a: 1 });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  it("aceita assinatura válida", () => expect(verifyMetaSignature(body, sig, secret)).toBe(true));
  it("rejeita corpo alterado, secret errado, header ausente ou malformado", () => {
    expect(verifyMetaSignature(body + " ", sig, secret)).toBe(false);
    expect(verifyMetaSignature(body, sig, "outro")).toBe(false);
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifyMetaSignature(body, sig, undefined)).toBe(false);
  });
});

describe("parsing de webhooks", () => {
  it("extrai mensagem e referral do Click-to-WhatsApp", () => {
    const items = splitWhatsAppWebhook(waWebhook({ msgId: "wamid.1", from: "5513999998888", pnid: "P1", adId: "120200", clid: "ABC" }));
    expect(items).toHaveLength(1);
    expect(items[0].dedupeKey).toBe("wa:wamid.1");
    expect(items[0].item.message.referral?.source_id).toBe("120200");
    expect(items[0].item.message.referral?.ctwa_clid).toBe("ABC");
    expect(items[0].item.phoneNumberId).toBe("P1");
  });
  it("ignora status de entrega e objetos de outro tipo", () => {
    expect(splitWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "x" }] } }] }] })).toHaveLength(0);
    expect(splitWhatsAppWebhook({ object: "page" })).toHaveLength(0);
  });
  it("extrai leadgen do webhook de página", () => {
    const r = splitLeadgenWebhook({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "LG1", page_id: "PG", form_id: "F1", ad_id: "AD1" } }] }] });
    expect(r).toEqual([{ dedupeKey: "leadgen:LG1", item: { leadgen_id: "LG1", page_id: "PG", form_id: "F1", ad_id: "AD1" } }]);
  });
  it("CPF vira hash e nunca é guardado puro", () => {
    expect(hashCpf("123.456.789-09")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCpf("123")).toBeNull();
  });
});
