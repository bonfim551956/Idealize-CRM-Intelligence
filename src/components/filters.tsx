import { SOURCE_LABEL } from "@/lib/format";
type Opt = { id: string; name: string };
export function FiltersBar({ sp, units, sellers, showUnit, extra }: { sp: Record<string, string | undefined>; units: Opt[]; sellers?: Opt[]; showUnit: boolean; extra?: React.ReactNode }) {
  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-ink-200 bg-paper p-3">
      <div><label className="label" htmlFor="dias">Período</label>
        <select id="dias" name="dias" defaultValue={sp.dias ?? "30"} className="input w-36">
          <option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option>
        </select></div>
      <div><label className="label" htmlFor="de">De</label><input id="de" type="date" name="de" defaultValue={sp.de} className="input w-40" /></div>
      <div><label className="label" htmlFor="ate">Até</label><input id="ate" type="date" name="ate" defaultValue={sp.ate} className="input w-40" /></div>
      {showUnit && <div><label className="label" htmlFor="unidade">Unidade</label>
        <select id="unidade" name="unidade" defaultValue={sp.unidade ?? ""} className="input w-40"><option value="">Todas</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
      {sellers && <div><label className="label" htmlFor="vendedor">Vendedor</label>
        <select id="vendedor" name="vendedor" defaultValue={sp.vendedor ?? ""} className="input w-48"><option value="">Todos</option>{sellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
      <div><label className="label" htmlFor="origem">Origem</label>
        <select id="origem" name="origem" defaultValue={sp.origem ?? ""} className="input w-48"><option value="">Todas</option>{Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {extra}
      <label className="flex h-10 items-center gap-2 text-sm text-ink-700"><input type="checkbox" name="teste" value="1" defaultChecked={sp.teste === "1"} className="h-4 w-4 accent-brand-700" />Incluir dados de teste</label>
      <button className="h-10 rounded-lg bg-brand-700 px-4 text-sm font-medium text-paper hover:bg-brand-800">Aplicar</button>
    </form>
  );
}
export const TestBanner = ({ on }: { on: boolean }) => on
  ? <div role="note" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">Exibindo DADOS DE TESTE fictícios junto com os reais. Não use estes números para decisão.</div>
  : null;
