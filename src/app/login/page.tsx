import { redirect } from "next/navigation";
import { currentUser } from "@/server/session";
import { LoginForm } from "./form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-2 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-ink-200 bg-paper p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-sm font-bold text-paper">ID</div>
          <div><div className="text-base font-semibold text-ink">Idealize CRM</div><div className="text-xs text-ink-500">Intelligence</div></div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
