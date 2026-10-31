"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LayoutDashboard, KanbanSquare, Users, Megaphone, Receipt, Workflow, PlugZap, Settings } from "lucide-react";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/vendas", label: "Vendas", icon: Receipt },
  { href: "/automacoes", label: "Automações", icon: Workflow },
  { href: "/integracoes", label: "Integrações", icon: PlugZap, admin: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function Nav({ isAdmin }: { isAdmin: boolean; canManage?: boolean }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 lg:flex-col lg:overflow-visible">
      {ITEMS.filter((i) => (!i.admin || isAdmin)).map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={clsx("flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-50 text-brand-800" : "text-ink-700 hover:bg-ink-100")}>
            <Icon className="h-4 w-4" aria-hidden />{label}
          </Link>
        );
      })}
    </nav>
  );
}
