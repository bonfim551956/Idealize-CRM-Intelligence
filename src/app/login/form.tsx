"use client";
import { ActionForm, Submit } from "@/components/action-form";
import { loginAction } from "@/app/actions";
export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <div><label className="label" htmlFor="username">Usuário</label><input id="username" name="username" autoComplete="username" required className="input" /></div>
      <div><label className="label" htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete="current-password" required className="input" /></div>
      <Submit className="w-full">Entrar</Submit>
    </ActionForm>
  );
}
