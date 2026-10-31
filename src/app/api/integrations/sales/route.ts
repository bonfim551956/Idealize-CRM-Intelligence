import { NextResponse, after } from "next/server";
import { getDb } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { enqueue, processInbox } from "@/server/ingest";
import { SaleInputSchema } from "@/server/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada de vendas do Sistema ADM e do PDV Idealize.
 * Header: X-Integration-Key: <SALES_INGEST_KEY>. Corpo: uma venda ou { sales: [...] } (máx. 500).
 * Idempotente por (source, externalId): reenviar a mesma venda não duplica.
 */
export async function POST(req: Request) {
  if (!process.env.SALES_INGEST_KEY || !safeEqual(req.headers.get("x-integration-key"), process.env.SALES_INGEST_KEY)) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const list = Array.isArray((body as { sales?: unknown[] })?.sales) ? (body as { sales: unknown[] }).sales : [body];
  if (list.length > 500) return NextResponse.json({ error: "máximo 500 vendas por envio" }, { status: 413 });
  const db = getDb();
  const errors: { index: number; error: string }[] = [];
  let queued = 0;
  for (const [i, raw] of list.entries()) {
    const p = SaleInputSchema.safeParse(raw);
    if (!p.success) { errors.push({ index: i, error: p.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") }); continue; }
    const r = await enqueue(db, p.data.source === "adm" ? "sales_adm" : "sales_pdv", `sale:${p.data.source}:${p.data.externalId}`, raw);
    if (r.inserted) queued++;
  }
  if (queued) after(() => processInbox(db).catch((e) => console.error("[inbox]", e)));
  return NextResponse.json({ ok: errors.length === 0, queued, errors }, { status: errors.length && !queued ? 422 : 200 });
}
