import { NextResponse, after } from "next/server";
import { getDb } from "@/db";
import { verifyMetaSignature, safeEqual } from "@/lib/crypto";
import { enqueue, processInbox, splitWhatsAppWebhook, splitLeadgenWebhook } from "@/server/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificação da assinatura do webhook (handshake do painel do app Meta) */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge");
  if (mode === "subscribe" && safeEqual(token, process.env.META_WEBHOOK_VERIFY_TOKEN) && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

/** Recebe WhatsApp Cloud API (messages) e Página (leadgen). Valida assinatura, enfileira, responde rápido e processa depois. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return new Response("invalid signature", { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const db = getDb();
  let queued = 0;
  for (const { dedupeKey, item } of splitWhatsAppWebhook(body)) if ((await enqueue(db, "whatsapp", dedupeKey, item)).inserted) queued++;
  for (const { dedupeKey, item } of splitLeadgenWebhook(body)) if ((await enqueue(db, "leadgen", dedupeKey, item)).inserted) queued++;
  if (queued) after(() => processInbox(db).catch((e) => console.error("[inbox]", e)));
  return NextResponse.json({ ok: true, queued });
}
