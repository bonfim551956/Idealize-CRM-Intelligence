import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, units } from "@/db/schema";
import { requireUser } from "@/server/session";
import { isAdmin, canManage } from "@/server/scope";
import { Card, PageHeader, Badge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { availabilityAction, createUserAction, toggleUserAction, unitAction, changePasswordAction } from "@/app/actions";
import { ROLE_LABEL } from "@/lib/format";

export default async function Config() {
  const u = await requireUser(); const db = getDb(); const admin = isAdmin(u);
  const [allUsers, allUnits] = await Promise.all([db.select().from(users).orderBy(asc(users.name)), db.select().from(units).orderBy(asc(units.name))]);
  const visible = admin ? allUsers : allUsers.filter((x) => x.unitId === u.unitId);
  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Minha disponibilidade">
            <ActionForm action={availabilityAction} className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="available" defaultChecked={u.available} className="h-4 w-4 accent-brand-700" />Disponível para receber novos leads</label>
              <Submit size="sm" variant="secondary">Salvar</Submit>
            </ActionForm>
          </Card>
          <Card title="Trocar minha senha">
            <ActionForm action={changePasswordAction} className="grid gap-3 sm:grid-cols-3">
              <div><label className="label" htmlFor="pw-cur">Senha atual</label><input id="pw-cur" name="current" type="password" required autoComplete="current-password" className="input" /></div>
              <div><label className="label" htmlFor="pw-new">Nova senha</label><input id="pw-new" name="next" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
              <div><label className="label" htmlFor="pw-conf">Confirmar</label><input id="pw-conf" name="confirm" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
              <div className="sm:col-span-3"><Submit size="sm" variant="secondary">Alterar senha</Submit></div>
            </ActionForm>
          </Card>
          {canManage(u) && <Card title="Usuários">
            <div className="overflow-x-auto"><table className="w-full min-w-[600px]">
              <thead className="border-b border-ink-200"><tr>{["Nome", "Usuário", "Função", "Unidade", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-ink-100">{visible.map((x) => (
                <tr key={x.id}><td className="td font-medium">{x.name}</td><td className="td font-mono text-xs">{x.username}</td><td className="td">{ROLE_LABEL[x.role]}</td>
                  <td className="td">{allUnits.find((n) => n.id === x.unitId)?.name ?? "Rede"}</td>
                  <td className="td">{x.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="red">Inativo</Badge>} {x.role === "vendedor" && x.active && !x.available && <Badge tone="amber">Indisponível</Badge>}</td>
                  <td className="td">{x.id !== u.id && (admin || x.role === "vendedor") && <ActionForm action={toggleUserAction} hideOk><input type="hidden" name="userId" value={x.id} /><Submit size="sm" variant="ghost">{x.active ? "Desativar" : "Reativar"}</Submit></ActionForm>}</td></tr>))}</tbody>
            </table></div>
            <p className="mt-2 text-xs text-ink-500">Desativar bloqueia o acesso e mantém todo o histórico do colaborador.</p>
          </Card>}
        </div>
        <div className="space-y-6">
          {canManage(u) && <Card title="Novo usuário">
            <ActionForm action={createUserAction} className="space-y-3">
              <div><label className="label" htmlFor="nu-name">Nome</label><input id="nu-name" name="name" required className="input" /></div>
              <div><label className="label" htmlFor="nu-user">Usuário de login</label><input id="nu-user" name="username" required placeholder="nome.sobrenome" className="input" /></div>
              <div><label className="label" htmlFor="nu-role">Função</label><select id="nu-role" name="role" className="input" defaultValue="vendedor">{(admin ? ["vendedor", "gestor", "admin", "diretoria"] : ["vendedor"]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
              <div><label className="label" htmlFor="nu-unit">Unidade</label><select id="nu-unit" name="unitId" className="input" defaultValue={u.unitId ?? ""}>{admin && <option value="">Rede (diretoria/admin)</option>}{(admin ? allUnits : allUnits.filter((n) => n.id === u.unitId)).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
              <div><label className="label" htmlFor="nu-pw">Senha inicial</label><input id="nu-pw" name="password" type="password" minLength={10} required autoComplete="new-password" className="input" /></div>
              <Submit className="w-full">Criar usuário</Submit>
            </ActionForm>
          </Card>}
          {admin && <Card title="Unidades">
            <ul className="mb-3 space-y-1 text-sm">{allUnits.map((n) => <li key={n.id}>{n.name}</li>)}</ul>
            <ActionForm action={unitAction} className="flex gap-2"><input name="name" required placeholder="Nova unidade" className="input" aria-label="Nome da unidade" /><Submit variant="secondary">Adicionar</Submit></ActionForm>
          </Card>}
        </div>
      </div>
    </>
  );
}
