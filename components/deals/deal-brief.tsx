import Link from "next/link";
import { ActionEvidenceReview } from "@/components/deals/action-evidence-review";
import type { ActionEvidenceReviewItem } from "@/lib/deals/actions/evidenceReviewView";
import type { DealActionState, DealCourt } from "@/lib/deals/actions/types";
import type {
  DealBrief,
  DealBriefAttentionItem,
  DealBriefSourceKind,
  DealEvidenceComparison,
} from "@/lib/deals/brief/types";
import type { NegotiationPositionView } from "@/lib/negotiation/intelligence/types";
import { briefHasTrackedEvidence, snapshotFromBrief } from "@/lib/deals/dashboard";

function timestamp(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function position(positionValue: NegotiationPositionView | null): string {
  if (!positionValue) return "—";
  if (positionValue.kind === "CONFLICT") return `${positionValue.candidates.length} conflicting candidates`;
  return positionValue.value.summary;
}

function sourceLabel(kind: DealBriefSourceKind): string {
  if (kind === "COMMUNICATION_EVIDENCE") return "In communication";
  if (kind === "LEGACY_ACTIVITY") return "Recorded activity";
  return "On the paper";
}

function sourceClass(kind: DealBriefSourceKind): string {
  if (kind === "COMMUNICATION_EVIDENCE") return "border-sky-200 bg-sky-50 text-sky-800";
  if (kind === "LEGACY_ACTIVITY") return "border-zinc-200 bg-zinc-100 text-zinc-600";
  return "border-violet-200 bg-violet-50 text-violet-800";
}

function SourcePill({ kind }: { kind: DealBriefSourceKind }) {
  return (
    <span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${sourceClass(kind)}`}>
      {sourceLabel(kind)}
    </span>
  );
}

function SourceLink({ href, label = "View evidence" }: { href: string | null; label?: string }) {
  if (!href) return <span className="text-[11px] text-zinc-400">Source link unavailable</span>;
  return <Link href={href} className="text-[11px] font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2">{label}</Link>;
}

function Section({ title, eyebrow, children, className = "" }: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-sm border border-zinc-200 bg-white ${className}`}>
      <header className="border-b border-zinc-100 px-4 py-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{eyebrow}</p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function AttentionItem({ item }: { item: DealBriefAttentionItem }) {
  const urgent = item.priority <= 2;
  return (
    <li className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <SourcePill kind={item.sourceKind} />
          <span className="text-[10px] text-zinc-400">{timestamp(item.timestamp)}</span>
        </div>
        <p className={`mt-1.5 text-xs font-semibold ${urgent ? "text-amber-900" : "text-zinc-900"}`}>{item.label}</p>
        {item.description ? <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{item.description}</p> : null}
      </div>
      <Link href={item.href} className="shrink-0 text-[11px] font-semibold text-zinc-700 underline decoration-zinc-300 underline-offset-2">Open</Link>
    </li>
  );
}

const MAJOR_TERMS = new Set(["BASE_RENT", "TI_ALLOWANCE", "FREE_RENT", "LEASE_TERM"]);

function meaningfulComparisons(comparisons: DealEvidenceComparison[]): DealEvidenceComparison[] {
  const seen = new Set<string>();
  return comparisons.filter((comparison) => {
    if (comparison.outcome === "NOT_COMPARABLE") return false;
    const key = `${comparison.canonicalType}:${comparison.side}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function courtLabel(value: DealCourt): string {
  if (value === "OUR_SIDE") return "Our side";
  if (value === "COUNTERPARTY") return "Counterparty";
  if (value === "BOTH") return "Both";
  if (value === "NONE") return "No outstanding response";
  return "Unknown";
}

function ActionPanel({ actions }: { actions: DealActionState }) {
  const courtEvidence = actions.court.evidence[0] ?? null;
  return (
    <section id="actions" className="rounded-sm border border-zinc-200 bg-white">
      <header className="border-b border-zinc-100 px-4 py-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Follow-up</p>
        <h2 className="mt-0.5 text-sm font-semibold text-zinc-900">What to do next</h2>
      </header>
      <div className="grid gap-px bg-zinc-100 lg:grid-cols-4">
        <div className="bg-white p-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Whose court</p>
          <p className="mt-2 text-sm font-semibold text-zinc-900">{courtLabel(actions.court.value)}</p>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">
            {actions.court.value === "UNKNOWN"
              ? "Reviewed evidence does not say who owes the next response."
              : "Based on reviewed requests."}
          </p>
          {courtEvidence ? <div className="mt-2"><SourceLink href={courtEvidence.href} label="View source" /></div> : null}
        </div>
        <div className="bg-white p-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Needs you</p>
          {actions.needsYou.length === 0 ? (
            <p className="mt-2 text-[11px] leading-4 text-zinc-500">No explicit action is waiting.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {actions.needsYou.slice(0, 3).map((action) => (
                <li key={action.id}>
                  <p className="text-xs font-semibold text-zinc-900">{action.timingLabel}</p>
                  <p className="text-[11px] leading-4 text-zinc-500">{action.description}</p>
                  <SourceLink href={action.source.href} label="View source" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white p-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Upcoming</p>
          {actions.upcoming.length === 0 ? (
            <p className="mt-2 text-[11px] leading-4 text-zinc-500">No explicit deadlines or meetings.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {actions.upcoming.slice(0, 3).map((item) => (
                <li key={item.id}>
                  <p className="text-xs font-semibold text-zinc-900">{item.label}</p>
                  <p className="text-[11px] text-zinc-500">{item.timingLabel}{item.at ? ` · ${timestamp(item.at)}` : ""}</p>
                  <SourceLink href={item.href} label="View source" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white p-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Outstanding</p>
          {actions.outstandingActions.length === 0 ? (
            <p className="mt-2 text-[11px] leading-4 text-zinc-500">No unresolved follow-ups.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {actions.outstandingActions.slice(0, 3).map((action) => (
                <li key={action.id}>
                  <p className="text-xs font-semibold text-zinc-900">{action.timingLabel}</p>
                  <p className="text-[11px] leading-4 text-zinc-500">{action.description}</p>
                  <SourceLink href={action.source.href} label="View source" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function communicationState(value: string): string {
  if (value === "REVIEWED") return "Reviewed";
  if (value === "NEEDS_FOLLOW_UP") return "Follow-up marked";
  if (value === "REVIEW_REQUIRED") return "Needs review";
  if (value === "ANALYSIS_FAILED") return "Analysis failed";
  return "Received";
}

export function DealBriefView({
  brief,
  actionEvidence = [],
}: {
  brief: DealBrief;
  actionEvidence?: ActionEvidenceReviewItem[];
}) {
  const displayedTerms = [...brief.negotiation.terms]
    .sort((left, right) => Number(right.conflict) - Number(left.conflict)
      || Number(left.status === "AGREED") - Number(right.status === "AGREED")
      || Number(right.movement.kind !== "NONE" && right.movement.kind !== "UNCHANGED")
        - Number(left.movement.kind !== "NONE" && left.movement.kind !== "UNCHANGED")
      || Number(MAJOR_TERMS.has(right.canonicalType)) - Number(MAJOR_TERMS.has(left.canonicalType))
      || left.label.localeCompare(right.label))
    .slice(0, 8);
  const comparisons = meaningfulComparisons(brief.comparisons).slice(0, 6);
  const hasEvidence = briefHasTrackedEvidence(snapshotFromBrief(brief));
  const hiddenTerms = Math.max(0, brief.negotiation.terms.length - displayedTerms.length);

  return (
    <div className="space-y-5">
      {brief.since ? (
        <div className="rounded-sm border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-600">
          Changes are filtered from {timestamp(brief.since)}. Current open deal state remains visible.
        </div>
      ) : null}

      {hasEvidence ? null : (
        <div className="rounded-sm border border-zinc-200 bg-white px-4 py-5">
          <h2 className="text-sm font-semibold text-zinc-900">Add your first source</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-500">
            Upload a document or add messages to start building the deal record. Brief, actions, and negotiation update from that evidence.
          </p>
          <div className="mt-3 flex gap-2">
            <Link href={`/deals/${brief.deal.id}/documents`} className="inline-flex h-8 items-center rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white">Upload a document</Link>
            <Link href={`/deals/${brief.deal.id}/messages`} className="inline-flex h-8 items-center rounded-sm border border-zinc-200 px-3 text-xs font-medium text-zinc-800">Add messages</Link>
          </div>
        </div>
      )}

      <ActionPanel actions={brief.actions} />

      <ActionEvidenceReview dealId={brief.deal.id} items={actionEvidence} />

      <Section title="Deal attention" eyebrow="Review and commercial signals">
        {brief.productAttention.length === 0 ? (
          hasEvidence ? (
            <div className="rounded-sm border border-emerald-100 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              Nothing in the current deal evidence requires action.
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Attention appears after documents or messages are added.</p>
          )
        ) : (
          <ul className="grid divide-y divide-zinc-100 lg:grid-cols-2 lg:divide-y-0 lg:gap-x-8">
            {brief.productAttention.slice(0, 6).map((item) => <AttentionItem key={item.id} item={item} />)}
          </ul>
        )}
      </Section>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Where the deal stands" eyebrow="Current commercial state">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
            <SourcePill kind="FORMAL_NEGOTIATION" />
            <span>{brief.negotiation.summary.openCount} open</span>
            <span className="text-zinc-300">•</span>
            <span>{brief.negotiation.summary.agreedCount} agreed</span>
            <span className="text-zinc-300">•</span>
            <span className={brief.negotiation.summary.conflictCount ? "font-semibold text-red-700" : ""}>{brief.negotiation.summary.conflictCount} conflicts</span>
          </div>
          {displayedTerms.length === 0 ? (
            <p className="text-sm text-zinc-500">No formal negotiation positions are stored yet.</p>
          ) : (
            <div className="grid gap-x-6 md:grid-cols-2">
              {displayedTerms.map((term) => (
                <article key={term.canonicalType} className="border-t border-zinc-100 py-3 first:border-t-0 md:[&:nth-child(2)]:border-t-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-zinc-900">{term.label}</p>
                      {term.status === "AGREED" && term.agreedPosition ? (
                        <div className="mt-1 grid grid-cols-[4rem_1fr] gap-x-2 text-[11px]"><span className="text-zinc-400">Agreed</span><span className="truncate text-zinc-700">{position(term.agreedPosition)}</span></div>
                      ) : (
                        <div className="mt-1 grid grid-cols-[4rem_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                          <span className="text-zinc-400">Tenant</span><span className="truncate text-zinc-700">{position(term.tenantPosition)}</span>
                          <span className="text-zinc-400">Landlord</span><span className="truncate text-zinc-700">{position(term.landlordPosition)}</span>
                        </div>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${term.conflict ? "border-red-200 bg-red-50 text-red-700" : term.status === "AGREED" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      {term.conflict ? "Conflict" : term.status === "AGREED" ? "Agreed" : "Open"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <p className="truncate text-[10px] text-zinc-400">{term.source?.label ?? "Evidence unavailable"}</p>
                    <SourceLink href={term.provenance.evidenceHref ?? term.source?.href ?? null} />
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3">
            <span className="text-[11px] text-zinc-400">{hiddenTerms ? `${hiddenTerms} additional stable ${hiddenTerms === 1 ? "term" : "terms"}` : "Showing current terms"}</span>
            <Link href={`/deals/${brief.deal.id}/negotiation`} className="text-xs font-semibold text-zinc-800 underline decoration-zinc-300 underline-offset-2">Open negotiation</Link>
          </div>
        </Section>

        <Section title="What changed" eyebrow="Meaningful deal movement">
          {brief.recentChanges.length === 0 ? (
            <p className="text-sm text-zinc-500">{brief.changeSummary.emptyState ?? "No recent meaningful deal changes."}</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {brief.recentChanges.slice(0, 7).map((change) => (
                <li key={change.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2"><SourcePill kind={change.sourceKind} /><span className="text-[10px] text-zinc-400">{timestamp(change.timestamp)}</span></div>
                  <p className="mt-1.5 text-xs font-semibold text-zinc-900">{change.label}</p>
                  {change.description ? <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{change.description}</p> : null}
                  <div className="mt-1"><SourceLink href={change.source.href} /></div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {comparisons.length > 0 ? (
        <Section title="Paper vs communication" eyebrow="Reviewed, comparable evidence">
          <p className="mb-4 text-xs text-zinc-500">This comparison does not choose which source is correct or change the formal negotiation.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {comparisons.map((comparison) => (
              <article key={comparison.id} className={`rounded-sm border p-3 ${comparison.outcome === "DIFFERS" ? "border-amber-200 bg-amber-50/40" : "border-zinc-200"}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900">{comparison.label}</h3>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase ${comparison.outcome === "DIFFERS" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
                    {comparison.outcome === "DIFFERS" ? "Potential discrepancy" : "Match"}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{comparison.side.toLowerCase()} position</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="border-r border-zinc-200 pr-3">
                    <SourcePill kind="FORMAL_NEGOTIATION" />
                    <p className="mt-2 text-sm font-semibold text-zinc-900">{comparison.formal.value}</p>
                    <div className="mt-2"><SourceLink href={comparison.formal.source?.href ?? null} label="View document" /></div>
                  </div>
                  <div>
                    <SourcePill kind="COMMUNICATION_EVIDENCE" />
                    <p className="mt-2 text-sm font-semibold text-zinc-900">{comparison.communication.value}</p>
                    {comparison.communication.corrected ? <p className="mt-0.5 text-[10px] text-amber-700">Reviewed correction</p> : null}
                    <div className="mt-2"><SourceLink href={comparison.communication.source.href} label="View message" /></div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Section>
      ) : null}

      <Section title="Recent communications" eyebrow="Message evidence">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-sky-100 bg-sky-50 px-3 py-2">
          <p className="text-[11px] text-sky-900">Communication evidence never sets or changes the formal negotiation position.</p>
          <Link href={`/deals/${brief.deal.id}/messages`} className="text-[11px] font-semibold text-sky-900 underline">Open all messages</Link>
        </div>
        {brief.communications.length === 0 ? (
          <p className="text-sm text-zinc-500">No communications in the current view.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {brief.communications.slice(0, 6).map((communication) => (
              <article key={communication.id} className="rounded-sm border border-zinc-200 p-3">
                <div className="flex items-center justify-between gap-2"><SourcePill kind="COMMUNICATION_EVIDENCE" /><span className="text-[10px] text-zinc-400">{timestamp(communication.timestamp)}</span></div>
                <h3 className="mt-2 truncate text-sm font-semibold text-zinc-900">{communication.subject}</h3>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">{communication.sender.label}</p>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">{communicationState(communication.reviewState === "NEEDS_FOLLOW_UP" ? "NEEDS_FOLLOW_UP" : communication.lifecycleState)}</p>
                {communication.facts.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 border-t border-zinc-100 pt-2">
                    {communication.facts.slice(0, 3).map((fact) => (
                      <li key={fact.id} className="text-[11px]">
                        <div className="flex justify-between gap-2"><span className="text-zinc-500">{fact.label}</span><span className="text-right font-medium text-zinc-800">{fact.presentation.value}</span></div>
                        {fact.presentation.corrected ? <p className="mt-0.5 text-right text-[10px] text-amber-700">Reviewed correction · originally {fact.raw.value.display ?? "unformatted"}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-[11px] text-zinc-400">No structured commercial facts available.</p>}
                <div className="mt-3"><SourceLink href={communication.source.href} label="View message" /></div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section title="System review" eyebrow="DealWatch maintenance">
        {brief.systemAttention.length === 0 ? (
          <p className="text-sm text-zinc-500">No internal review work is outstanding.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-600">{brief.systemAttention.length} internal review {brief.systemAttention.length === 1 ? "item is" : "items are"} available without displacing deal attention.</p>
            <Link href={`/inbox?dealId=${brief.deal.id}`} className="text-xs font-semibold text-zinc-800 underline decoration-zinc-300 underline-offset-2">Open review queue</Link>
          </div>
        )}
      </Section>

      <Section title="Brief timeline" eyebrow="Compact source chronology">
        {brief.timeline.length === 0 ? (
          <p className="text-sm text-zinc-500">No source chronology in the current view.</p>
        ) : (
          <ol className="grid gap-x-6 gap-y-0 md:grid-cols-2">
            {brief.timeline.slice(0, 10).map((item) => (
              <li key={item.id} className="relative border-l border-zinc-200 pb-4 pl-4">
                <span className="absolute -left-1 top-1 h-2 w-2 rounded-full bg-zinc-400 ring-2 ring-white" />
                <div className="flex items-center gap-2"><SourcePill kind={item.sourceKind} /><span className="text-[10px] text-zinc-400">{timestamp(item.occurredAt ?? item.recordedAt)}</span></div>
                <p className="mt-1 text-xs font-semibold text-zinc-900">{item.title}</p>
                {item.description ? <p className="mt-0.5 text-[11px] text-zinc-500">{item.description}</p> : null}
                <div className="mt-1"><SourceLink href={item.source.href} /></div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
