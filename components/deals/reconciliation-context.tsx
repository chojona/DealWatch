import Link from "next/link";
import {
  eventTypeLabel,
  primaryReconciliation,
  reconciliationBadge,
  reconciliationSummary,
} from "@/lib/deals/reconciliation/present";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";

function utcDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

const badgeClass: Record<string, string> = {
  MATCHES_CURRENT: "border-emerald-200 bg-emerald-50 text-emerald-800",
  MATCHES_HISTORICAL: "border-amber-200 bg-amber-50 text-amber-900",
  POSSIBLE_RELATED: "border-blue-200 bg-blue-50 text-blue-800",
  DIFFERS_FROM_CURRENT: "border-zinc-300 bg-zinc-100 text-zinc-700",
  NO_NEGOTIATION_MATCH: "border-zinc-200 bg-white text-zinc-500",
};

export function ReconciliationBadge({ links }: { links: ReconciliationLink[] | undefined }) {
  const link = links ? primaryReconciliation(links) : null;
  if (!link) return null;
  return (
    <span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass[link.relationship]}`}>
      {reconciliationBadge(link.relationship)}
    </span>
  );
}

export function ReconciliationDetail({
  links,
  dealId,
}: {
  links: ReconciliationLink[] | undefined;
  dealId?: string;
}) {
  if (!links || links.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {links.map((link) => {
        const summary = reconciliationSummary(link);
        const roundHref = link.matchedRoundId && dealId
          ? `/deals/${dealId}/negotiation?round=${link.matchedRoundId}`
          : null;
        return (
          <div key={`${link.activityEventId}:${link.canonicalType ?? "activity"}:${link.explanationCode}`} className="rounded-sm border border-zinc-200 bg-zinc-50/70 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <ReconciliationBadge links={[link]} />
              <span className="text-[11px] text-zinc-500">{utcDate(link.eventDate)}</span>
            </div>
            {link.eventValue?.display && (
              <p className="mt-1 text-sm font-medium text-zinc-900">
                {link.eventSide === "LANDLORD" ? "Landlord" : link.eventSide === "TENANT" ? "Tenant" : "Activity"}{" "}
                {eventTypeLabel(link.eventType).toLowerCase()}
                {" · "}
                {link.eventValue.display}
              </p>
            )}
            {summary && <p className="mt-1 text-[11px] leading-5 text-zinc-600">{summary}</p>}
            {link.disagreement && (
              <dl className="mt-2 space-y-0.5 text-[11px] text-zinc-700">
                <div>Email activity: {link.disagreement.activityDisplay}</div>
                <div>Formal negotiation observation: {link.disagreement.observationDisplay}</div>
                <div>Current resolved position: {link.disagreement.currentDisplay}</div>
              </dl>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              <span className="text-zinc-500">{link.eventSource.label}</span>
              {link.eventSource.href && (
                <a className="font-medium text-zinc-800 underline" href={link.eventSource.href}>View email</a>
              )}
              {roundHref && (
                <Link className="font-medium text-zinc-800 underline" href={roundHref}>View negotiation round</Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
