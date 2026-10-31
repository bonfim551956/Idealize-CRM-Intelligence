import { requireUser } from "@/server/session";
import { isAdmin, canManage } from "@/server/scope";
import { Nav } from "@/components/nav";
import { ROLE_LABEL } from "@/lib/format";
import { getDb } from "@/db";
import { units } from "@/db/schema";
import { eq } from "drizzle-orm";
import { LogOut } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const unit = u.unitId ? (await getDb().select().from(units).where(eq(units.id, u.unitId)))[0] : null;
  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-ink-200 bg-paper lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-xs font-bold text-paper">ID</div>
          <div className="leading-tight"><div className="text-sm font-semibold">Idealize CRM</div><div className="text-xs text-ink-500">Intelligence</div></div>
        </div>
        <div className="pb-3 lg:flex-1"><Nav isAdmin={isAdmin(u)} canManage={canManage(u)} /></div>
        <div className="hidden border-t border-ink-200 p-4 lg:block">
          <div className="text-sm font-medium">{u.name}</div>
          <div className="text-xs text-ink-500">{ROLE_LABEL[u.role]}{unit ? ` · ${unit.name}` : " · Rede"}</div>
          <form action="/api/auth/logout" method="post" className="mt-3">
            <button className="inline-flex items-center gap-2 text-xs font-medium text-ink-700 hover:text-ink"><LogOut className="h-3.5 w-3.5" />Sair</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
    </div>
  );
}
