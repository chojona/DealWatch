"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { FilterChip } from "@/components/ui/filter-chip";
import { SourceLink } from "@/components/ui/source-link";
import { termCountsAsOpen } from "@/lib/deals/brief/formalStatus";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";
import type {
  NegotiationRoundView,
  NegotiationTermView,
  NegotiationWorkspace,
  NegotiationWorkspaceFilter,
} from "@/lib/negotiation/intelligence/types";
import {
  agreedSummary,
  decisionCopy,
  openTermTreatment,
  proseStatement,
  roundChangeLine,
} from "@/lib/negotiation/intelligence/workspace-present";
import { PositionRail } from "./position-rail";
import { QualitativePair } from "./qualitative-pair";
import { TermDetailPanel } from "./term-detail-panel";

const FILTERS: Array<{ value: NegotiationWorkspaceFilter; label: string }> = [
  { value: "OPEN", label: "Open" },
  { value: "ALL", label: "All" },
  { value: "AGREED", label: "Agreed" },
  { value: "CHANGED", label: "Changed" },
  { value: "CONFLICTS", label: "Conflicts" },
];

function date(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function filterTerms(terms: NegotiationTermView[], filter: NegotiationWorkspaceFilter) {
  if (filter === "ALL" || filter === "OPEN") return terms.filter((term) => term.status !== "AGREED");
  if (filter === "AGREED") return terms.filter((term) => term.status === "AGREED");
  if (filter === "CONFLICTS") return terms.filter((term) => term.conflict);
  if (filter === "CHANGED") return terms.filter((term) => term.changedInLatestRound);
  return terms.filter((term) => termCountsAsOpen(term));
}

function GapMark() {
  return (
    <svg width="48" height="16" viewBox="0 0 48 16" aria-hidden="true" className="shrink-0">
      <line x1="2" y1="8" x2="46" y2="8" stroke="#d9d3c8" strokeWidth="1.5" />
      <circle cx="14" cy="8" r="3.5" fill="#214e46" />
      <circle cx="34" cy="8" r="3.5" fill="#8c5a3c" />
    </svg>
  );
}

function OpenTermRow({
  term,
  selected,
  dimmed,
  onSelect,
}: {
  term: NegotiationTermView;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const treatment = openTermTreatment(term);
  const prose = treatment === "prose" ? proseStatement(term) : null;
  return (
    <li className={`motion-safe:transition-[opacity,background-color,box-shadow] motion-safe:duration-[180ms] motion-safe:ease-out ${dimmed ? "opacity-55" : "opacity-100"}`}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={`w-full rounded-lg px-4 py-5 text-left motion-safe:transition-[background-color,box-shadow] motion-safe:duration-[180ms] motion-safe:ease-out ${selected ? "bg-white shadow-[0_10px_28px_-22px_rgba(23,32,30,0.65)]" : "hover:bg-white/70"}`}
      >
        <span className="text-[13px] font-medium text-ink">{term.label}</span>
        <div className="mt-4">
          {treatment === "rail" ? <PositionRail term={term} /> : null}
          {treatment === "pair" ? <QualitativePair term={term} /> : null}
          {treatment === "prose" ? (
            <div className="max-w-2xl space-y-2 text-[15px] leading-6 text-ink-secondary">
              {prose ? <p>{prose}</p> : (
                <>
                  <p>Tenant {term.tenantPosition && term.tenantPosition.kind === "VALUE" ? term.tenantPosition.value.summary : "has no stored position"}.</p>
                  <p>Landlord {term.landlordPosition && term.landlordPosition.kind === "VALUE" ? term.landlordPosition.value.summary : "has no stored position"}.</p>
                </>
              )}
            </div>
          ) : null}
        </div>
      </button>
    </li>
  );
}

export function NegotiationWorkspaceView({
  workspace,
  reconciliation = [],
}: {
  workspace: NegotiationWorkspace;
  initialRoundId?: string | null;
  reconciliation?: ReconciliationLink[];
}) {
  const [filter, setFilter] = useState<NegotiationWorkspaceFilter>("OPEN");
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const panelId = useId();
  const visibleTerms = useMemo(() => filterTerms(workspace.terms, filter), [workspace.terms, filter]);
  const agreed = useMemo(() => agreedSummary(workspace.terms), [workspace.terms]);
  const decision = useMemo(() => decisionCopy(workspace.terms), [workspace.terms]);
  const selected = workspace.terms.find((term) => term.canonicalType === selectedType) ?? null;
  const showAgreedSummary = filter === "OPEN" || filter === "ALL" || filter === "CHANGED";

  useEffect(() => {
    if (!selected) return;
    const titles = document.querySelectorAll<HTMLElement>(".negotiation-detail-title");
    const visible = [...titles].find((node) => node.getClientRects().length > 0);
    visible?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select")) return;
      setSelectedType(null);
      returnFocus.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

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

  function selectTerm(type: string, element: HTMLElement) {
    returnFocus.current = element;
    setSelectedType((current) => current === type ? null : type);
  }

  return (
      <div className={selected ? "xl:grid xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start xl:gap-0" : ""}>
      <div className="min-w-0 xl:pr-6">
        <section id="term-history" aria-labelledby="negotiation-decision">
          <div className="flex items-center gap-4">
            <GapMark />
            <h2 id="negotiation-decision" className="max-w-3xl font-negotiation-serif text-[40px] leading-[1.05] tracking-[-0.03em] text-ink">
              {decision.sentence}
            </h2>
          </div>
          {decision.support ? (
            <p className="mt-3 max-w-2xl text-[15px] leading-6 text-ink-secondary">{decision.support}</p>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-1" role="group" aria-label="Negotiation filters">
            {FILTERS.map((item) => (
              <FilterChip key={item.value} pressed={filter === item.value} onClick={() => setFilter(item.value)}>
                {item.label}
              </FilterChip>
            ))}
          </div>

          {visibleTerms.length === 0 ? (
            <p className="mt-6 text-[14px] leading-5 text-ink-secondary">No terms match this filter.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[#e7e1d6]" aria-label="Open terms">
              {visibleTerms.map((term) => (
                <OpenTermRow
                  key={term.canonicalType}
                  term={term}
                  selected={selectedType === term.canonicalType}
                  dimmed={Boolean(selected) && selectedType !== term.canonicalType}
                  onSelect={() => {
                    const active = document.activeElement;
                    selectTerm(term.canonicalType, active instanceof HTMLElement ? active : document.body);
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        {showAgreedSummary && agreed.length > 0 ? (
          <section className="mt-10 max-w-3xl" aria-label="Agreed terms">
            <h3 className="text-[13px] font-medium text-ink-muted">Already agreed</h3>
            <p className="mt-2 text-[15px] leading-7 text-ink-secondary">
              {agreed.map((item, index) => (
                <span key={item.type}>
                  {index > 0 ? ", " : ""}
                  <button
                    type="button"
                    className="underline decoration-[#d9d3c8] underline-offset-4 hover:text-ink"
                    aria-pressed={selectedType === item.type}
                    onClick={(event) => selectTerm(item.type, event.currentTarget)}
                  >
                    {item.summary}
                  </button>
                </span>
              ))}
            </p>
          </section>
        ) : null}

        {selected ? (
          <div id={panelId} className="mt-8 overflow-hidden rounded-lg bg-[#fbfaf7] xl:hidden">
            <TermDetailPanel
              term={selected}
              terms={workspace.terms}
              links={reconciliation}
              onClose={() => {
                setSelectedType(null);
                returnFocus.current?.focus();
              }}
            />
          </div>
        ) : null}

        <RoundRecord rounds={workspace.rounds} />
        <DocumentList workspace={workspace} />
      </div>

      {selected ? (
        <div className="sticky top-4 hidden h-[calc(100vh-2rem)] xl:block">
          <TermDetailPanel
            term={selected}
            terms={workspace.terms}
            links={reconciliation}
            onClose={() => {
              setSelectedType(null);
              returnFocus.current?.focus();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function RoundRecord({
  rounds,
}: {
  rounds: NegotiationRoundView[];
}) {
  const lines = rounds.flatMap((round) => round.changes
    .filter((change) => change.kind !== "UNCHANGED")
    .map((change) => ({ id: `${round.id}:${change.canonicalType}`, line: roundChangeLine(change) })));
  if (lines.length === 0) return null;
  return (
    <details open className="mt-12 max-w-3xl">
      <summary className="cursor-pointer text-[13px] font-medium text-ink-muted">Round record</summary>
      <ul className="mt-2 space-y-1">
        {lines.map((item) => (
          <li key={item.id} className="text-[13px] leading-5 text-ink-muted tabular-nums">{item.line}</li>
        ))}
      </ul>
    </details>
  );
}

function DocumentList({ workspace }: { workspace: NegotiationWorkspace }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] font-medium text-ink-muted">Negotiation documents</h2>
        <span className="text-[12px] text-ink-muted">{workspace.documents.length}</span>
      </div>
      {workspace.documents.length === 0 ? (
        <p className="mt-2 text-[13px] leading-5 text-ink-secondary">
          No uploaded negotiation documents. Pasted rounds remain available with their stored source labels.
        </p>
      ) : (
        <ul className="mt-2">
          {workspace.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-[#e7e1d6] py-3">
              <div className="flex min-w-0 gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="break-words text-[13px] font-medium text-ink">{document.name}</p>
                  <p className="text-[12px] leading-4 text-ink-muted">
                    {document.documentType.replaceAll("_", " ")}
                    {" · "}
                    {document.documentDate ? date(document.documentDate) : "Date unknown"}
                    {" · "}
                    {document.pageCount ?? 0} pages · {document.termCount} terms · {document.ingestionStatus}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {document.sourceHref ? <SourceLink href={document.sourceHref} label="View document" /> : <span className="text-[13px] text-ink-muted">PDF unavailable</span>}
                <Link href={document.reviewHref} className="source-link">Review document</Link>
                <Link href={document.workspaceHref} className="source-link">This round</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
