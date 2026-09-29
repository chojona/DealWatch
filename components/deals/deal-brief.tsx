import Link from "next/link";
import { ActionEvidenceReview } from "@/components/deals/action-evidence-review";
import type { ActionEvidenceReviewItem } from "@/lib/deals/actions/evidenceReviewView";
import type { DealActionState, DealCourt } from "@/lib/deals/actions/types";
import type { DealBriefFormalStatus } from "@/lib/deals/brief/formalStatus";
import {
  BRIEF_SECTION_CAPS,
  comparisonOutcomeLabel,
  displayedComparisons,
  hiddenCount,
  isOperationalAnalysisAttention,
  processingIssuesInboxHref,
  remainderLabel,
} from "@/lib/deals/brief/presentation";
import type {
  DealBrief,
  DealBriefAttentionItem,
  DealBriefSourceKind,
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
    <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${sourceClass(kind)}`}>
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
    <section className={`rounded-lg border border-[#d7e0e4] bg-white ${className}`}>
      <header className="border-b border-[#e6ecee] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#1c2430]">{title}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{eyebrow}</p>
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

function formalStatusClass(status: DealBriefFormalStatus): string {
  switch (status) {
    case "AGREED":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "CONFLICT":
      return "border-red-200 bg-red-50 text-red-700";
    case "REJECTED":
      return "border-red-200 bg-red-50 text-red-800";
    case "WITHDRAWN":
    case "NOT_MENTIONED":
      return "border-zinc-200 bg-zinc-100 text-zinc-600";
    case "UNKNOWN":
      return "border-zinc-300 bg-zinc-50 text-zinc-700";
    case "OPEN":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function StaleBadge({ stale }: { stale: boolean }) {
  if (!stale) return null;
  return (
    <span className="rounded-sm border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800">
      Stale
    </span>
  );
}

function ExpandableRemainder({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="mt-3 border-t border-zinc-100 pt-3">
      <summary className="cursor-pointer text-[11px] font-semibold text-zinc-800">{label}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function courtLabel(value: DealCourt): string {
  if (value === "OUR_SIDE") return "Needs you";
  if (value === "COUNTERPARTY") return "Waiting on them";
  if (value === "BOTH") return "Both sides";
  if (value === "NONE") return "Nothing outstanding";
  return "Not clear yet";
}

function ActionPanel({ actions }: { actions: DealActionState }) {
  const courtEvidence = actions.court.evidence[0] ?? null;
  return (
    <section id="actions" className="rounded-sm border border-zinc-200 bg-white">
      <header className="border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">What to do next</h2>
        <p className="mt-0.5 text-xs text-zinc-500">Requests taken from reviewed messages.</p>
      </header>
      <div className="grid gap-px bg-zinc-100 lg:grid-cols-4">
        <div className="bg-white p-4">
          <p className="text-[11px] font-medium text-zinc-500">Who should act</p>
          <p className="mt-2 text-sm font-semibold text-zinc-900">{courtLabel(actions.court.value)}</p>
          <p className="mt-1 text-[11px] leading-4 text-zinc-500">
            {actions.court.value === "UNKNOWN"
              ? "Reviewed messages do not say who owes the next response."
              : "Taken from reviewed requests. This does not change the paper."}
          </p>
          {courtEvidence ? <div className="mt-2"><SourceLink href={courtEvidence.href} label="View source" /></div> : null}
        </div>
        <div className="bg-white p-4">
          <p className="text-[11px] font-medium text-zinc-500">Your requests</p>
          {actions.needsYou.length === 0 ? (
            <p className="mt-2 text-[11px] leading-4 text-zinc-500">No explicit action is waiting.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {actions.needsYou.slice(0, 3).map((action) => (
                <li key={action.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-900">{action.timingLabel}</p>
                    <StaleBadge stale={action.stale} />
                  </div>
                  <p className="text-[11px] leading-4 text-zinc-500">{action.description}</p>
                  <SourceLink href={action.source.href} label="View source" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white p-4">
          <p className="text-[11px] font-medium text-zinc-500">Upcoming</p>
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
          <p className="text-[11px] font-medium text-zinc-500">Still open</p>
          {actions.outstandingActions.length === 0 ? (
            <p className="mt-2 text-[11px] leading-4 text-zinc-500">No unresolved follow-ups.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {actions.outstandingActions.slice(0, 3).map((action) => (
                <li key={action.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-900">{action.timingLabel}</p>
                    <StaleBadge stale={action.stale} />
                  </div>
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
  const comparisons = displayedComparisons(brief.comparisons);
  const visibleComparisons = comparisons.slice(0, BRIEF_SECTION_CAPS.comparisons);
  const hiddenComparisons = hiddenCount(brief.preview.comparisons.total, BRIEF_SECTION_CAPS.comparisons);
  const hasEvidence = briefHasTrackedEvidence(snapshotFromBrief(brief));
  const processingIssues = brief.systemAttention.filter((item) => isOperationalAnalysisAttention(item.type));
  const hiddenTerms = Math.max(0, brief.negotiation.terms.length - displayedTerms.length);

  return (
    <div className="space-y-5">
      {brief.since ? (
        <div className="rounded-sm border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-600">
          Showing changes after {timestamp(brief.since)}. Current open deal state remains visible.
        </div>
      ) : null}

      {hasEvidence ? null : (
        <div className="rounded-sm border border-zinc-200 bg-white px-4 py-5">
          <h2 className="text-sm font-semibold text-zinc-900">Add your first source</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-500">
            Upload a deal document or import an email. DealWatch will organize the terms, requests, and evidence for you.
          </p>
          <div className="mt-3 flex gap-2">
            <Link href={`/deals/${brief.deal.id}/documents`} className="inline-flex h-8 items-center rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white">Upload a document</Link>
            <Link href={`/deals/${brief.deal.id}/messages`} className="inline-flex h-8 items-center rounded-sm border border-zinc-200 px-3 text-xs font-medium text-zinc-800">Add messages</Link>
          </div>
        </div>
      )}

      <Section title="Needs you" eyebrow="Requests, deadlines, disagreements, and reviews that should come before everything else.">
        {brief.productAttention.length === 0 ? (
          hasEvidence ? (
            <div className="rounded-sm border border-emerald-100 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              Nothing in the current deal evidence requires action.
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Attention appears after documents or messages are added.</p>
          )
        ) : (
          <>
            <ul className="grid divide-y divide-zinc-100 lg:grid-cols-2 lg:divide-y-0 lg:gap-x-8">
              {brief.productAttention.slice(0, BRIEF_SECTION_CAPS.attention).map((item) => <AttentionItem key={item.id} item={item} />)}
            </ul>
            {hiddenCount(brief.preview.attention.total, BRIEF_SECTION_CAPS.attention) > 0 ? (
              <ExpandableRemainder label={remainderLabel("attention", hiddenCount(brief.preview.attention.total, BRIEF_SECTION_CAPS.attention))}>
                <ul className="grid divide-y divide-zinc-100 lg:grid-cols-2 lg:divide-y-0 lg:gap-x-8">
                  {brief.productAttention.slice(BRIEF_SECTION_CAPS.attention).map((item) => <AttentionItem key={item.id} item={item} />)}
                </ul>
              </ExpandableRemainder>
            ) : null}
          </>
        )}
      </Section>

      <ActionPanel actions={brief.actions} />

      <ActionEvidenceReview dealId={brief.deal.id} items={actionEvidence} />

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Current terms" eyebrow="What the formal paper currently says. Communication does not change these positions.">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
            <SourcePill kind="FORMAL_NEGOTIATION" />
            <span>{brief.negotiation.summary.openCount} open</span>
            <span className="text-zinc-300">•</span>
            <span>{brief.negotiation.summary.agreedCount} agreed</span>
            <span className="text-zinc-300">•</span>
            <span className={brief.negotiation.summary.conflictCount ? "font-semibold text-red-700" : ""}>{brief.negotiation.summary.conflictCount} conflicts</span>
            {brief.negotiation.summary.rejectedCount > 0 ? (
              <>
                <span className="text-zinc-300">•</span>
                <span>{brief.negotiation.summary.rejectedCount} rejected</span>
              </>
            ) : null}
            {brief.negotiation.summary.withdrawnCount > 0 ? (
              <>
                <span className="text-zinc-300">•</span>
                <span>{brief.negotiation.summary.withdrawnCount} withdrawn</span>
              </>
            ) : null}
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
                    <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${formalStatusClass(term.briefStatus)}`}>
                      {term.statusLabel}
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

        <Section title="What changed" eyebrow="Meaningful movement. Processing events stay out of this list.">
          {brief.recentChanges.length === 0 ? (
            <p className="text-sm text-zinc-500">
              {brief.since ? `No meaningful changes since ${timestamp(brief.since)}.` : "No recent meaningful deal changes."}
            </p>
          ) : (
            <>
            <ul className="divide-y divide-zinc-100">
              {brief.recentChanges.slice(0, BRIEF_SECTION_CAPS.changes).map((change) => (
                <li key={change.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2"><SourcePill kind={change.sourceKind} /><span className="text-[10px] text-zinc-400">{timestamp(change.timestamp)}</span></div>
                  <p className="mt-1.5 text-xs font-semibold text-zinc-900">{change.label}</p>
                  {change.description ? <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{change.description}</p> : null}
                  <div className="mt-1"><SourceLink href={change.source.href} /></div>
                </li>
              ))}
            </ul>
            {hiddenCount(brief.preview.changes.total, BRIEF_SECTION_CAPS.changes) > 0 ? (
              <ExpandableRemainder label={remainderLabel("changes", hiddenCount(brief.preview.changes.total, BRIEF_SECTION_CAPS.changes))}>
                <ul className="divide-y divide-zinc-100">
                  {brief.recentChanges.slice(BRIEF_SECTION_CAPS.changes).map((change) => (
                    <li key={change.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2"><SourcePill kind={change.sourceKind} /><span className="text-[10px] text-zinc-400">{timestamp(change.timestamp)}</span></div>
                      <p className="mt-1.5 text-xs font-semibold text-zinc-900">{change.label}</p>
                      {change.description ? <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{change.description}</p> : null}
                      <div className="mt-1"><SourceLink href={change.source.href} /></div>
                    </li>
                  ))}
                </ul>
                {brief.preview.changes.total > brief.preview.changes.returned ? (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    {brief.preview.changes.total - brief.preview.changes.returned} additional {brief.preview.changes.total - brief.preview.changes.returned === 1 ? "change is" : "changes are"} outside this preview.
                  </p>
                ) : null}
              </ExpandableRemainder>
            ) : null}
            </>
          )}
        </Section>
      </div>

      {visibleComparisons.length > 0 ? (
        <Section title="Paper and email" eyebrow="DealWatch shows the disagreement. It does not decide which source is right. The paper stays the formal position.">
          <p className="mb-4 text-xs text-zinc-500">A difference here is evidence to inspect, not an automatic correction.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleComparisons.map((comparison) => (
              <article key={comparison.id} className={`rounded-sm border p-3 ${comparison.outcome === "DIFFERS" ? "border-amber-200 bg-amber-50/40" : "border-zinc-200"}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900">{comparison.label}</h3>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase ${comparison.outcome === "DIFFERS" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
                    {comparisonOutcomeLabel(comparison.outcome)}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-400">{comparison.side.toLowerCase()} position</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="border-r border-zinc-200 pr-3">
                    <p className="text-[11px] font-medium text-zinc-500">On the paper</p>
                    <p className="mt-2 text-base font-semibold text-zinc-900">{comparison.formal.value}</p>
                    {comparison.formal.source?.label ? <p className="mt-1 text-[11px] text-zinc-600">{comparison.formal.source.label}</p> : null}
                    {comparison.formal.evidenceQuote ? <p className="mt-1 text-[11px] leading-4 text-zinc-600">“{comparison.formal.evidenceQuote}”</p> : null}
                    {comparison.formal.pageLabel ? <p className="mt-0.5 text-[10px] text-zinc-500">{comparison.formal.pageLabel}</p> : null}
                    <p className="mt-1 text-[10px] text-zinc-500">{comparison.formal.reviewState ? `Paper review · ${comparison.formal.reviewState === "ACCEPTED" ? "Confirmed" : comparison.formal.reviewState === "CORRECTED" ? "Corrected" : comparison.formal.reviewState === "REJECTED" ? "Rejected" : comparison.formal.reviewState}` : "Not reviewed yet. The detected paper value is what DealWatch is using."}</p>
                    <div className="mt-2"><SourceLink href={comparison.formal.source?.href ?? null} label="View document" /></div>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-zinc-500">In the latest reviewed email</p>
                    <p className="mt-2 text-base font-semibold text-zinc-900">{comparison.communication.value}</p>
                    <p className="mt-1 text-[11px] text-zinc-600">{comparison.communication.subject}</p>
                    <p className="text-[11px] text-zinc-500">{comparison.communication.sender}</p>
                    <p className="mt-1 text-[11px] leading-4 text-zinc-600">“{comparison.communication.evidenceQuote}”</p>
                    <p className="mt-1 text-[10px] text-zinc-500">Email review · {comparison.communication.reviewState === "CONFIRMED" ? "Confirmed" : comparison.communication.reviewState ?? "Not reviewed"}</p>
                    {comparison.communication.corrected ? <p className="mt-0.5 text-[10px] text-amber-700">Reviewed correction{comparison.communication.rawValue ? ` · originally ${comparison.communication.rawValue}` : ""}</p> : null}
                    <div className="mt-2"><SourceLink href={comparison.communication.source.href} label="View message" /></div>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {hiddenComparisons > 0 ? (
            <ExpandableRemainder label={remainderLabel("comparisons", hiddenComparisons)}>
              <div className="grid gap-3 lg:grid-cols-2">
                {comparisons.slice(BRIEF_SECTION_CAPS.comparisons).map((comparison) => (
                  <article key={comparison.id} className="rounded-sm border border-zinc-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-zinc-900">{comparison.label}</h3>
                      <span className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-zinc-700">{comparisonOutcomeLabel(comparison.outcome)}</span>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">{comparison.formal.value} on the paper · {comparison.communication.value} in communication</p>
                  </article>
                ))}
              </div>
            </ExpandableRemainder>
          ) : null}
        </Section>
      ) : null}

      <Section title="Recent emails" eyebrow="What people said. These notes never become the formal paper on their own.">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-sky-100 bg-sky-50 px-3 py-2">
          <p className="text-[11px] text-sky-900">Communication evidence never sets or changes the formal negotiation position.</p>
          <Link href={`/deals/${brief.deal.id}/messages`} className="text-[11px] font-semibold text-sky-900 underline">Open all messages</Link>
        </div>
        {brief.communications.length === 0 ? (
          <p className="text-sm text-zinc-500">{brief.since ? "No communications arrived in this catch-up window." : "No communications in the current view."}</p>
        ) : (
          <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {brief.communications.slice(0, BRIEF_SECTION_CAPS.communications).map((communication) => (
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
                ) : <p className="mt-2 text-[11px] text-zinc-400">Nothing commercial was noted in this email.</p>}
                <div className="mt-3"><SourceLink href={communication.source.href} label="View message" /></div>
              </article>
            ))}
          </div>
          {hiddenCount(brief.preview.communications.total, BRIEF_SECTION_CAPS.communications) > 0 ? (
            <p className="mt-3 text-[11px] font-semibold text-zinc-800">
              <Link href={`/deals/${brief.deal.id}/messages`} className="underline decoration-zinc-300 underline-offset-2">
                {remainderLabel("communications", hiddenCount(brief.preview.communications.total, BRIEF_SECTION_CAPS.communications))}
              </Link>
            </p>
          ) : null}
          </>
        )}
      </Section>

      <Section title="Processing problems" eyebrow="These are analysis issues, separate from commercial work. Your uploaded files and emails are still saved.">
        {brief.systemAttention.length === 0 ? (
          <p className="text-sm text-zinc-500">No internal review work is outstanding.</p>
        ) : (
          <div className="space-y-4">
            {processingIssues.length > 0 ? (
              <div>
                <Link href={processingIssuesInboxHref(brief.deal.id)} className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 underline decoration-zinc-300 underline-offset-2">
                  {processingIssues.length} Processing {processingIssues.length === 1 ? "issue" : "issues"}
                </Link>
                <ul className="mt-2 divide-y divide-zinc-100">
                  {processingIssues.map((item) => (
                    <li key={item.id} className="py-2">
                      <p className="text-xs font-semibold text-zinc-900">{item.label}</p>
                      {item.description ? <p className="mt-0.5 text-[11px] text-zinc-500">{item.description}</p> : null}
                      <SourceLink href={item.href} label="View source" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-zinc-600">{brief.systemAttention.length} internal review {brief.systemAttention.length === 1 ? "item is" : "items are"} available without displacing deal attention.</p>
              <Link href={`/inbox?dealId=${brief.deal.id}`} className="text-xs font-semibold text-zinc-800 underline decoration-zinc-300 underline-offset-2">Open review queue</Link>
            </div>
          </div>
        )}
      </Section>

      <Section title="Recent history" eyebrow="A short chronology. Open Activity for the full deal history.">
        {brief.timeline.length === 0 ? (
          <p className="text-sm text-zinc-500">{brief.since ? "No timeline events occurred in this catch-up window." : "No source chronology in the current view."}</p>
        ) : (
          <ol className="grid gap-x-6 gap-y-0 md:grid-cols-2">
            {brief.timeline.slice(0, BRIEF_SECTION_CAPS.timeline).map((item) => (
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
        {hiddenCount(brief.preview.timeline.total, BRIEF_SECTION_CAPS.timeline) > 0 ? (
          <p className="mt-3 text-[11px] font-semibold text-zinc-800">
            <Link href={`/deals/${brief.deal.id}/activity`} className="underline decoration-zinc-300 underline-offset-2">
              {remainderLabel("timeline", hiddenCount(brief.preview.timeline.total, BRIEF_SECTION_CAPS.timeline))}
            </Link>
          </p>
        ) : null}
      </Section>
    </div>
  );
}
