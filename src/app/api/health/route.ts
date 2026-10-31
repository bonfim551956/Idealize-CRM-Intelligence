import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rowsOf } from "@/server/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verifica a conexão com o banco (sem expor credenciais). */
export async function GET() {
  try {
    const r = rowsOf<{ n: number }>(await getDb().execute(sql`select count(*)::int as n from pipeline_stages`));
    return NextResponse.json({ ok: true, db: "ok", etapas: r[0]?.n ?? 0, modo: process.env.DATABASE_URL ? "postgres" : "local" });
  } catch (e) {
    const msg = String((e as Error).message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/g, "[url]").slice(0, 300);
    return NextResponse.json({ ok: false, db: "erro", detalhe: msg }, { status: 503 });
  }
}
