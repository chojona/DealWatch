import Link from "next/link";
import { ActionEvidenceReview } from "@/components/deals/action-evidence-review";
import { Button } from "@/components/ui/button";
import { CommercialValue } from "@/components/ui/commercial-value";
import { ComparisonValue } from "@/components/ui/comparison-value";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { EvidenceQuote } from "@/components/ui/evidence-quote";
import { SourceLink } from "@/components/ui/source-link";
import { StatusChip } from "@/components/ui/status-chip";
import { Status } from "@/components/ui/status";
import type { ActionEvidenceReviewItem } from "@/lib/deals/actions/evidenceReviewView";
import type { DealAction, DealActionState, DealCourt } from "@/lib/deals/actions/types";
import {
  BRIEF_SECTION_CAPS,
  displayedComparisons,
  hiddenCount,
  isOperationalAnalysisAttention,
  processingIssuesInboxHref,
  remainderLabel,
} from "@/lib/deals/brief/presentation";
import type {
  DealBrief,
  DealBriefAttentionItem,
  DealBriefChange,
  DealBriefCommunication,
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

function shortDate(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function position(positionValue: NegotiationPositionView | null): string {
  if (!positionValue) return "—";
  if (positionValue.kind === "CONFLICT") return `${positionValue.candidates.length} conflicting candidates`;
  return positionValue.value.summary;
}

function sourcePhrase(kind: DealBriefSourceKind): string {
  if (kind === "COMMUNICATION_EVIDENCE") return "Email";
  if (kind === "LEGACY_ACTIVITY") return "Earlier activity";
  if (kind === "DOCUMENT") return "Document";
  return "Paper";
}

function sourceLinkLabel(kind: DealBriefSourceKind): string {
  if (kind === "COMMUNICATION_EVIDENCE") return "View email";
  if (kind === "LEGACY_ACTIVITY") return "View history";
  if (kind === "DOCUMENT" || kind === "FORMAL_NEGOTIATION") return "View document";
  return "View source";
}

const COMMERCIAL_CHANGES = new Set<DealBriefChange["type"]>([
  "FORMAL_PROPOSAL",
  "FORMAL_POSITION_CHANGED",
  "FORMAL_AGREEMENT",
  "MESSAGE_FACTS_ADDED",
  "MESSAGE_FACT_CORRECTED",
]);

const MAJOR_TERMS = new Set(["BASE_RENT", "TI_ALLOWANCE", "FREE_RENT", "LEASE_TERM"]);

function OverviewSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-t border-line pt-8 first:border-t-0 first:pt-0">
      <SectionHeader title={title} description={description} action={action} />
      {children}
    </section>
  );
}

function ExpandableRemainder({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">{label}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function AttentionItem({ item }: { item: DealBriefAttentionItem }) {
  return (
    <li className="flex items-start justify-between gap-4 py-4 first:pt-0">
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug text-ink">{item.label}</p>
        <p className="mt-1 text-[13px] text-ink-secondary">
          {sourcePhrase(item.sourceKind)}
          {item.timestamp ? ` · ${shortDate(item.timestamp)}` : ""}
        </p>
        {item.description ? <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{item.description}</p> : null}
      </div>
      <div className="shrink-0 pt-0.5">
        <SourceLink href={item.href} label={sourceLinkLabel(item.sourceKind)} />
      </div>
    </li>
  );
}

function termPresentation(term: DealBrief["negotiation"]["terms"][number]): { value: string; detail: string } {
  if (term.briefStatus === "AGREED" && term.agreedPosition) {
    return { value: position(term.agreedPosition), detail: "Agreed" };
  }
  const landlord = term.landlordPosition ? position(term.landlordPosition) : null;
  const tenant = term.tenantPosition ? position(term.tenantPosition) : null;
  if (landlord && tenant) {
    if (term.movement.side === "TENANT") {
      return { value: tenant, detail: `Tenant · Landlord ${landlord}` };
    }
    return { value: landlord, detail: `Landlord · Tenant ${tenant}` };
  }
  if (landlord) return { value: landlord, detail: "Landlord" };
  if (tenant) return { value: tenant, detail: "Tenant" };
  return { value: "No position yet", detail: "" };
}

function paperReview(state: string | null): string {
  if (state === "ACCEPTED") return "Paper review confirmed";
  if (state === "CORRECTED") return "Paper review corrected";
  if (state === "REJECTED") return "Paper review rejected";
  return "Not reviewed yet. The detected paper value is what DealWatch is using.";
}

function emailReview(state: string | null, corrected: boolean, rawValue: string | null): string {
  const review = state === "CONFIRMED"
    ? "Email review confirmed"
    : state === "INCORRECT"
      ? "Email review marked incorrect"
      : "Email not reviewed";
  if (!corrected) return review;
  return `${review}. Reviewed correction${rawValue ? `, originally ${rawValue}` : ""}`;
}

function ComparisonRow({ comparison }: { comparison: DealEvidenceComparison }) {
  const differs = comparison.outcome === "DIFFERS";
  const matched = comparison.outcome === "MATCH";
  return (
    <ComparisonValue
      label={comparison.label}
      different={differs}
      matched={matched}
      emailLabel="In the latest reviewed email"
      paper={{
        value: comparison.formal.value ?? "No paper value",
        detail: (
          <>
            <p>{[comparison.formal.source?.label, comparison.formal.pageLabel].filter(Boolean).join(" · ") || "Paper source"}</p>
            <p className="mt-1">{paperReview(comparison.formal.reviewState)}</p>
            {comparison.formal.evidenceQuote ? <EvidenceQuote className="mt-2">“{comparison.formal.evidenceQuote}”</EvidenceQuote> : null}
          </>
        ),
        source: <SourceLink href={comparison.formal.source?.href ?? null} label="View document" />,
      }}
      email={{
        value: comparison.communication.value,
        detail: (
          <>
            <p>{comparison.communication.sender}</p>
            <p className="mt-1">{comparison.communication.subject} · {shortDate(comparison.timestamp)}</p>
            <p className="mt-1">{emailReview(comparison.communication.reviewState, comparison.communication.corrected, comparison.communication.rawValue)}</p>
            <EvidenceQuote className="mt-2">“{comparison.communication.evidenceQuote}”</EvidenceQuote>
          </>
        ),
        source: <SourceLink href={comparison.communication.source.href} label="View email" />,
      }}
    />
  );
}

function dueLine(action: DealAction): string | null {
  if (action.dueText) {
    return /^due\b/i.test(action.dueText.trim()) ? action.dueText.trim() : `Due ${action.dueText.trim()}`;
  }
  if (action.timingLabel && action.timingLabel !== "Outstanding") return action.timingLabel;
  return null;
}

function ActionRequest({ action, quiet = false }: { action: DealAction; quiet?: boolean }) {
  const requestedBy = action.counterpartyLabel;
  const age = action.ageDays != null ? `${action.ageDays} ${action.ageDays === 1 ? "day" : "days"} ago` : shortDate(action.sourceTimestamp);
  const timingNamesAge = /day/i.test(action.timingLabel);
  const meta = [requestedBy ? `Requested by ${requestedBy}` : null, timingNamesAge ? null : age].filter(Boolean).join(" · ");
  const due = dueLine(action);
  return (
    <li className="py-4 first:pt-0">
      <p className={quiet ? "text-sm leading-snug text-ink-secondary" : "text-[15px] font-semibold leading-snug text-ink"}>
        {action.description}
      </p>
      {meta ? <p className="mt-1 text-[13px] text-ink-secondary">{meta}</p> : null}
      {due || action.stale ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
          {due ? <span>{due}</span> : null}
          {action.stale ? <Status tone="warning">Stale</Status> : null}
          {action.status === "CLOSED" ? <Status tone="neutral">Fulfilled</Status> : null}
        </p>
      ) : null}
      <div className="mt-2">
        <SourceLink href={action.source.href} label="View email" />
      </div>
    </li>
  );
}

function guidanceCopy(value: DealCourt): { title: string; body: string } | null {
  if (value === "COUNTERPARTY") {
    return {
      title: "Waiting on them",
      body: "Taken from reviewed requests. This does not change the paper.",
    };
  }
  if (value === "BOTH") {
    return {
      title: "Both sides",
      body: "Taken from reviewed requests. This does not change the paper.",
    };
  }
  if (value === "UNKNOWN") {
    return {
      title: "Not clear yet",
      body: "Reviewed messages do not say who owes the next response.",
    };
  }
  return null;
}

function ActionPanel({ actions }: { actions: DealActionState }) {
  const needsYouIds = new Set(actions.needsYou.map((action) => action.id));
  const otherOutstanding = actions.outstandingActions.filter((action) => !needsYouIds.has(action.id));
  const closed = actions.actions.filter((action) => action.status === "CLOSED").slice(0, 3);
  const shownRequestHrefs = new Set(actions.needsYou.map((action) => action.source.href));
  const upcoming = actions.upcoming.filter((item) => !shownRequestHrefs.has(item.href));
  const guidance = guidanceCopy(actions.court.value);
  const evidence = actions.court.evidence[0] ?? null;
  const hasExtra = upcoming.length > 0 || otherOutstanding.length > 0 || closed.length > 0;
  if (!hasExtra && actions.court.value !== "COUNTERPARTY" && actions.court.value !== "BOTH") {
    return null;
  }
  return (
    <OverviewSection
      title="What to do next"
      description="Broader guidance from reviewed requests. Outstanding work on your side stays above."
    >
      <div className="space-y-6">
        {guidance ? (
          <div>
            <p className="text-[15px] font-semibold text-ink">{guidance.title}</p>
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-secondary">{guidance.body}</p>
            {evidence ? (
              <div className="mt-2">
                <SourceLink href={evidence.href} label="View email" />
              </div>
            ) : null}
          </div>
        ) : null}
        {upcoming.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-ink">Upcoming</h3>
            <ul className="mt-2 divide-y divide-line">
              {upcoming.slice(0, 3).map((item) => (
                <li key={item.id} className="py-3 first:pt-0">
                  <p className="text-sm font-medium text-ink">{item.label}</p>
                  <p className="mt-1 text-[13px] text-ink-secondary">
                    {item.timingLabel}
                    {item.at ? ` · ${shortDate(item.at)}` : ""}
                  </p>
                  <div className="mt-2">
                    <SourceLink href={item.href} label="View email" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {otherOutstanding.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-ink">Still open</h3>
            <ul className="divide-y divide-line">
              {otherOutstanding.slice(0, 3).map((action) => (
                <ActionRequest key={action.id} action={action} />
              ))}
            </ul>
          </div>
        ) : null}
        {closed.length > 0 ? (
          <div>
            <h3 className="text-sm font-medium text-ink-secondary">Handled</h3>
            <ul className="divide-y divide-line">
              {closed.map((action) => (
                <ActionRequest key={action.id} action={action} quiet />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </OverviewSection>
  );
}

function ChangeRow({ change }: { change: DealBriefChange }) {
  const commercial = COMMERCIAL_CHANGES.has(change.type);
  return (
    <li className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[4.75rem_minmax(0,1fr)] sm:gap-4">
      <time dateTime={change.timestamp} className="text-[13px] text-ink-secondary">
        {shortDate(change.timestamp)}
      </time>
      <div className="min-w-0">
        <p className={commercial ? "text-[15px] font-medium leading-snug text-ink" : "text-sm leading-snug text-ink-secondary"}>
          {change.label}
        </p>
        {change.description ? <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{change.description}</p> : null}
        <p className="mt-1 text-[13px] text-ink-muted">{sourcePhrase(change.sourceKind)}</p>
        <div className="mt-2">
          <SourceLink href={change.source.href} label={sourceLinkLabel(change.sourceKind)} />
        </div>
      </div>
    </li>
  );
}

function afterCatchUp(timestamp: string | null, since: string | null): boolean {
  if (!since) return true;
  if (!timestamp) return false;
  return new Date(timestamp).getTime() > new Date(since).getTime();
}

function emailReviewState(communication: DealBriefCommunication): string | null {
  if (communication.reviewState === "NEEDS_FOLLOW_UP") return "Follow-up marked";
  if (communication.lifecycleState === "ANALYSIS_FAILED") return "Analysis failed";
  if (communication.reviewState === "REVIEW_REQUIRED" || communication.lifecycleState === "REVIEW_REQUIRED") return "Needs review";
  if (communication.reviewState === "REVIEWED" || communication.lifecycleState === "REVIEWED") return "Reviewed";
  return null;
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
  const comparisons = [...displayedComparisons(brief.comparisons)].sort(
    (left, right) => Number(right.outcome === "DIFFERS") - Number(left.outcome === "DIFFERS"),
  );
  const visibleComparisons = comparisons.slice(0, BRIEF_SECTION_CAPS.comparisons);
  const hiddenComparisons = hiddenCount(brief.preview.comparisons.total, BRIEF_SECTION_CAPS.comparisons);
  const hasEvidence = briefHasTrackedEvidence(snapshotFromBrief(brief));
  const systemAttention = brief.systemAttention.filter((item) => afterCatchUp(item.timestamp, brief.since));
  const processingIssues = systemAttention.filter((item) => isOperationalAnalysisAttention(item.type));
  const hiddenTerms = Math.max(0, brief.negotiation.terms.length - displayedTerms.length);
  const summary = brief.negotiation.summary;

  if (!hasEvidence) {
    return (
      <div>
        {brief.since ? (
          <p className="mb-6 text-sm text-ink-secondary">
            Showing changes after {timestamp(brief.since)}. Current open deal state remains visible.
          </p>
        ) : null}
        <EmptyState
          title="No sources yet"
          description="Add a document or import an email to start building the deal."
          actions={(
            <>
              <Button asChild>
                <Link href={`/deals/${brief.deal.id}/documents`}>Upload document</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/deals/${brief.deal.id}/messages`}>Import email</Link>
              </Button>
            </>
          )}
        />
      </div>
    );
  }

  return (
    <div>
      {brief.since ? (
        <p className="mb-8 text-sm text-ink-secondary">
          Showing changes after {timestamp(brief.since)}. Current open deal state remains visible.
        </p>
      ) : null}

      <OverviewSection
        id="actions"
        title="Needs you"
        description="Outstanding work from the current deal evidence."
      >
        {brief.actions.needsYou.length > 0 ? (
          <ul className="divide-y divide-line">
            {brief.actions.needsYou.map((action) => (
              <ActionRequest key={action.id} action={action} />
            ))}
          </ul>
        ) : null}
        {brief.productAttention.length === 0 && brief.actions.needsYou.length === 0 ? (
          <p className="text-sm text-ink-secondary">Nothing in the current deal evidence requires action.</p>
        ) : brief.productAttention.length > 0 ? (
          <>
            <ul className={`divide-y divide-line ${brief.actions.needsYou.length > 0 ? "mt-2 border-t border-line" : ""}`}>
              {brief.productAttention.slice(0, BRIEF_SECTION_CAPS.attention).map((item) => (
                <AttentionItem key={item.id} item={item} />
              ))}
            </ul>
            {hiddenCount(brief.preview.attention.total, BRIEF_SECTION_CAPS.attention) > 0 ? (
              <ExpandableRemainder label={remainderLabel("attention", hiddenCount(brief.preview.attention.total, BRIEF_SECTION_CAPS.attention))}>
                <ul className="divide-y divide-line">
                  {brief.productAttention.slice(BRIEF_SECTION_CAPS.attention).map((item) => (
                    <AttentionItem key={item.id} item={item} />
                  ))}
                </ul>
              </ExpandableRemainder>
            ) : null}
          </>
        ) : null}
      </OverviewSection>

      <ActionPanel actions={brief.actions} />

      <OverviewSection
        title="Current terms"
        description="What the formal paper currently says. Email does not change these positions."
        action={<SourceLink href={`/deals/${brief.deal.id}/negotiation`} label="View negotiation" />}
      >
        <p className="mb-6 text-[13px] text-ink-secondary">
          <span>{summary.openCount} open</span>
          <span> · {summary.agreedCount} agreed</span>
          <span> · {summary.conflictCount} {summary.conflictCount === 1 ? "conflict" : "conflicts"}</span>
          {summary.rejectedCount > 0 ? <span> · {summary.rejectedCount} rejected</span> : null}
          {summary.withdrawnCount > 0 ? <span> · {summary.withdrawnCount} withdrawn</span> : null}
        </p>
        {displayedTerms.length === 0 ? (
          <p className="text-sm text-ink-secondary">No formal negotiation positions are stored yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayedTerms.map((term) => {
              const presented = termPresentation(term);
              return (
                <CommercialValue
                  key={term.canonicalType}
                  label={term.label}
                  value={presented.value}
                  detail={presented.detail}
                  status={<StatusChip status={term.briefStatus}>{term.statusLabel}</StatusChip>}
                  source={(
                    <SourceLink
                      href={term.provenance.evidenceHref ?? term.source?.href ?? null}
                      label={sourceLinkLabel(term.source?.kind ?? "FORMAL_NEGOTIATION")}
                    />
                  )}
                />
              );
            })}
          </div>
        )}
        {hiddenTerms > 0 ? (
          <p className="mt-6 text-[13px] text-ink-muted">
            {hiddenTerms} additional stable {hiddenTerms === 1 ? "term" : "terms"}
          </p>
        ) : null}
      </OverviewSection>

      {brief.recentChanges.length > 0 || brief.since ? (
        <OverviewSection
          title="What changed"
          description="Commercial movement since the last look. Processing stays quieter than a change in terms."
        >
          {brief.recentChanges.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              {brief.since ? `No meaningful changes since ${timestamp(brief.since)}.` : "No recent meaningful deal changes."}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {brief.recentChanges.slice(0, BRIEF_SECTION_CAPS.changes).map((change) => (
                  <ChangeRow key={change.id} change={change} />
                ))}
              </ul>
              {hiddenCount(brief.preview.changes.total, BRIEF_SECTION_CAPS.changes) > 0 ? (
                <ExpandableRemainder label={remainderLabel("changes", hiddenCount(brief.preview.changes.total, BRIEF_SECTION_CAPS.changes))}>
                  <ul className="divide-y divide-line">
                    {brief.recentChanges.slice(BRIEF_SECTION_CAPS.changes).map((change) => (
                      <ChangeRow key={change.id} change={change} />
                    ))}
                  </ul>
                  {brief.preview.changes.total > brief.preview.changes.returned ? (
                    <p className="mt-3 text-[13px] text-ink-secondary">
                      {brief.preview.changes.total - brief.preview.changes.returned} additional {brief.preview.changes.total - brief.preview.changes.returned === 1 ? "change is" : "changes are"} outside this preview.
                    </p>
                  ) : null}
                </ExpandableRemainder>
              ) : null}
            </>
          )}
        </OverviewSection>
      ) : null}

      {visibleComparisons.length > 0 ? (
        <OverviewSection
          title="Paper and email"
          description="A difference is evidence to inspect. Neither side is automatically right, and email does not change the formal paper."
        >
          <div className="space-y-8">
            {visibleComparisons.map((comparison) => (
              <ComparisonRow key={comparison.id} comparison={comparison} />
            ))}
          </div>
          {hiddenComparisons > 0 ? (
            <ExpandableRemainder label={remainderLabel("comparisons", hiddenComparisons)}>
              <div className="space-y-8">
                {comparisons.slice(BRIEF_SECTION_CAPS.comparisons).map((comparison) => (
                  <ComparisonRow key={comparison.id} comparison={comparison} />
                ))}
              </div>
            </ExpandableRemainder>
          ) : null}
        </OverviewSection>
      ) : null}

      {brief.communications.length > 0 || brief.since ? (
        <OverviewSection
          title="Recent emails"
          description="What people said. These notes never become the formal paper on their own."
          action={(
            <Link href={`/deals/${brief.deal.id}/messages`} className="source-link">
              View all emails
              <span aria-hidden="true">→</span>
            </Link>
          )}
        >
          {brief.communications.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              {brief.since ? "No communications arrived in this catch-up window." : "No communications in the current view."}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {brief.communications.slice(0, BRIEF_SECTION_CAPS.communications).map((communication) => {
                  const review = emailReviewState(communication);
                  const fact = communication.facts[0] ?? null;
                  return (
                    <li key={communication.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{communication.sender.label}</p>
                        <h3 className="mt-0.5 truncate text-[13px] font-medium text-ink-secondary">{communication.subject}</h3>
                        {fact ? (
                          <p className="mt-1 text-[13px] text-ink-secondary">
                            {fact.label}: {fact.presentation.value}
                            {fact.presentation.corrected ? " · reviewed correction" : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end">
                        <time dateTime={communication.timestamp} className="text-[13px] text-ink-muted">
                          {shortDate(communication.timestamp)}
                        </time>
                        {review ? <Status tone="neutral">{review}</Status> : null}
                        <SourceLink href={communication.source.href} label="View email" />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {hiddenCount(brief.preview.communications.total, BRIEF_SECTION_CAPS.communications) > 0 ? (
                <p className="mt-4">
                  <Link href={`/deals/${brief.deal.id}/messages`} className="source-link">
                    {remainderLabel("communications", hiddenCount(brief.preview.communications.total, BRIEF_SECTION_CAPS.communications))}
                    <span aria-hidden="true">→</span>
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </OverviewSection>
      ) : null}

      {systemAttention.length > 0 || actionEvidence.length > 0 ? (
        <OverviewSection
          title="Processing and review"
          description="Analysis and review work. This stays separate from commercial terms and requests."
          action={
            systemAttention.length > 0 ? (
              <Link href={`/inbox?dealId=${brief.deal.id}`} className="source-link">
                Open review queue
                <span aria-hidden="true">→</span>
              </Link>
            ) : null
          }
        >
          {processingIssues.length > 0 ? (
            <p className="mb-3">
              <Link href={processingIssuesInboxHref(brief.deal.id)} className="source-link">
                {processingIssues.length} Processing {processingIssues.length === 1 ? "issue" : "issues"}
                <span aria-hidden="true">→</span>
              </Link>
            </p>
          ) : null}
          {systemAttention.length > 0 ? (
            <ul className="divide-y divide-line">
              {systemAttention.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{item.label}</p>
                    {item.description ? <p className="mt-1 text-[13px] leading-5 text-ink-secondary">{item.description}</p> : null}
                  </div>
                  <SourceLink href={item.href} label="View source" />
                </li>
              ))}
            </ul>
          ) : null}
          {actionEvidence.length > 0 ? (
            <div className="mt-6">
              <ActionEvidenceReview dealId={brief.deal.id} items={actionEvidence} headingLevel="h3" />
            </div>
          ) : null}
        </OverviewSection>
      ) : null}

      {brief.timeline.length > 0 || brief.since ? (
        <OverviewSection
          title="Short history"
          description="Enough chronology to orient you. Earlier activity is not the current paper."
          action={<SourceLink href={`/deals/${brief.deal.id}/activity`} label="View history" />}
        >
          {brief.timeline.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              {brief.since ? "No timeline events occurred in this catch-up window." : "No source chronology in the current view."}
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {brief.timeline.slice(0, BRIEF_SECTION_CAPS.timeline).map((item) => (
                <li key={item.id} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[4.75rem_minmax(0,1fr)] sm:gap-4">
                  <time dateTime={item.occurredAt ?? item.recordedAt ?? undefined} className="text-[13px] text-ink-muted">
                    {shortDate(item.occurredAt ?? item.recordedAt)}
                  </time>
                  <div className="min-w-0">
                    <p className="text-sm text-ink-secondary">
                      {item.sourceKind === "LEGACY_ACTIVITY" ? "Earlier activity · " : ""}
                      {item.title}
                    </p>
                    {item.description ? <p className="mt-1 text-[13px] leading-5 text-ink-muted">{item.description}</p> : null}
                    <div className="mt-2">
                      <SourceLink href={item.source.href} label={sourceLinkLabel(item.sourceKind)} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {hiddenCount(brief.preview.timeline.total, BRIEF_SECTION_CAPS.timeline) > 0 ? (
            <p className="mt-4">
              <Link href={`/deals/${brief.deal.id}/activity`} className="source-link">
                {remainderLabel("timeline", hiddenCount(brief.preview.timeline.total, BRIEF_SECTION_CAPS.timeline))}
                <span aria-hidden="true">→</span>
              </Link>
            </p>
          ) : null}
        </OverviewSection>
      ) : null}
    </div>
  );
}
