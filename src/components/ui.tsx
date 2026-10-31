import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return <button {...p} className={clsx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
    variant === "primary" && "bg-brand-700 text-paper hover:bg-brand-800 active:bg-brand-800",
    variant === "secondary" && "border border-ink-300 bg-paper text-ink hover:bg-ink-100 active:bg-ink-200",
    variant === "ghost" && "text-ink-700 hover:bg-ink-100",
    variant === "danger" && "bg-red-700 text-paper hover:bg-red-800",
    className)} />;
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-xl border border-ink-200 bg-paper shadow-sm", className)}>
      {(title || action) && <header className="flex items-center justify-between border-b border-ink-200 px-4 py-3"><h2 className="text-sm font-semibold text-ink">{title}</h2>{action}</header>}
      <div className="p-4">{children}</div>
    </section>
  );
}

const tones = {
  green: "bg-brand-50 text-brand-800 ring-brand-100", gray: "bg-ink-100 text-ink-700 ring-ink-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200", red: "bg-red-50 text-red-800 ring-red-200", blue: "bg-sky-50 text-sky-800 ring-sky-200",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>{children}</span>;
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-paper p-4 shadow-sm">
      <div className="text-xs font-medium text-ink-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="text-xl font-semibold text-ink">{title}</h1>{subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}</div>
      {actions}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-ink-300 p-8 text-center text-sm text-ink-500">{children}</div>;
}

export const attrTone = (s: string) => (s === "confirmed" ? "green" : s === "partial" ? "amber" : "gray") as keyof typeof tones;
