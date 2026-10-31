/**
 * Normaliza telefone brasileiro para E.164 (+55DDDNXXXXXXXX).
 * Aceita formatos do WhatsApp (wa_id "5513999999999" ou legado sem o 9º dígito "551399999999"),
 * máscaras "(13) 99999-9999" e números com/sem DDI. Retorna null se não for possível normalizar com segurança.
 */
export function normalizeBrPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = "55" + d; // sem DDI
  if (!d.startsWith("55")) return null; // fora do Brasil: não normalizamos
  const local = d.slice(2);
  if (local.length === 10) {
    const ddd = local.slice(0, 2);
    const sub = local.slice(2);
    // celular legado (8 dígitos começando em 6-9) → insere o 9
    if (/^[6-9]/.test(sub)) return `+55${ddd}9${sub}`;
    return `+55${local}`; // fixo
  }
  if (local.length === 11 && local[2] === "9") return `+55${local}`;
  return null;
}

/** Últimos 8 dígitos — usado apenas como evidência PARCIAL de correspondência */
export function phoneTail8(input: string | null | undefined): string | null {
  const d = String(input ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
}

export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
