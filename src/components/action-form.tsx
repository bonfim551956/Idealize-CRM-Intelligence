"use client";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import type { ActionState } from "@/app/actions";

type Action = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function ActionForm({ action, children, className, hideOk }: { action: Action; children: ReactNode; className?: string; hideOk?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p role="alert" className="mt-2 text-xs font-medium text-red-700">{state.error}</p>}
      {state?.ok && !hideOk && <p role="status" className="mt-2 text-xs font-medium text-brand-800">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, variant = "primary", size = "md", className }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={clsx(
      "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
      size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
      variant === "primary" && "bg-brand-700 text-paper hover:bg-brand-800",
      variant === "secondary" && "border border-ink-300 bg-paper text-ink hover:bg-ink-100",
      variant === "danger" && "bg-red-700 text-paper hover:bg-red-800",
      variant === "ghost" && "text-ink-700 hover:bg-ink-100", className)}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}
