"use client";
import { useState } from "react";
import { ActionForm, Submit } from "./action-form";
import { moveStageAction } from "@/app/actions";

export function StageMover({ leadId, current, stages, compact, canMarkWon }: { leadId: string; current: string; stages: { key: string; name: string; kind: string }[]; compact?: boolean; canMarkWon: boolean }) {
  const [to, setTo] = useState(current);
  const target = stages.find((s) => s.key === to);
  const needsReason = target?.kind === "lost" || (target?.kind === "won" && to !== current);
  return (
    <ActionForm action={moveStageAction} className={compact ? "mt-2" : ""}>
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex gap-2">
        <label className="sr-only" htmlFor={`stage-${leadId}`}>Mover para</label>
        <select id={`stage-${leadId}`} name="stage" value={to} onChange={(e) => setTo(e.target.value)} className={`input ${compact ? "h-8 text-xs" : ""}`}>
          {stages.filter((s) => s.kind !== "won" || canMarkWon || s.key === current).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <Submit size={compact ? "sm" : "md"} variant="secondary">Mover</Submit>
      </div>
      {needsReason && <input name="reason" required placeholder={target?.kind === "lost" ? "Motivo da perda (obrigatório)" : "Justificativa (venda sem vínculo PDV/ADM)"} className={`input mt-2 ${compact ? "h-8 text-xs" : ""}`} />}
    </ActionForm>
  );
}
