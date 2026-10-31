export const brl = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const int = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("pt-BR");
export const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
export const dt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const since = (d: Date | string) => {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} d`;
};
export const SOURCE_LABEL: Record<string, string> = {
  whatsapp_ctwa: "Anúncio → WhatsApp", whatsapp_organic: "WhatsApp orgânico", lead_ads: "Formulário Lead Ads",
  manual: "Cadastro manual", site: "Site", unknown: "Desconhecida",
};
export const ATTR_LABEL: Record<string, string> = { confirmed: "Confirmada", partial: "Parcial", unknown: "Desconhecida" };
export const ROLE_LABEL: Record<string, string> = { diretoria: "Diretoria", admin: "Administrador", gestor: "Gestor da unidade", vendedor: "Vendedor" };
