import { positionSummary, storedRelation } from "@/lib/negotiation/intelligence/workspace-present";
import type { NegotiationTermView } from "@/lib/negotiation/intelligence/types";

export function QualitativePair({ term }: { term: NegotiationTermView }) {
  const relation = storedRelation(term);
  const tenant = positionSummary(term.tenantPosition);
  const landlord = positionSummary(term.landlordPosition);
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-start sm:gap-6">
      <div className="min-w-0">
        <p className="text-[11px] font-medium leading-[15px] text-[#214e46]">Tenant</p>
        <p className="mt-1 break-words text-[15px] leading-6 text-ink">{tenant ?? "No stored position"}</p>
      </div>
      {relation ? (
        <p className="text-[13px] font-medium leading-5 text-ink-secondary sm:pt-5">{relation}</p>
      ) : null}
      <div className="min-w-0 sm:text-right">
        <p className="text-[11px] font-medium leading-[15px] text-[#8c5a3c]">Landlord</p>
        <p className="mt-1 break-words text-[15px] leading-6 text-ink">{landlord ?? "No stored position"}</p>
      </div>
    </div>
  );
}
