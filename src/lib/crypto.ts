import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";

/** Valida X-Hub-Signature-256 da Meta: "sha256=" + HMAC-SHA256(app_secret, corpo bruto) */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!header || !appSecret) return false;
  const [algo, sig] = header.split("=");
  if (algo !== "sha256" || !sig) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256(v: string): string {
  return createHash("sha256").update(v, "utf8").digest("hex");
}

export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** CPF → hash (só dígitos). Nunca persistimos o CPF puro. */
export function hashCpf(cpf: string | null | undefined): string | null {
  const d = String(cpf ?? "").replace(/\D/g, "");
  return d.length === 11 ? sha256(`cpf:${d}`) : null;
}
