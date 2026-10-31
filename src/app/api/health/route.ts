import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { getDb } from "@/db";
import { rowsOf } from "@/server/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/g, "[url]").slice(0, 300);

/** Verifica a conexão com o banco (sem expor credenciais). Se o pooler estiver errado, testa o alternativo e diz qual usar. */
export async function GET() {
  const url = process.env.DATABASE_URL;
  if (!url && process.env.VERCEL) return NextResponse.json({ ok: false, db: "erro", detalhe: "DATABASE_URL não configurada na Vercel" }, { status: 503 });
  try {
    const r = rowsOf<{ n: number }>(await getDb().execute(sql`select count(*)::int as n from pipeline_stages`));
    return NextResponse.json({ ok: true, db: "ok", etapas: r[0]?.n ?? 0, modo: url ? "postgres" : "local" });
  } catch (e) {
    const out: Record<string, unknown> = { ok: false, db: "erro", detalhe: clean(e) };
    const m = url?.match(/aws-(\d)-([a-z0-9-]+)\.pooler\.supabase\.com/);
    if (m) {
      const alt = url!.replace(`aws-${m[1]}-`, `aws-${m[1] === "0" ? "1" : "0"}-`);
      const c = postgres(alt, { prepare: false, max: 1, connect_timeout: 8 });
      try { await c`select 1`; out.sugestao = `Troque aws-${m[1]} por aws-${m[1] === "0" ? "1" : "0"} na DATABASE_URL e faça Redeploy`; }
      catch (e2) { out.alternativo = clean(e2); }
      finally { await c.end({ timeout: 1 }).catch(() => {}); }
    }
    return NextResponse.json(out, { status: 503 });
  }
}
