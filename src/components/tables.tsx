import Link from "next/link";
import type { FunnelRow, CampaignRow } from "@/server/metrics";
import { Empty } from "@/components/ui";
import { brl, int, pct } from "@/lib/format";

export function CampaignTable({ rows, drill, first, hrefBase = "/campanhas?campanha=" }: { rows: CampaignRow[]; drill?: boolean; first?: string; hrefBase?: string }) {
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
      <thead className="border-b border-ink-200"><tr>{[first ?? "Campanha", "Investimento", "Leads", "Qualificados", "Agendamentos", "Vendas", "Faturamento", "CPL", "CPA", "ROAS"].map((h, i) => <th key={h} className={`th ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-ink-100">{rows.map((r) => (
        <tr key={r.key ?? "none"} className="hover:bg-paper-2">
          <td className="td max-w-xs truncate font-medium">{drill && r.key ? <Link className="text-brand-800 hover:underline" href={`${hrefBase}${r.key}`}>{r.label}</Link> : r.label}</td>
          <td className="td text-right">{r.investimento ? brl(r.investimento) : "—"}</td>
          <td className="td text-right">{int(r.leads)}</td><td className="td text-right">{int(r.qualificados)}</td><td className="td text-right">{int(r.agendamentos)}</td>
          <td className="td text-right">{int(r.vendas)}</td><td className="td text-right">{brl(r.faturamento)}</td>
          <td className="td text-right">{r.cpl != null ? brl(r.cpl) : "—"}</td><td className="td text-right">{r.cpa != null ? brl(r.cpa) : "—"}</td>
          <td className="td text-right font-medium">{r.roas != null ? `${r.roas.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x` : "—"}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

export function FunnelTable({ rows, first }: { rows: FunnelRow[]; first: string }) {
  if (!rows.length) return <Empty>Sem dados no período.</Empty>;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[620px]">
      <thead className="border-b border-ink-200"><tr>{[first, "Leads", "Atendidos", "1ª resp.", "Agend.", "Compar.", "Vendas", "Conv.", "Faturamento"].map((h, i) => <th key={h} className={`th ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-ink-100">{rows.map((r) => (
        <tr key={r.key ?? "none"}><td className="td whitespace-nowrap font-medium">{r.label}</td><td className="td text-right">{int(r.leads)}</td><td className="td text-right">{int(r.atendidos)}</td>
          <td className="td text-right">{r.tempo_resp_min != null ? `${r.tempo_resp_min} min` : "—"}</td><td className="td text-right">{int(r.agendamentos)}</td><td className="td text-right">{int(r.comparecimentos)}</td>
          <td className="td text-right">{int(r.vendas)}</td><td className="td text-right">{pct(r.vendas, r.leads)}</td><td className="td text-right">{brl(r.faturamento)}</td></tr>))}</tbody>
    </table></div>
  );
}
