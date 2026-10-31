import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { safeEqual } from "@/lib/crypto";
import { processInbox } from "@/server/ingest";
import { runInactivitySweep } from "@/server/crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Chamado por agendador (ex.: Vercel Cron a cada minuto) com Authorization: Bearer <CRON_SECRET> */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!process.env.CRON_SECRET || !safeEqual(auth, process.env.CRON_SECRET)) return new Response("unauthorized", { status: 401 });
  const db = getDb();
  const inbox = await processInbox(db);
  const sweep = await runInactivitySweep(db);
  return NextResponse.json({ inbox, sweep });
}
