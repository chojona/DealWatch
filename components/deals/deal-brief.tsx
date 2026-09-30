import Link from "next/link";
import { ActionEvidenceReview } from "@/components/deals/action-evidence-review";
import { Button } from "@/components/ui/button";
import { CommercialValue } from "@/components/ui/commercial-value";
import { ComparisonValue } from "@/components/ui/comparison-value";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceQuote } from "@/components/ui/evidence-quote";
import { SourceLink } from "@/components/ui/source-link";
import { Status, type StatusTone } from "@/components/ui/status";
import type { ActionEvidenceReviewItem } from "@/lib/deals/actions/evidenceReviewView";
import type { DealAction, DealActionState, DealCourt } from "@/lib/deals/actions/types";
import type { DealBriefFormalStatus } from "@/lib/deals/brief/formalStatus";
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

function positionLines(positionValue: NegotiationPositionView | null): string[] {
  if (!positionValue) return [];
  if (positionValue.kind === "CONFLICT") {
    return positionValue.candidates.map((candidate) => candidate.value.summary).filter(Boolean);
  }
  return [positionValue.value.summary];
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

function formalTone(status: DealBriefFormalStatus): StatusTone {
  switch (status) {
    case "AGREED":
      return "success";
    case "CONFLICT":
    case "REJECTED":
      return "danger";
    case "OPEN":
      return "warning";
    case "WITHDRAWN":
    case "NOT_MENTIONED":
    case "UNKNOWN":
      return "neutral";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function sourceTone(kind: DealBriefSourceKind): { label: string; tone: StatusTone } {
  if (kind === "COMMUNICATION_EVIDENCE") return { label: "Email", tone: "info" };
  if (kind === "LEGACY_ACTIVITY") return { label: "Earlier activity", tone: "neutral" };
  if (kind === "DOCUMENT") return { label: "Document", tone: "brand" };
  return { label: "On the paper", tone: "brand" };
}

function attentionTone(type: DealBriefAttentionItem["type"]): { label: string; tone: StatusTone } {
  switch (type) {
    case "NEGOTIATION_CONFLICT":
      return { label: "Conflict", tone: "danger" };
    case "COMMUNICATION_FORMAL_DIFFERENCE":
      return { label: "Different", tone: "warning" };
    case "NEGOTIATION_REJECTED":
    case "MESSAGE_ANALYSIS_FAILED":
    case "DOCUMENT_ANALYSIS_FAILED":
      return { label: type === "NEGOTIATION_REJECTED" ? "Rejected" : "Analysis failed", tone: "danger" };
    case "NEGOTIATION_WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral" };
    case "NEGOTIATION_UNRESOLVED":
      return { label: "Open", tone: "warning" };
    case "MESSAGE_REVIEW_REQUIRED":
    case "DOCUMENT_REVIEW_REQUIRED":
    case "ENTITY_REVIEW_REQUIRED":
    case "RELATIONSHIP_REVIEW_REQUIRED":
    case "PROVENANCE_REVIEW_REQUIRED":
    case "MESSAGE_ACTION_EVIDENCE_PENDING":
    case "NEW_COMMERCIAL_EVIDENCE":
    case "ATTACHMENT_PROMOTION_AVAILABLE":
      return { label: "Needs review", tone: "warning" };
    case "MESSAGE_FOLLOW_UP":
      return { label: "Follow-up", tone: "warning" };
    case "REVIEWED_DEADLINE":
      return { label: "Needs you", tone: "warning" };
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

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
    <section id={id} className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-[18px] text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs leading-4 text-ink-secondary">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function ExpandableRemainder({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="border-t border-line px-4 py-2.5">
      <summary className="cursor-pointer text-[13px] font-medium text-ink">{label}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function AttentionItem({ item }: { item: DealBriefAttentionItem }) {
  const tone = attentionTone(item.type);
  const fromEmail = item.sourceKind === "COMMUNICATION_EVIDENCE";
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Status tone={tone.tone}>{tone.label}</Status>
        {item.timestamp ? (
          <time dateTime={item.timestamp} className="text-[11px] leading-[15px] text-ink-muted">{shortDate(item.timestamp)}</time>
        ) : null}
      </div>
      <p className="text-[13px] font-semibold leading-[18px] text-ink">{item.label}</p>
      {item.description ? <p className="text-xs leading-4 text-ink-secondary">{item.description}</p> : null}
      {fromEmail ? <p className="text-xs leading-4 text-ink-secondary">This does not change the paper.</p> : null}
      <SourceLink href={item.href} label={sourceLinkLabel(item.sourceKind)} />
    </li>
  );
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
  const paperCitation = [comparison.formal.source?.label, comparison.formal.pageLabel].filter(Boolean).join(" · ");
  return (
    <ComparisonValue
      label={comparison.label}
      different={differs}
      matched={matched}
      emailLabel="In the latest reviewed email"
      paper={{
        value: comparison.formal.value ?? "No paper value",
        quote: comparison.formal.evidenceQuote,
        citation: paperCitation || null,
        detail: paperReview(comparison.formal.reviewState),
        source: <SourceLink href={comparison.formal.source?.href ?? null} label="View document" />,
      }}
      email={{
        value: comparison.communication.value,
        quote: comparison.communication.evidenceQuote,
        citation: [comparison.communication.sender, comparison.communication.subject, shortDate(comparison.timestamp)].filter(Boolean).join(" · "),
        detail: emailReview(comparison.communication.reviewState, comparison.communication.corrected, comparison.communication.rawValue),
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

function ActionRequest({
  action,
  quiet = false,
  emphasis = false,
}: {
  action: DealAction;
  quiet?: boolean;
  emphasis?: boolean;
}) {
  const requestedBy = action.counterpartyLabel;
  const age = action.ageDays != null ? `${action.ageDays} ${action.ageDays === 1 ? "day" : "days"} ago` : shortDate(action.sourceTimestamp);
  const timingNamesAge = /day/i.test(action.timingLabel);
  const meta = [requestedBy ? `Requested by ${requestedBy}` : null, timingNamesAge ? null : age].filter(Boolean).join(" · ");
  const due = dueLine(action);
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {action.status === "CLOSED" ? <Status tone="neutral">Fulfilled</Status> : null}
        {emphasis ? <Status tone="warning">Needs you</Status> : null}
        {action.stale ? <Status tone="warning">Stale</Status> : null}
        <time dateTime={action.sourceTimestamp} className="text-[11px] leading-[15px] text-ink-muted">{shortDate(action.sourceTimestamp)}</time>
      </div>
      <p className={quiet ? "text-[13px] leading-[18px] text-ink-secondary" : "text-[13px] font-semibold leading-[18px] text-ink"}>
        {action.description}
      </p>
      {meta ? <p className="text-xs leading-4 text-ink-secondary">{meta}</p> : null}
      {due ? <p className="text-xs leading-4 text-ink-secondary">{due}</p> : null}
      {action.source.evidenceQuote ? <EvidenceQuote quote={action.source.evidenceQuote} /> : null}
      <p className="text-xs leading-4 text-ink-secondary">This does not change the paper.</p>
      <SourceLink href={action.source.href} label="View email" />
    </li>
  );
}

function guidanceCopy(value: DealCourt): { title: string; body: string } | null {
  if (value === "OUR_SIDE") {
    return {
      title: "Needs you",
      body: "Taken from reviewed requests. This does not change the paper.",
    };
  }
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
  if (!hasExtra && !guidance) {
    return null;
  }
  return (
    <OverviewSection
      title="What to do next"
      description="Requests taken from reviewed messages. The paper stays the formal position."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 sm:[&>*:not(:last-child)]:border-r sm:[&>*:not(:last-child)]:border-line">
        {guidance ? (
          <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
            <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Who should act</p>
            <p className="text-[13px] font-semibold leading-[18px] text-ink">{guidance.title}</p>
            <p className="text-xs leading-4 text-ink-secondary">{guidance.body}</p>
            {evidence?.evidenceQuote ? <EvidenceQuote quote={evidence.evidenceQuote} /> : null}
            {evidence ? <SourceLink href={evidence.href} label="View email" /> : null}
          </div>
        ) : null}
        {upcoming.length > 0 ? (
          <div className="min-w-0 px-4 py-3">
            <h3 className="text-[11px] font-medium leading-[15px] text-ink-muted">Upcoming</h3>
            <ul>
              {upcoming.slice(0, 3).map((item) => (
                <li key={item.id} className="mt-1 flex flex-col gap-1">
                  <p className="text-[13px] font-semibold leading-[18px] text-ink">{item.label}</p>
                  <p className="text-xs leading-4 text-ink-secondary">
                    {item.timingLabel}
                    {item.at ? ` · ${shortDate(item.at)}` : ""}
                  </p>
                  <SourceLink href={item.href} label="View email" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {otherOutstanding.length > 0 ? (
          <div className="min-w-0">
            <h3 className="px-4 pt-3 text-[11px] font-medium leading-[15px] text-ink-muted">Still open</h3>
            <ul>
              {otherOutstanding.slice(0, 3).map((action) => (
                <ActionRequest key={action.id} action={action} />
              ))}
            </ul>
          </div>
        ) : null}
        {closed.length > 0 ? (
          <div className="min-w-0">
            <h3 className="px-4 pt-3 text-[11px] font-medium leading-[15px] text-ink-muted">Handled</h3>
            <ul>
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

function termSourceLine(term: DealBrief["negotiation"]["terms"][number]): string | null {
  const parts = [term.source?.label, term.provenance.pageLabel].filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return term.provenance.evidenceLabel;
}

function PositionCell({
  label,
  lines,
}: {
  label: string;
  lines: string[];
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium leading-[15px] text-ink-muted md:sr-only">{label}</p>
      {lines.length === 0 ? (
        <p className="text-xs leading-4 text-ink-muted">—</p>
      ) : (
        lines.map((line, index) => (
          <CommercialValue key={`${label}-${index}`} layout="inline" value={line} />
        ))
      )}
    </div>
  );
}

function TermRow({ term }: { term: DealBrief["negotiation"]["terms"][number] }) {
  const agreed = term.briefStatus === "AGREED" && term.agreedPosition ? positionLines(term.agreedPosition) : [];
  const tenant = positionLines(term.tenantPosition);
  const landlord = positionLines(term.landlordPosition);
  const source = termSourceLine(term);
  const href = term.provenance.evidenceHref ?? term.source?.href ?? null;
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-line px-4 py-2 md:grid-cols-[minmax(8rem,10.5rem)_minmax(0,1fr)_minmax(0,1fr)_auto_minmax(12rem,1.3fr)] md:items-start md:gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-[18px] text-ink">{term.label}</p>
        {source ? <p className="break-words text-[11px] leading-[15px] text-ink-muted">{source}</p> : null}
      </div>
      {agreed.length > 0 ? (
        <div className="min-w-0 md:col-span-2">
          {agreed.map((line, index) => (
            <CommercialValue key={`agreed-${index}`} layout="inline" label="Agreed" value={line} />
          ))}
        </div>
      ) : (
        <>
          <PositionCell label="Tenant position" lines={tenant} />
          <PositionCell label="Landlord position" lines={landlord} />
        </>
      )}
      <div>
        <p className="text-[11px] font-medium leading-[15px] text-ink-muted md:sr-only">Status</p>
        <Status tone={formalTone(term.briefStatus)}>{term.statusLabel}</Status>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium leading-[15px] text-ink-muted md:sr-only">Evidence</p>
        {term.provenance.evidenceQuote ? (
          <EvidenceQuote quote={term.provenance.evidenceQuote} />
        ) : null}
        <SourceLink
          href={href}
          label="Evidence"
          ariaLabel={`Evidence for ${term.label}`}
        />
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: DealBriefChange }) {
  const commercial = COMMERCIAL_CHANGES.has(change.type);
  const origin = sourceTone(change.sourceKind);
  return (
    <li className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0">
      <Status tone={origin.tone}>{origin.label}</Status>
      <p className={commercial ? "text-[13px] font-semibold leading-[18px] text-ink" : "text-[13px] leading-[18px] text-ink-secondary"}>
        {change.label}
      </p>
      {change.description ? <p className="text-xs leading-4 text-ink-secondary">{change.description}</p> : null}
      <p className="text-xs leading-4 text-ink-muted">
        {sourcePhrase(change.sourceKind)} · <time dateTime={change.timestamp}>{shortDate(change.timestamp)}</time>
      </p>
      {change.sourceKind === "COMMUNICATION_EVIDENCE" ? (
        <p className="text-xs leading-4 text-ink-secondary">Does not change the paper.</p>
      ) : null}
      <SourceLink href={change.source.href} label={sourceLinkLabel(change.sourceKind)} />
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

  const showChanges = brief.recentChanges.length > 0 || Boolean(brief.since);

  return (
    <div className="flex flex-col gap-3">
      {brief.since ? (
        <p className="text-xs leading-4 text-ink-secondary">
          Showing changes after {timestamp(brief.since)}. Current open deal state remains visible.
        </p>
      ) : null}

      <OverviewSection
        id="actions"
        title="Needs you"
        description="Requests, deadlines, disagreements, and reviews before everything else."
      >
        {brief.productAttention.length === 0 && brief.actions.needsYou.length === 0 ? (
          <p className="px-4 py-3 text-xs leading-4 text-ink-secondary">Nothing in the current deal evidence requires action.</p>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 max-md:[&>li:last-child]:border-b-0 md:[&>li:nth-child(even)]:border-l md:[&>li:nth-child(even)]:border-line md:[&>li:nth-last-child(-n+2)]:border-b-0">
            {brief.actions.needsYou.map((action) => (
              <ActionRequest key={action.id} action={action} emphasis />
            ))}
            {brief.productAttention.slice(0, BRIEF_SECTION_CAPS.attention).map((item) => (
              <AttentionItem key={item.id} item={item} />
            ))}
          </ul>
        )}
        {hiddenCount(brief.preview.attention.total, BRIEF_SECTION_CAPS.attention) > 0 ? (
          <ExpandableRemainder label={remainderLabel("attention", hiddenCount(brief.preview.attention.total, BRIEF_SECTION_CAPS.attention))}>
            <ul className="grid grid-cols-1 md:grid-cols-2">
              {brief.productAttention.slice(BRIEF_SECTION_CAPS.attention).map((item) => (
                <AttentionItem key={item.id} item={item} />
              ))}
            </ul>
          </ExpandableRemainder>
        ) : null}
      </OverviewSection>

      <ActionPanel actions={brief.actions} />

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <OverviewSection
          title="Current terms"
          description="What the formal paper says. Communication does not change these positions."
          action={<SourceLink href={`/deals/${brief.deal.id}/negotiation`} label="View negotiation" />}
        >
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Status tone="brand">On the paper</Status>
            <p className="text-xs leading-4 text-ink-secondary">
              <span>{summary.openCount} open</span>
              <span> · {summary.agreedCount} agreed</span>
              <span className={summary.conflictCount > 0 ? "font-medium text-danger" : undefined}>
                {" · "}{summary.conflictCount} {summary.conflictCount === 1 ? "conflict" : "conflicts"}
              </span>
              {summary.rejectedCount > 0 ? <span> · {summary.rejectedCount} rejected</span> : null}
              {summary.withdrawnCount > 0 ? <span> · {summary.withdrawnCount} withdrawn</span> : null}
            </p>
          </div>
          {displayedTerms.length === 0 ? (
            <p className="border-t border-line px-4 py-3 text-xs leading-4 text-ink-secondary">No formal negotiation positions are stored yet.</p>
          ) : (
            <div>
              <div className="hidden border-t border-line px-4 py-1.5 text-[11px] font-medium leading-[15px] text-ink-muted md:grid md:grid-cols-[minmax(8rem,10.5rem)_minmax(0,1fr)_minmax(0,1fr)_auto_minmax(12rem,1.3fr)] md:gap-3">
                <span>Term</span>
                <span>Tenant position</span>
                <span>Landlord position</span>
                <span>Status</span>
                <span>Evidence</span>
              </div>
              {displayedTerms.map((term) => (
                <TermRow key={term.canonicalType} term={term} />
              ))}
            </div>
          )}
          {hiddenTerms > 0 ? (
            <p className="border-t border-line px-4 py-2 text-xs leading-4 text-ink-muted">
              {hiddenTerms} additional stable {hiddenTerms === 1 ? "term" : "terms"}
            </p>
          ) : null}
        </OverviewSection>

        {showChanges ? (
          <OverviewSection
            title="What changed"
            description="Meaningful movement. Processing events stay out of this list."
          >
            {brief.recentChanges.length === 0 ? (
              <p className="px-4 py-3 text-xs leading-4 text-ink-secondary">
                {brief.since ? `No meaningful changes since ${timestamp(brief.since)}.` : "No recent meaningful deal changes."}
              </p>
            ) : (
              <>
                <ul>
                  {brief.recentChanges.slice(0, BRIEF_SECTION_CAPS.changes).map((change) => (
                    <ChangeRow key={change.id} change={change} />
                  ))}
                </ul>
                {hiddenCount(brief.preview.changes.total, BRIEF_SECTION_CAPS.changes) > 0 ? (
                  <ExpandableRemainder label={remainderLabel("changes", hiddenCount(brief.preview.changes.total, BRIEF_SECTION_CAPS.changes))}>
                    <ul>
                      {brief.recentChanges.slice(BRIEF_SECTION_CAPS.changes).map((change) => (
                        <ChangeRow key={change.id} change={change} />
                      ))}
                    </ul>
                    {brief.preview.changes.total > brief.preview.changes.returned ? (
                      <p className="mt-2 text-xs leading-4 text-ink-secondary">
                        {brief.preview.changes.total - brief.preview.changes.returned} additional {brief.preview.changes.total - brief.preview.changes.returned === 1 ? "change is" : "changes are"} outside this preview.
                      </p>
                    ) : null}
                  </ExpandableRemainder>
                ) : null}
              </>
            )}
          </OverviewSection>
        ) : null}
      </div>

      {visibleComparisons.length > 0 ? (
        <OverviewSection
          title="Paper and email"
          description="A difference is evidence to inspect. Neither side is automatically right, and email does not change the formal paper."
        >
          <div className="space-y-4 px-4 py-3">
            {visibleComparisons.map((comparison) => (
              <ComparisonRow key={comparison.id} comparison={comparison} />
            ))}
          </div>
          {hiddenComparisons > 0 ? (
            <ExpandableRemainder label={remainderLabel("comparisons", hiddenComparisons)}>
              <div className="space-y-4">
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
          <p className="px-4 py-3 text-xs leading-4 text-ink-secondary">
            {brief.since ? "No communications arrived in this catch-up window." : "No communications in the current view."}
          </p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {brief.communications.slice(0, BRIEF_SECTION_CAPS.communications).map((communication) => {
                  const review = emailReviewState(communication);
                  const fact = communication.facts[0] ?? null;
                  return (
                    <li key={communication.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
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
            <p className="px-4 pt-3">
              <Link href={processingIssuesInboxHref(brief.deal.id)} className="source-link">
                {processingIssues.length} Processing {processingIssues.length === 1 ? "issue" : "issues"}
                <span aria-hidden="true">→</span>
              </Link>
            </p>
          ) : null}
          {systemAttention.length > 0 ? (
            <ul className="divide-y divide-line">
              {systemAttention.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-4 px-4 py-3">
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
            <p className="px-4 py-3 text-xs leading-4 text-ink-secondary">
              {brief.since ? "No timeline events occurred in this catch-up window." : "No source chronology in the current view."}
            </p>
          ) : (
            <ol className="divide-y divide-line">
              {brief.timeline.slice(0, BRIEF_SECTION_CAPS.timeline).map((item) => (
                <li key={item.id} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[4.75rem_minmax(0,1fr)] sm:gap-4">
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
