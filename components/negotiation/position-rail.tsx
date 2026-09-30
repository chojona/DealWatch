import { sideSteps, type SideStep } from "@/lib/negotiation/intelligence/workspace-present";
import type { NegotiationTermView } from "@/lib/negotiation/intelligence/types";

function party(step: SideStep): string {
  const name = step.side === "TENANT" ? "Tenant" : "Landlord";
  const delta = step.delta ? ` ${step.delta}` : "";
  return `${name} ${step.previous} → ${step.current}${delta}`;
}

export function PositionRail({ term }: { term: NegotiationTermView }) {
  const gap = term.numericGap;
  if (!gap) return null;
  const steps = sideSteps(term);
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <p className="font-negotiation-serif text-[28px] leading-none tracking-[-0.03em] text-[#214e46] tabular-nums">
          {term.tenantPosition?.kind === "VALUE" ? term.tenantPosition.value.summary : "—"}
        </p>
        <p className="pb-1 text-center text-[13px] leading-4 text-ink-secondary tabular-nums">{gap.display} apart</p>
        <p className="text-right font-negotiation-serif text-[28px] leading-none tracking-[-0.03em] text-[#8c5a3c] tabular-nums">
          {term.landlordPosition?.kind === "VALUE" ? term.landlordPosition.value.summary : "—"}
        </p>
      </div>
      <div className="relative mt-4 h-3" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-px bg-[#d9d3c8]" />
        <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#214e46]" style={{ left: "18%" }} />
        <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8c5a3c]" style={{ left: "82%" }} />
      </div>
      {steps.length > 0 ? (
        <p className="mt-2 text-[13px] leading-5 text-ink-secondary tabular-nums">
          {steps.map(party).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
