"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { CommercialValue } from "@/components/ui/commercial-value";
import { EvidenceQuote } from "@/components/ui/evidence-quote";
import { FilterChip } from "@/components/ui/filter-chip";
import { SourceLink } from "@/components/ui/source-link";
import { Status, type StatusTone } from "@/components/ui/status";
import { termCountsAsOpen } from "@/lib/deals/brief/formalStatus";
import {
  buildSourceChronology,
  chronologyRelationshipLabel,
  eventTypeLabel,
} from "@/lib/deals/reconciliation/present";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";
import type {
  FormattedTermValue,
  NegotiationEvidenceView,
  NegotiationMovementView,
  NegotiationObservationView,
  NegotiationPositionView,
  NegotiationRoundChangeView,
  NegotiationRoundView,
  NegotiationTermView,
  NegotiationWorkspace,
  NegotiationWorkspaceFilter,
} from "@/lib/negotiation/intelligence/types";

const FILTERS: Array<{ value: NegotiationWorkspaceFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "AGREED", label: "Agreed" },
  { value: "CHANGED", label: "Changed" },
  { value: "CONFLICTS", label: "Conflicts" },
];

const GROUPS: Record<NegotiationTermView["group"], string> = {
  ECONOMICS: "Economics",
  TIMING: "Timing",
  RIGHTS: "Rights",
  OPERATIONS: "Operations",
};

function date(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function sideLabel(value: string): string {
  if (value === "TENANT") return "Tenant";
  if (value === "LANDLORD") return "Landlord";
  return value;
}

function isProminentValue(summary: string): boolean {
  const compact = summary.trim();
  if (compact.length > 64) return false;
  return /[$%]/.test(compact) || /\d/.test(compact);
}

/**
 * Tone follows the stored status and the conflict flag.
 * Proposed and Unresolved stay distinct labels and share the open tone.
 */
function termStatus(term: Pick<NegotiationTermView, "status" | "conflict">): { label: string; tone: StatusTone } {
  if (
    term.conflict
    && term.status !== "AGREED"
    && term.status !== "REJECTED"
    && term.status !== "WITHDRAWN"
  ) {
    return { label: "Conflict", tone: "warning" };
  }
  switch (term.status) {
    case "AGREED":
      return { label: "Agreed", tone: "success" };
    case "REJECTED":
      return { label: "Rejected", tone: "danger" };
    case "PROPOSED":
      return { label: "Proposed", tone: "neutral" };
    case "UNRESOLVED":
      return { label: "Unresolved", tone: "neutral" };
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral" };
    case "NOT_MENTIONED":
      return { label: "Not mentioned", tone: "neutral" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}

function observationStatus(status: string): { label: string; tone: StatusTone } {
  return termStatus({ status: status as NegotiationTermView["status"], conflict: false });
}

function roundChangeStatus(kind: NegotiationRoundChangeView["kind"]): { label: string; tone: StatusTone } {
  if (kind === "AGREED") return { label: "Agreed", tone: "success" };
  if (kind === "CHANGED") return { label: "Changed", tone: "info" };
  return { label: "Unchanged", tone: "neutral" };
}

function sourcePhrase(evidence: NegotiationEvidenceView): string {
  if (evidence.sourceKind === "PASTED_TEXT") return "Pasted round";
  if (evidence.sourceKind === "PDF_UPLOAD") return "On the paper";
  return "Stored source";
}

function filterTerms(terms: NegotiationTermView[], filter: NegotiationWorkspaceFilter) {
  if (filter === "ALL") return terms;
  if (filter === "AGREED") return terms.filter((term) => term.status === "AGREED");
  if (filter === "CONFLICTS") return terms.filter((term) => term.conflict);
  if (filter === "CHANGED") return terms.filter((term) => term.changedInLatestRound);
  return terms.filter((term) => termCountsAsOpen(term));
}

function positionObservations(term: NegotiationTermView): NegotiationObservationView[] {
  const ids = new Set<string>();
  for (const position of [term.tenantPosition, term.landlordPosition, term.agreedPosition]) {
    for (const id of position?.observationIds ?? []) ids.add(id);
  }
  return term.history.filter((item) => ids.has(item.id));
}

function positionSummary(position: NegotiationPositionView | null): string | null {
  if (!position) return null;
  if (position.kind === "CONFLICT") return position.label;
  return position.value.summary;
}

function PositionValue({ value }: { value: FormattedTermValue }) {
  const extras = value.details.filter((row) => row.value !== value.summary);
  return (
    <div className="min-w-0">
      {isProminentValue(value.summary) ? (
        <CommercialValue layout="inline" value={value.summary} />
      ) : (
        <p className="break-words text-sm leading-5 text-ink">{value.summary}</p>
      )}
      {extras.length > 0 ? (
        <dl className="mt-1 space-y-0.5">
          {extras.map((row, index) => (
            <div key={`${row.label}:${index}`} className="grid grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)] gap-x-2">
              <dt className="text-[11px] leading-[15px] text-ink-muted">{row.label}</dt>
              <dd className="break-words text-xs leading-4 tabular-nums text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function PositionCell({ position }: { position: NegotiationPositionView | null }) {
  if (!position) return <span className="text-sm text-ink-muted">—</span>;
  if (position.kind === "CONFLICT") {
    return (
      <div className="min-w-0 space-y-2">
        <p className="text-[11px] font-medium leading-[15px] text-warning">{position.label}</p>
        <ol className="space-y-2">
          {position.candidates.map((candidate, index) => (
            <li key={`${candidate.value.summary}:${index}`}>
              <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Candidate {index + 1}</p>
              <PositionValue value={candidate.value} />
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return <PositionValue value={position.value} />;
}

function MovementCell({
  term,
  roundChange,
  selectedRoundId,
}: {
  term: NegotiationTermView;
  roundChange: NegotiationRoundChangeView | null;
  selectedRoundId: string | null;
}) {
  const movementAlreadyCoversRound = term.movement.kind !== "NONE" && term.movement.roundId === selectedRoundId;
  return (
    <div className="min-w-0 space-y-1">
      <MovementText movement={term.movement} />
      {term.latestSideToChange ? (
        <p className="text-[11px] leading-[15px] text-ink-muted">Latest side: {sideLabel(term.latestSideToChange)}</p>
      ) : null}
      {term.numericGap && term.numericGap.value !== 0 && term.status !== "AGREED" ? (
        <p className="text-xs leading-4 tabular-nums text-ink">
          Gap: <span className="font-medium">{term.numericGap.display}</span>
        </p>
      ) : null}
      {roundChange && roundChange.kind !== "UNCHANGED" && !movementAlreadyCoversRound ? (
        <p className="break-words text-xs leading-4 tabular-nums text-ink">
          This round: {roundChange.previousValue && roundChange.previousValue !== roundChange.currentValue
            ? `${roundChange.previousValue} → `
            : ""}
          {roundChange.currentValue}
        </p>
      ) : null}
    </div>
  );
}

function MovementText({ movement }: { movement: NegotiationMovementView }) {
  if (movement.kind === "NONE") {
    return <p className="text-xs leading-4 text-ink-muted">{movement.label}</p>;
  }
  return <p className="break-words text-xs font-medium leading-4 tabular-nums text-ink">{movement.label}</p>;
}

function EvidenceList({ term }: { term: NegotiationTermView }) {
  const observations = positionObservations(term);
  if (observations.length === 0) {
    return <p className="text-xs leading-4 text-ink-muted">No stored evidence for the current positions.</p>;
  }
  return (
    <div className="space-y-3">
      {observations.map((observation) => (
        <EvidenceBlock key={observation.id} observation={observation} />
      ))}
    </div>
  );
}

function EvidenceBlock({ observation }: { observation: NegotiationObservationView }) {
  const evidence = observation.evidence;
  const phrase = sourcePhrase(evidence);
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium leading-[15px] text-ink-muted">
        {sideLabel(observation.side)} · {phrase}
        {evidence.pageLabel ? ` · ${evidence.pageLabel}` : ""}
      </p>
      {observation.formalReview?.state === "CORRECTED" ? (
        <p className="mt-1 break-words text-xs leading-4 text-ink-secondary">
          Reviewed correction {observation.formalReview.extractedSummary} → {observation.formalReview.effectiveSummary}
        </p>
      ) : null}
      {observation.formalReview?.state === "REJECTED" ? (
        <p className="mt-1 break-words text-xs leading-4 text-danger">
          Rejected extraction. Original extraction: {observation.formalReview.extractedSummary}. This value is not formal paper truth.
          {observation.formalReview.note ? ` Reason: ${observation.formalReview.note}` : ""}
        </p>
      ) : null}
      {evidence.provenanceStatus === "AMBIGUOUS" ? (
        <p className="mt-1 text-xs leading-4 text-warning">Page is ambiguous; the quote appears on more than one stored page.</p>
      ) : null}
      {evidence.provenanceStatus === "UNLOCATED" ? (
        <p className="mt-1 text-xs leading-4 text-warning">Quote is stored, but no page location was found.</p>
      ) : null}
      {evidence.quote ? (
        <div className="mt-1">
          <EvidenceQuote
            quote={evidence.quote}
            citation={evidence.sourceLocation ? `${evidence.sourceLabel} · ${evidence.sourceLocation}` : evidence.sourceLabel}
          />
        </div>
      ) : (
        <p className="mt-1 text-xs leading-4 text-ink-muted">No evidence quote is stored for this observation.</p>
      )}
      {evidence.spanCorrected ? (
        <p className="mt-1 break-words text-xs leading-4 text-ink-secondary">
          Corrected span. Original extraction quote: “{evidence.originalQuote}”
        </p>
      ) : null}
      {evidence.href ? (
        <div className="mt-1">
          <SourceLink
            href={evidence.href}
            label={evidence.pageNumber ? `Page ${evidence.pageNumber}` : phrase === "On the paper" ? "View document" : "View source"}
            ariaLabel={`${phrase} for ${sideLabel(observation.side)} ${observation.roundName}`}
          />
        </div>
      ) : null}
    </div>
  );
}

function chronologyOrigin(entry: { sourceKind: string; sourceLabel: string }): string {
  if (entry.sourceLabel === "Email") return "In email";
  if (entry.sourceKind === "NEGOTIATION_ROUND") {
    return /pasted text/i.test(entry.sourceLabel) ? "Pasted round" : "On the paper";
  }
  return entry.sourceLabel;
}

function relatedActivity(observationId: string, roundId: string, canonicalType: string, links: ReconciliationLink[]) {
  return links.filter((link) => link.canonicalType === canonicalType && (
    link.matchedObservationIds.includes(observationId)
    || (link.relationship === "POSSIBLE_RELATED" && link.matchedRoundId === roundId)
  ));
}

function TermHistory({
  term,
  links,
}: {
  term: NegotiationTermView;
  links: ReconciliationLink[];
}) {
  const chronology = buildSourceChronology({
    canonicalType: term.canonicalType,
    currentTenant: positionSummary(term.tenantPosition),
    currentLandlord: positionSummary(term.landlordPosition),
    links,
    observations: term.history.map((observation) => ({
      id: observation.id,
      roundId: observation.roundId,
      roundName: observation.roundName,
      roundDate: observation.roundDate,
      side: observation.side,
      valueDisplay: observation.value.summary,
      href: observation.evidence.href,
      sourceLabel: observation.evidence.pageNumber
        ? `${observation.evidence.sourceLabel} · Page ${observation.evidence.pageNumber}`
        : observation.evidence.sourceLabel || observation.roundName,
    })),
  });
  const hasEmail = chronology.entries.some((entry) => entry.sourceLabel === "Email");
  return (
    <div className="grid gap-4 border-t border-line bg-surface-subtle px-3 py-3 lg:grid-cols-2">
      <section>
        <h4 className="text-[13px] font-semibold leading-[18px] text-ink">Source chronology</h4>
        {hasEmail ? (
          <p className="mt-1 text-xs leading-4 text-ink-secondary">
            Email records are communication. They do not change the formal paper.
          </p>
        ) : null}
        <ol className="mt-2 space-y-2">
          {chronology.entries.map((entry) => {
            const email = entry.sourceLabel === "Email";
            return (
              <li key={`${entry.sourceKind}:${entry.occurredAt}:${entry.sourceLabel}:${entry.statement}`} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                <p className="text-[11px] leading-[15px] text-ink-muted">
                  <time dateTime={entry.occurredAt}>{date(entry.occurredAt)}</time>
                  {" · "}
                  {chronologyOrigin(entry)}
                </p>
                <p className="mt-0.5 break-words text-xs leading-4 text-ink">{entry.statement}</p>
                {entry.relationship ? (
                  <p className="mt-0.5 text-[11px] leading-[15px] text-ink-secondary">{chronologyRelationshipLabel(entry.relationship)}</p>
                ) : null}
                {email ? (
                  <p className="mt-0.5 text-[11px] leading-[15px] text-ink-secondary">Does not change the formal paper.</p>
                ) : null}
                {entry.href ? <SourceLink href={entry.href} label={email ? "View email" : "View document"} /> : null}
              </li>
            );
          })}
        </ol>
        <div className="mt-2 border-t border-line pt-2">
          <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Current formal positions</p>
          <p className="mt-0.5 break-words text-xs leading-4 tabular-nums text-ink">Tenant {chronology.current.tenant ?? "—"}</p>
          <p className="break-words text-xs leading-4 tabular-nums text-ink">Landlord {chronology.current.landlord ?? "—"}</p>
        </div>
      </section>
      <section>
        <h4 className="text-[13px] font-semibold leading-[18px] text-ink">
          Round history
          <span className="ml-2 text-[11px] font-medium text-ink-muted">{term.history.length} observations</span>
        </h4>
        <ol className="mt-2 space-y-3">
          {term.history.map((observation) => {
            const status = observationStatus(observation.status);
            const activity = relatedActivity(observation.id, observation.roundId, term.canonicalType, links);
            return (
              <li key={observation.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium leading-4 text-ink">
                    {sideLabel(observation.side)} · {observation.roundName}
                  </p>
                  <Status tone={status.tone}>{status.label}</Status>
                </div>
                <p className="text-[11px] leading-[15px] text-ink-muted">
                  <time dateTime={observation.roundDate}>{date(observation.roundDate)}</time>
                </p>
                <div className="mt-1">
                  <PositionValue value={observation.value} />
                </div>
                {observation.formalReview?.state === "ACCEPTED" ? (
                  <p className="mt-1 text-xs leading-4 text-ink-secondary">Accepted extraction. Formal value matches the original extraction.</p>
                ) : null}
                <div className="mt-2">
                  <EvidenceBlock observation={observation} />
                </div>
                {activity.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Related activity</p>
                    <ul className="mt-1 space-y-1">
                      {activity.map((link) => (
                        <li key={`${link.activityEventId}:${link.explanationCode}`} className="text-xs leading-4 text-ink-secondary">
                          {eventTypeLabel(link.eventType)} — <time dateTime={link.eventDate}>{date(link.eventDate)}</time>
                          {link.eventSource.kind === "MESSAGE" ? " · In email. Does not change the formal paper." : ""}
                          {link.relationship === "POSSIBLE_RELATED" ? " · Possible correspondence" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function TermIdentity({
  term,
  expanded,
  panelId,
  onToggle,
}: {
  term: NegotiationTermView;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="text-left"
      >
        <span className="block text-[13px] font-semibold leading-[18px] text-ink">{term.label}</span>
        <span className="block text-[11px] font-medium leading-[15px] text-ink-muted">
          {expanded ? "Hide history" : "Show history"}
        </span>
      </button>
      <p className="text-[11px] leading-[15px] text-ink-muted">{GROUPS[term.group]}</p>
      {term.resolutionMode === "LEGACY" ? (
        <p className="text-[11px] leading-[15px] text-ink-muted">Legacy flat state</p>
      ) : null}
    </div>
  );
}

function RoundChanges({ round }: { round: NegotiationRoundView }) {
  const moved = round.changes.filter((change) => change.kind !== "UNCHANGED");
  const unchanged = round.changes.filter((change) => change.kind === "UNCHANGED");
  return (
    <div className="border-t border-line px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-[13px] font-semibold leading-[18px] text-ink">{round.documentName}</h3>
          <p className="text-[11px] leading-[15px] text-ink-muted">
            {sideLabel(round.side)} · <time dateTime={round.documentDate}>{date(round.documentDate)}</time>
            {" · "}
            {round.changedCount} changed · {round.unchangedCount} unchanged · {round.agreedCount} agreed
          </p>
        </div>
        {round.documentHref ? (
          <SourceLink href={round.documentHref} label="View document" ariaLabel={`Open ${round.documentName}`} />
        ) : (
          <p className="text-xs leading-4 text-ink-muted">Pasted round. No document file is stored.</p>
        )}
      </div>
      {moved.length === 0 ? (
        <p className="mt-2 text-xs leading-4 text-ink-secondary">No deterministic value or status changes were found in this round.</p>
      ) : (
        <ul className="mt-2">
          {moved.map((change) => (
            <RoundChangeRow key={change.canonicalType} change={change} />
          ))}
        </ul>
      )}
      {unchanged.length > 0 ? (
        <details className="mt-2 border-t border-line pt-2">
          <summary className="cursor-pointer text-[13px] font-medium text-ink">
            Unchanged in this round ({unchanged.length})
          </summary>
          <ul className="mt-1">
            {unchanged.map((change) => (
              <RoundChangeRow key={change.canonicalType} change={change} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function RoundChangeRow({ change }: { change: NegotiationRoundChangeView }) {
  const status = roundChangeStatus(change.kind);
  const value = change.previousValue && change.previousValue !== change.currentValue
    ? `${change.previousValue} → ${change.currentValue}`
    : change.currentValue;
  return (
    <li className="grid gap-1 border-t border-line py-1.5 first:border-t-0 sm:grid-cols-[minmax(8rem,11rem)_minmax(0,1fr)_auto] sm:items-baseline sm:gap-3">
      <span className="text-[13px] font-medium leading-[18px] text-ink">{change.label}</span>
      {isProminentValue(value) ? (
        <CommercialValue layout="inline" value={value} />
      ) : (
        <span className="break-words text-sm leading-5 tabular-nums text-ink">{value}</span>
      )}
      <Status tone={status.tone}>{status.label}</Status>
    </li>
  );
}

export function NegotiationWorkspaceView({
  workspace,
  initialRoundId,
  reconciliation = [],
}: {
  workspace: NegotiationWorkspace;
  initialRoundId?: string | null;
  reconciliation?: ReconciliationLink[];
}) {
  const [filter, setFilter] = useState<NegotiationWorkspaceFilter>("ALL");
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState(
    workspace.rounds.some((round) => round.id === initialRoundId)
      ? initialRoundId!
      : workspace.latestRound?.id ?? null,
  );
  const selectedRound = workspace.rounds.find((round) => round.id === selectedRoundId) ?? null;
  const visibleTerms = useMemo(() => filterTerms(workspace.terms, filter), [workspace.terms, filter]);
  const latestId = workspace.latestRound?.id ?? null;

  useEffect(() => {
    if (!expandedType) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      setExpandedType(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedType]);

  if (workspace.rounds.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-line bg-surface px-4 py-8">
        <h2 className="text-sm font-semibold leading-5 text-ink">No negotiation rounds yet</h2>
        <p className="mt-1 max-w-xl text-xs leading-4 text-ink-secondary">
          Add a pasted round or upload a negotiation PDF. Missing positions will remain blank until stored evidence exists.
        </p>
      </section>
    );
  }

  const summary = workspace.summary;

  return (
    <div className="space-y-3">
      <section id="term-history" className="rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-5 text-ink">Current positions</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-4 text-ink-secondary">
              Resolved from stored negotiation rounds. A blank cell means that side has no stored position. Email does not change these positions.
            </p>
            <p className="mt-1 text-xs leading-4 text-ink-secondary">
              <span>{summary.openCount} open</span>
              <span> · {summary.agreedCount} agreed</span>
              <span className={summary.conflictCount > 0 ? "font-medium text-danger" : undefined}>
                {" · "}{summary.conflictCount} {summary.conflictCount === 1 ? "conflict" : "conflicts"}
              </span>
              <span> · {summary.changedThisRoundCount} changed this round</span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-t border-line px-3 py-1.5" role="group" aria-label="Negotiation filters">
          {FILTERS.map((item) => (
            <FilterChip key={item.value} pressed={filter === item.value} onClick={() => setFilter(item.value)}>
              {item.label}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1 border-t border-line px-3 py-1.5" role="group" aria-label="Negotiation rounds">
          {workspace.rounds.map((round) => (
            <FilterChip
              key={round.id}
              pressed={selectedRoundId === round.id}
              onClick={() => setSelectedRoundId(round.id)}
              title={round.documentName}
            >
              {date(round.documentDate)} · {sideLabel(round.side)} R{round.roundNumber}
              {round.id === latestId ? " · Latest" : ""}
            </FilterChip>
          ))}
        </div>

        <TermTable
          terms={visibleTerms}
          selectedRound={selectedRound}
          expandedType={expandedType}
          onToggle={(type) => setExpandedType((current) => current === type ? null : type)}
          links={reconciliation}
        />
        <TermStack
          terms={visibleTerms}
          selectedRound={selectedRound}
          expandedType={expandedType}
          onToggle={(type) => setExpandedType((current) => current === type ? null : type)}
          links={reconciliation}
        />
        {selectedRound ? <RoundChanges round={selectedRound} /> : null}
      </section>

      <section className="rounded-md border border-line bg-surface">
        <div className="flex items-baseline justify-between px-3 py-2">
          <h2 className="text-sm font-semibold leading-5 text-ink">Negotiation documents</h2>
          <span className="text-xs text-ink-muted">{workspace.documents.length}</span>
        </div>
        {workspace.documents.length === 0 ? (
          <p className="border-t border-line px-3 py-3 text-xs leading-4 text-ink-secondary">
            No uploaded negotiation documents. Pasted rounds remain available above with their stored source labels.
          </p>
        ) : (
          <ul>
            {workspace.documents.map((document) => (
              <li key={document.id} className="border-t border-line px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="break-words text-[13px] font-medium leading-[18px] text-ink">{document.name}</p>
                      <p className="text-[11px] leading-[15px] text-ink-muted">
                        {document.documentType.replaceAll("_", " ")}
                        {" · "}
                        {document.documentDate ? date(document.documentDate) : "Date unknown"}
                        {" · "}
                        {document.pageCount ?? 0} pages
                        {" · "}
                        {document.termCount} terms
                        {" · "}
                        {document.ingestionStatus}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {document.sourceHref ? <SourceLink href={document.sourceHref} label="View document" /> : <span className="text-[13px] text-ink-muted">PDF unavailable</span>}
                    <Link href={document.reviewHref} className="source-link">Review document</Link>
                    <Link href={document.workspaceHref} className="source-link">This round</Link>
                  </div>
                </div>
                {document.review && document.review.findingsTotal > 0 ? (
                  <p className="mt-1 text-xs leading-4 text-ink-secondary">
                    Document review: {document.review.findingsReviewed} {document.review.findingsReviewed === 1 ? "finding" : "findings"} reviewed
                    {document.review.findingsFollowUp > 0 ? ` · ${document.review.findingsFollowUp} needs follow-up` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function roundChangeFor(term: NegotiationTermView, round: NegotiationRoundView | null) {
  return round?.changes.find((change) => change.canonicalType === term.canonicalType) ?? null;
}

function TermTable({
  terms,
  selectedRound,
  expandedType,
  onToggle,
  links,
}: {
  terms: NegotiationTermView[];
  selectedRound: NegotiationRoundView | null;
  expandedType: string | null;
  onToggle: (type: string) => void;
  links: ReconciliationLink[];
}) {
  return (
    <div className="hidden border-t border-line md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse text-left">
          <caption className="sr-only">Current negotiation positions</caption>
          <thead>
            <tr className="border-b border-line text-[11px] font-medium leading-[15px] text-ink-muted">
              <th scope="col" className="sticky left-0 z-10 w-40 border-r border-line bg-surface px-3 py-1.5">Term</th>
              <th scope="col" className="w-56 px-3 py-1.5">Tenant position</th>
              <th scope="col" className="w-56 px-3 py-1.5">Landlord position</th>
              <th scope="col" className="w-28 px-3 py-1.5">Status</th>
              <th scope="col" className="w-64 px-3 py-1.5">Movement</th>
              <th scope="col" className="min-w-64 px-3 py-1.5">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {terms.map((term) => {
              const expanded = expandedType === term.canonicalType;
              const change = roundChangeFor(term, selectedRound);
              const status = termStatus(term);
              const attention = Boolean(change && change.kind !== "UNCHANGED");
              const panelId = `term-panel-${term.canonicalType}`;
              return (
                <FragmentRow
                  key={term.canonicalType}
                  term={term}
                  expanded={expanded}
                  attention={attention}
                  status={status}
                  change={change}
                  panelId={panelId}
                  selectedRoundId={selectedRound?.id ?? null}
                  onToggle={() => onToggle(term.canonicalType)}
                  links={links}
                />
              );
            })}
            {terms.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs leading-4 text-ink-secondary">
                  No terms match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({
  term,
  expanded,
  attention,
  status,
  change,
  panelId,
  selectedRoundId,
  onToggle,
  links,
}: {
  term: NegotiationTermView;
  expanded: boolean;
  attention: boolean;
  status: { label: string; tone: StatusTone };
  change: NegotiationRoundChangeView | null;
  panelId: string;
  selectedRoundId: string | null;
  onToggle: () => void;
  links: ReconciliationLink[];
}) {
  return (
    <>
      <tr className={`border-b border-line align-top ${attention ? "bg-surface-subtle" : ""} ${expanded ? "border-b-0" : ""}`}>
        <th scope="row" className={`sticky left-0 z-10 border-r border-line px-3 py-2 ${attention ? "bg-surface-subtle" : "bg-surface"}`}>
          <TermIdentity term={term} expanded={expanded} panelId={panelId} onToggle={onToggle} />
        </th>
        <td className="border-l border-line px-3 py-2"><PositionCell position={term.tenantPosition} /></td>
        <td className="border-l border-line px-3 py-2"><PositionCell position={term.landlordPosition} /></td>
        <td className="border-l border-line px-3 py-2">
          <Status tone={status.tone}>{status.label}</Status>
        </td>
        <td className="border-l border-line px-3 py-2"><MovementCell term={term} roundChange={change} selectedRoundId={selectedRoundId} /></td>
        <td className="border-l border-line px-3 py-2"><EvidenceList term={term} /></td>
      </tr>
      {expanded ? (
        <tr className="border-b border-line">
          <td colSpan={6} id={panelId}>
            <TermHistory term={term} links={links} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TermStack({
  terms,
  selectedRound,
  expandedType,
  onToggle,
  links,
}: {
  terms: NegotiationTermView[];
  selectedRound: NegotiationRoundView | null;
  expandedType: string | null;
  onToggle: (type: string) => void;
  links: ReconciliationLink[];
}) {
  if (terms.length === 0) {
    return <p className="border-t border-line px-3 py-6 text-xs leading-4 text-ink-secondary md:hidden">No terms match this filter.</p>;
  }
  return (
    <div className="border-t border-line md:hidden">
      {terms.map((term) => {
        const expanded = expandedType === term.canonicalType;
        const change = roundChangeFor(term, selectedRound);
        const status = termStatus(term);
        const panelId = `term-stack-${term.canonicalType}`;
        return (
          <article key={term.canonicalType} className={`border-b border-line px-3 py-2 last:border-b-0 ${change && change.kind !== "UNCHANGED" ? "bg-surface-subtle" : ""}`}>
            <TermIdentity term={term} expanded={expanded} panelId={panelId} onToggle={() => onToggle(term.canonicalType)} />
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Tenant position</p>
                <PositionCell position={term.tenantPosition} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Landlord position</p>
                <PositionCell position={term.landlordPosition} />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Status</p>
              <Status tone={status.tone}>{status.label}</Status>
            </div>
            <div className="mt-2">
              <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Movement</p>
              <MovementCell term={term} roundChange={change} selectedRoundId={selectedRound?.id ?? null} />
            </div>
            <div className="mt-2">
              <p className="text-[11px] font-medium leading-[15px] text-ink-muted">Evidence</p>
              <EvidenceList term={term} />
            </div>
            {expanded ? (
              <div id={panelId} className="mt-2">
                <TermHistory term={term} links={links} />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
