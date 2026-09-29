"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, FileText, X } from "lucide-react";
import type {
  FormattedTermValue,
  NegotiationEvidenceView,
  NegotiationPositionView,
  NegotiationRoundView,
  NegotiationTermView,
  NegotiationWorkspace,
  NegotiationWorkspaceFilter,
} from "@/lib/negotiation/intelligence/types";
import { buildSourceChronology, chronologyRelationshipLabel, eventTypeLabel } from "@/lib/deals/reconciliation/present";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";

const FILTERS: Array<{ value: NegotiationWorkspaceFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "AGREED", label: "Agreed" },
  { value: "CHANGED", label: "Changed" },
  { value: "CONFLICTS", label: "Conflicts" },
];

const statusClass: Record<string, string> = {
  AGREED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PROPOSED: "border-blue-200 bg-blue-50 text-blue-700",
  UNRESOLVED: "border-amber-200 bg-amber-50 text-amber-800",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  WITHDRAWN: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

function date(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function side(value: string): string {
  return value === "TENANT" ? "Tenant" : "Landlord";
}

function formattedValue(value: FormattedTermValue, detailed = false) {
  return (
    <div>
      <p className="font-medium leading-5 text-zinc-900">{value.summary}</p>
      {detailed && value.details.length > 0 && (
        <dl className="mt-2 space-y-1.5 border-l-2 border-zinc-100 pl-3">
          {value.details.map((row, index) => (
            <div key={`${row.label}:${index}`} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 text-[11px] leading-4">
              <dt className="text-zinc-400">{row.label}</dt>
              <dd className="text-zinc-700">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Position({ position, compact = false }: { position: NegotiationPositionView | null; compact?: boolean }) {
  if (!position) return <span className="text-zinc-300">—</span>;
  if (position.kind === "CONFLICT") {
    return (
      <div className="rounded-sm border border-red-200 bg-red-50 p-2 text-red-900">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
          <AlertTriangle className="h-3 w-3" /> {position.label}
        </p>
        <ul className="mt-1.5 space-y-1 text-xs">
          {position.candidates.map((candidate, index) => (
            <li key={`${candidate.value.summary}:${index}`}>Candidate {index + 1}: {candidate.value.summary}</li>
          ))}
        </ul>
      </div>
    );
  }
  return formattedValue(position.value, !compact);
}

function Evidence({ evidence }: { evidence: NegotiationEvidenceView }) {
  return (
    <div className="rounded-sm border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-zinc-800">{evidence.sourceLabel}</p>
          <p className="mt-0.5 text-[10px] text-zinc-500">
            {evidence.pageLabel ?? (evidence.sourceKind === "PASTED_TEXT" ? "Stored pasted source" : "No page location")}
            {evidence.sourceLocation ? ` · ${evidence.sourceLocation}` : ""}
          </p>
        </div>
        {evidence.provenanceStatus === "EXACT" && evidence.href && evidence.pageNumber && (
          <a href={evidence.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-700 underline">
            Open page {evidence.pageNumber} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {evidence.provenanceStatus === "AMBIGUOUS" && (
        <p className="mt-2 text-[11px] text-amber-700">Page is ambiguous; the quote appears on more than one stored page.</p>
      )}
      {evidence.provenanceStatus === "UNLOCATED" && (
        <p className="mt-2 text-[11px] text-amber-700">Quote is stored, but no page location was found.</p>
      )}
      {!evidence.quote ? (
        <p className="mt-2 text-[11px] text-zinc-500">No evidence quote is stored for this observation.</p>
      ) : (
        <blockquote className="mt-2 border-l-2 border-zinc-300 pl-2 text-[11px] leading-5 text-zinc-600">“{evidence.quote}”</blockquote>
      )}
      {evidence.spanCorrected && (
        <p className="mt-2 text-[11px] text-zinc-600">Corrected span. Original extraction quote: “{evidence.originalQuote}”</p>
      )}
      <p className="mt-2 text-[10px] text-zinc-400">Original quote from the document. Review state is what decides whether this value counts.</p>
    </div>
  );
}

function evidenceFor(position: NegotiationPositionView | null, term: NegotiationTermView) {
  if (!position) return [];
  const ids = new Set(position.observationIds);
  return term.history.filter((item) => ids.has(item.id));
}

function PositionDetail({ title, position, term }: { title: string; position: NegotiationPositionView | null; term: NegotiationTermView }) {
  const observations = evidenceFor(position, term);
  return (
    <section>
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h4>
      <div className="mt-1.5 rounded-sm border border-zinc-200 bg-white p-3">
        <Position position={position} />
        {observations.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
            {observations.map((observation) => (
              <div key={observation.id}>
                {observation.formalReview?.state === "CORRECTED" && (
                  <p className="mb-2 text-[11px] text-zinc-700">Reviewed correction {observation.formalReview.extractedSummary} → {observation.formalReview.effectiveSummary}</p>
                )}
                <Evidence evidence={observation.evidence} />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function positionSummary(position: NegotiationPositionView | null): string | null {
  if (!position) return null;
  if (position.kind === "CONFLICT") return position.label;
  return position.value.summary;
}

function relatedActivity(observationId: string, roundId: string, canonicalType: string, links: ReconciliationLink[]) {
  return links.filter((link) => link.canonicalType === canonicalType && (
    link.matchedObservationIds.includes(observationId)
    || (link.relationship === "POSSIBLE_RELATED" && link.matchedRoundId === roundId)
  ));
}

function TermDrawer({
  term,
  links,
  onClose,
}: {
  term: NegotiationTermView;
  links: ReconciliationLink[];
  onClose: () => void;
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
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/25" role="dialog" aria-modal="true" aria-label={`${term.label} intelligence`}>
      <button type="button" className="min-w-0 flex-1 cursor-default" aria-label="Close term detail" onClick={onClose} />
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-200 bg-zinc-50 shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-zinc-200 bg-white px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-950">{term.label}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-sm border px-2 py-0.5 text-[11px] font-medium ${statusClass[term.status] ?? statusClass.UNRESOLVED}`}>{term.status.replaceAll("_", " ").toLowerCase()}</span>
            </div>
          </div>
          <button type="button" aria-label="Close term detail" onClick={onClose} className="rounded-sm p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"><X className="h-4 w-4" /></button>
        </header>
        <div className="space-y-5 p-5">
          {term.conflict && (
            <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">Conflicting positions detected. DealWatch has preserved every competing candidate and has not selected one.</div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <PositionDetail title="Tenant current position" position={term.tenantPosition} term={term} />
            <PositionDetail title="Landlord current position" position={term.landlordPosition} term={term} />
          </div>
          {term.agreedPosition && <PositionDetail title="Agreed position" position={term.agreedPosition} term={term} />}
          <section>
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Source chronology</h4>
            <ol className="mt-2 space-y-2">
              {chronology.entries.map((entry) => (
                <li key={`${entry.sourceKind}:${entry.occurredAt}:${entry.sourceLabel}:${entry.statement}`} className="rounded-sm border border-zinc-200 bg-white px-3 py-2">
                  <p className="text-[10px] text-zinc-400">{date(entry.occurredAt)} — {entry.sourceLabel}</p>
                  <p className="mt-0.5 text-xs text-zinc-800">{entry.statement}</p>
                  {entry.relationship && (
                    <p className="mt-1 text-[11px] text-zinc-500">{chronologyRelationshipLabel(entry.relationship)}</p>
                  )}
                  {entry.href && <a className="mt-1 inline-block text-[11px] underline" href={entry.href}>Open source</a>}
                </li>
              ))}
            </ol>
            <div className="mt-2 rounded-sm border border-zinc-300 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Current</p>
              <p className="mt-1 text-xs text-zinc-800">Tenant {chronology.current.tenant ?? "—"}</p>
              <p className="text-xs text-zinc-800">Landlord {chronology.current.landlord ?? "—"}</p>
            </div>
          </section>
          <section>
            <div className="flex items-baseline justify-between">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Complete round history</h4>
              <span className="text-[10px] text-zinc-400">{term.history.length} observations</span>
            </div>
            <div className="mt-2 space-y-2">
              {term.history.map((observation) => (
                <article key={observation.id} className="rounded-sm border border-zinc-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-zinc-900">{side(observation.side)} · {observation.roundName}</p>
                      <p className="mt-0.5 text-[10px] text-zinc-400">{date(observation.roundDate)}</p>
                    </div>
                    <span className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${statusClass[observation.status] ?? statusClass.UNRESOLVED}`}>{observation.status}</span>
                  </div>
                  <div className="mt-2 text-xs"><div>{formattedValue(observation.value, true)}</div></div>
                  {observation.formalReview?.state === "CORRECTED" && (
                    <p className="mt-2 text-[11px] text-zinc-700">Reviewed correction {observation.formalReview.extractedSummary} → {observation.formalReview.effectiveSummary}</p>
                  )}
                  {observation.formalReview?.state === "ACCEPTED" && (
                    <p className="mt-2 text-[11px] text-zinc-600">Accepted extraction. Formal value matches the original extraction.</p>
                  )}
                  {observation.formalReview?.state === "REJECTED" && (
                    <p className="mt-2 text-[11px] text-red-800">Rejected extraction. Original extraction: {observation.formalReview.extractedSummary}. This value is not formal paper truth.{observation.formalReview.note ? ` Reason: ${observation.formalReview.note}` : ""}</p>
                  )}
                  {relatedActivity(observation.id, observation.roundId, term.canonicalType, links).length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Related activity</p>
                      <ul className="mt-1 space-y-1">
                        {relatedActivity(observation.id, observation.roundId, term.canonicalType, links).map((link) => (
                          <li key={`${link.activityEventId}:${link.explanationCode}`} className="text-[11px] text-zinc-600">
                            {eventTypeLabel(link.eventType)} — {date(link.eventDate)}
                            {link.relationship === "POSSIBLE_RELATED" ? " · Possible correspondence" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3"><Evidence evidence={observation.evidence} /></div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function RoundDetail({ round }: { round: NegotiationRoundView }) {
  return (
    <div className="rounded-sm border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{round.documentName}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{side(round.side)} · {date(round.documentDate)}</p>
        </div>
        {round.documentHref && <a href={round.documentHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 underline">Open source <ExternalLink className="h-3 w-3" /></a>}
      </div>
      <div className="divide-y divide-zinc-100">
        {round.changes.map((change) => (
          <div key={change.canonicalType} className="grid gap-1 px-4 py-2.5 text-xs sm:grid-cols-[150px_minmax(0,1fr)_85px] sm:items-start">
            <span className="font-medium text-zinc-800">{change.label}</span>
            <span className="text-zinc-600">{change.previousValue && change.previousValue !== change.currentValue ? <><span className="text-zinc-400 line-through">{change.previousValue}</span><span className="mx-1.5">→</span></> : null}{change.currentValue}</span>
            <span className={`text-right text-[9px] font-semibold ${change.kind === "AGREED" ? "text-emerald-700" : change.kind === "UNCHANGED" ? "text-zinc-400" : "text-blue-700"}`}>{change.kind}</span>
          </div>
        ))}
        {round.changes.length === 0 && <p className="px-4 py-4 text-xs text-zinc-500">No stored term observations in this round.</p>}
      </div>
    </div>
  );
}

function filterTerms(terms: NegotiationTermView[], filter: NegotiationWorkspaceFilter) {
  if (filter === "ALL") return terms;
  if (filter === "AGREED") return terms.filter((term) => term.status === "AGREED");
  if (filter === "CONFLICTS") return terms.filter((term) => term.conflict);
  if (filter === "CHANGED") return terms.filter((term) => term.changedInLatestRound);
  return terms.filter((term) => term.status !== "AGREED");
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
  const [selectedTerm, setSelectedTerm] = useState<NegotiationTermView | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState(
    workspace.rounds.some((round) => round.id === initialRoundId)
      ? initialRoundId!
      : workspace.latestRound?.id ?? null
  );
  const selectedRound = workspace.rounds.find((round) => round.id === selectedRoundId) ?? null;
  const visibleTerms = useMemo(() => filterTerms(workspace.terms, filter), [workspace.terms, filter]);

  if (workspace.rounds.length === 0) {
    return (
      <section className="rounded-sm border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
        <h2 className="text-sm font-semibold text-zinc-800">No negotiation rounds yet</h2>
        <p className="mt-1 text-xs text-zinc-500">Add a pasted round or upload a negotiation PDF. Missing positions will remain blank until stored evidence exists.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {workspace.latestRound && (
        <section className="overflow-hidden rounded-sm border border-zinc-200 bg-white">
          <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="border-b border-zinc-200 bg-zinc-950 p-5 text-white lg:border-b-0 lg:border-r">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Latest negotiation</p>
              <h2 className="mt-2 text-lg font-semibold">{workspace.latestRound.documentName}</h2>
              <p className="mt-1 text-xs text-zinc-400">{side(workspace.latestRound.side)} · {date(workspace.latestRound.documentDate)}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
                <div><p className="text-xl font-semibold tabular-nums">{workspace.latestRound.changedCount}</p><p className="text-zinc-400">terms changed</p></div>
                <div><p className="text-xl font-semibold tabular-nums">{workspace.latestRound.unchangedCount}</p><p className="text-zinc-400">unchanged</p></div>
                <div><p className="text-xl font-semibold tabular-nums">{workspace.latestRound.agreedCount}</p><p className="text-zinc-400">agreed</p></div>
                <div><p className="text-xl font-semibold tabular-nums">{workspace.unresolvedCount}</p><p className="text-zinc-400">remain open</p></div>
              </div>
            </div>
            <div className="p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Meaningful changes</p>
              <div className="mt-2 divide-y divide-zinc-100">
                {workspace.latestRound.changes.filter((change) => change.kind !== "UNCHANGED").slice(0, 6).map((change) => (
                  <div key={change.canonicalType} className="flex items-start justify-between gap-4 py-2 text-xs">
                    <span className="font-medium text-zinc-800">{change.label}</span>
                    <span className="text-right text-zinc-600">{change.previousValue && change.previousValue !== change.currentValue ? `${change.previousValue} → ` : ""}{change.currentValue}<span className={`ml-2 text-[9px] font-semibold ${change.kind === "AGREED" ? "text-emerald-700" : "text-blue-700"}`}>{change.kind}</span></span>
                  </div>
                ))}
                {workspace.latestRound.changes.every((change) => change.kind === "UNCHANGED") && <p className="py-5 text-xs text-zinc-500">No deterministic value or status changes were found in this round.</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 overflow-hidden rounded-sm border border-zinc-200 bg-white sm:grid-cols-4">
        {[
          ["Open", workspace.summary.openCount, "text-amber-700"],
          ["Agreed", workspace.summary.agreedCount, "text-emerald-700"],
          ["Conflict", workspace.summary.conflictCount, "text-red-700"],
          ["Changed this round", workspace.summary.changedThisRoundCount, "text-blue-700"],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="border-b border-r border-zinc-100 px-4 py-3 last:border-r-0 sm:border-b-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </section>

      <section id="term-history">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Negotiation matrix</h2><p className="mt-0.5 text-[11px] text-zinc-400">Current positions are resolved on the server from stored observations. A blank agreed column means no agreement is stored.</p></div>
          <div className="flex rounded-sm border border-zinc-200 bg-white p-0.5" aria-label="Negotiation filters">
            {FILTERS.map((item) => <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-sm px-2.5 py-1 text-[11px] font-medium ${filter === item.value ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"}`}>{item.label}</button>)}
          </div>
        </div>
        <div className="overflow-x-auto rounded-sm border border-zinc-200 bg-white">
          <table className="w-full min-w-[1120px] border-collapse text-left">
            <thead><tr className="border-b border-zinc-200 bg-zinc-50"><th className="w-48 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Term</th><th className="w-60 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tenant</th><th className="w-60 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Landlord</th><th className="w-52 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Current / agreed</th><th className="w-28 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Status</th><th className="w-64 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Movement</th></tr></thead>
            <tbody>
              {visibleTerms.map((term) => (
                <tr key={term.canonicalType} onClick={() => setSelectedTerm(term)} className="cursor-pointer border-b border-zinc-100 align-top transition-colors last:border-0 hover:bg-zinc-50/80">
                  <th className="px-3 py-3"><span className="block text-xs font-semibold text-zinc-900">{term.label}</span><span className="mt-1 block text-[9px] font-medium uppercase tracking-wide text-zinc-400">{term.group}</span>{term.resolutionMode === "LEGACY" && <span className="mt-1 block text-[9px] text-zinc-400">Legacy flat state</span>}</th>
                  <td className="border-l border-zinc-100 px-3 py-3 text-xs"><Position position={term.tenantPosition} compact /></td>
                  <td className="border-l border-zinc-100 px-3 py-3 text-xs"><Position position={term.landlordPosition} compact /></td>
                  <td className="border-l border-zinc-100 px-3 py-3 text-xs"><Position position={term.agreedPosition} compact /></td>
                  <td className="border-l border-zinc-100 px-3 py-3"><span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${term.conflict ? "border-red-300 bg-red-50 text-red-700" : statusClass[term.status] ?? statusClass.UNRESOLVED}`}>{term.conflict ? "CONFLICT" : term.status}</span>{term.numericGap && term.status !== "AGREED" && <p className="mt-2 text-[10px] text-zinc-500">Gap: <span className="font-medium text-zinc-800">{term.numericGap.display}</span></p>}</td>
                  <td className="border-l border-zinc-100 px-3 py-3 text-xs text-zinc-600">{term.movement.kind === "NONE" ? <span className="text-zinc-300">—</span> : term.movement.label}{term.latestSideToChange && <p className="mt-1 text-[10px] text-zinc-400">Latest side: {side(term.latestSideToChange)}</p>}</td>
                </tr>
              ))}
              {visibleTerms.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-xs text-zinc-500">No terms match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Round history</h2><p className="mt-0.5 text-[11px] text-zinc-400">Select a stored round to inspect its deterministic changes.</p></div>
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <ol className="overflow-hidden rounded-sm border border-zinc-200 bg-white">
            {workspace.rounds.map((round) => (
              <li key={round.id} className="border-b border-zinc-100 last:border-0"><button type="button" onClick={() => setSelectedRoundId(round.id)} className={`w-full px-3 py-3 text-left ${selectedRoundId === round.id ? "bg-zinc-900 text-white" : "hover:bg-zinc-50"}`}><span className={`block text-[10px] font-semibold uppercase tracking-wider ${selectedRoundId === round.id ? "text-zinc-400" : "text-zinc-400"}`}>{date(round.documentDate)} · {side(round.side)}</span><span className="mt-0.5 block truncate text-xs font-semibold">{round.documentName}</span><span className={`mt-1 block text-[10px] ${selectedRoundId === round.id ? "text-zinc-300" : "text-zinc-500"}`}>{round.changedCount} changed · {round.agreedCount} agreed · {round.unchangedCount} unchanged</span></button></li>
            ))}
          </ol>
          {selectedRound && <RoundDetail round={selectedRound} />}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Negotiation documents</h2><span className="text-[10px] text-zinc-400">{workspace.documents.length}</span></div>
        <div className="overflow-hidden rounded-sm border border-zinc-200 bg-white">
          {workspace.documents.length === 0 ? <p className="px-4 py-5 text-xs text-zinc-500">No uploaded negotiation documents. Pasted rounds remain available above with their stored source labels.</p> : workspace.documents.map((document) => (
            <div key={document.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 last:border-0">
              <div className="flex min-w-0 gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" /><div><p className="truncate text-xs font-medium text-zinc-900">{document.name}</p><p className="mt-0.5 text-[10px] text-zinc-500">{document.documentType.replaceAll("_", " ")} · {document.documentDate ? date(document.documentDate) : "Date unknown"} · {document.pageCount ?? 0} pages · {document.termCount} terms · {document.ingestionStatus}</p></div></div>
              <div className="flex gap-3 text-[11px]">{document.sourceHref ? <a href={document.sourceHref} target="_blank" rel="noreferrer" className="underline">Open source</a> : <span className="text-zinc-400">PDF unavailable</span>}<Link href={document.reviewHref} className="underline">Review document</Link><Link href={document.workspaceHref} className="underline">Negotiation</Link></div>
              {document.review && document.review.findingsTotal > 0 && (
                <p className="mt-1 w-full text-[11px] text-zinc-600">
                  Document review: {document.review.findingsReviewed} {document.review.findingsReviewed === 1 ? "finding" : "findings"} reviewed
                  {document.review.findingsFollowUp > 0 ? ` · ${document.review.findingsFollowUp} needs follow-up` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {selectedTerm && <TermDrawer term={selectedTerm} links={reconciliation} onClose={() => setSelectedTerm(null)} />}
    </div>
  );
}
