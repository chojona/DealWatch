import { X } from "lucide-react";
import { EvidenceQuote } from "@/components/ui/evidence-quote";
import { SourceLink } from "@/components/ui/source-link";
import { Status } from "@/components/ui/status";
import {
  buildSourceChronology,
} from "@/lib/deals/reconciliation/present";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";
import {
  currentFormalObservations,
  gapClosure,
  positionSummary,
  settledCompanions,
  sideSteps,
} from "@/lib/negotiation/intelligence/workspace-present";
import type { NegotiationTermView } from "@/lib/negotiation/intelligence/types";

function date(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function sideName(side: string): string {
  return side === "TENANT" ? "Tenant" : side === "LANDLORD" ? "Landlord" : side;
}

export function TermDetailPanel({
  term,
  terms,
  links,
  onClose,
}: {
  term: NegotiationTermView;
  terms: NegotiationTermView[];
  links: ReconciliationLink[];
  onClose: () => void;
}) {
  const steps = sideSteps(term);
  const closure = gapClosure(term);
  const currentIds = new Set(currentFormalObservations(term).map((item) => item.id));
  const paper = currentFormalObservations(term).filter((item) => item.evidence.quote);
  const companions = settledCompanions(term, terms);
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
      sourceLabel: observation.evidence.sourceLabel || observation.roundName,
    })),
  });
  const emailEntries = chronology.entries.filter((entry) => entry.sourceLabel === "Email");

  return (
    <aside
      className="negotiation-panel flex h-full min-h-0 flex-col bg-[#fbfaf7] xl:border-l xl:border-[#e6e0d6] xl:shadow-[-16px_0_40px_-28px_rgba(23,32,30,0.55)]"
      aria-label={`${term.label} detail`}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-2">
        <div>
          <h2 className="negotiation-detail-title text-[28px] leading-none tracking-[-0.02em] text-ink [font-family:var(--font-geist),var(--font-sans)]" tabIndex={-1}>
            {term.label}
          </h2>
          <p className="mt-2 max-w-sm text-[13px] leading-5 text-ink-secondary">
            How this position moved, and what the paper says.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close term detail"
          className="rounded-md p-1.5 text-ink-muted hover:bg-white hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 pt-4 pb-8">
        <section>
          <h3 className="text-[13px] font-medium text-ink">How it moved</h3>
          {steps.length === 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-ink-secondary">No earlier formal position is stored for either side.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {steps.map((step) => (
                <li key={step.side} className={step.side === "TENANT" ? "text-[#214e46]" : "text-[#8c5a3c]"}>
                  <p className="text-[15px] leading-6 tabular-nums">
                    {sideName(step.side)} {step.previous} → {step.current}
                    {step.delta ? ` ${step.delta}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {closure ? (
            <p className="mt-3 text-[13px] leading-5 text-ink-secondary">
              The gap has {closure.widened ? "widened" : "closed"} by {closure.display} since the first stored numeric positions.
            </p>
          ) : null}
        </section>

        <section>
          <h3 className="text-[13px] font-medium text-ink">Chronology</h3>
          <ol className="mt-3 space-y-3">
            {term.history.map((observation) => {
              const current = currentIds.has(observation.id);
              return (
                <li key={observation.id} className="border-t border-[#efeae2] pt-3 first:border-t-0 first:pt-0">
                  <p className="text-[12px] leading-4 text-ink-muted">
                    <time dateTime={observation.roundDate}>{date(observation.roundDate)}</time>
                    {" · "}
                    {sideName(observation.side)} · {observation.roundName}
                  </p>
                  <p className="mt-1 text-[14px] leading-5 text-ink tabular-nums">{observation.value.summary}</p>
                  {current ? <p className="mt-1 text-[12px] font-medium text-ink">Current formal position</p> : null}
                  {observation.formalReview?.state === "REJECTED" ? (
                    <p className="mt-1 text-[12px] leading-4 text-danger">Rejected extraction. This value is not formal paper truth.</p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>

        <section>
          <h3 className="text-[13px] font-medium text-ink">On the paper</h3>
          {paper.length === 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-ink-secondary">No formal sentence is stored for the current position.</p>
          ) : (
            <div className="mt-3 space-y-5">
              {paper.map((observation) => (
                <figure key={observation.id} className="min-w-0">
                  <EvidenceQuote voice="paper" quote={observation.evidence.quote} />
                  <figcaption className="mt-2 text-[12px] leading-4 text-ink-muted">
                    {sideName(observation.side)} · {observation.roundName} · <time dateTime={observation.roundDate}>{date(observation.roundDate)}</time>
                    {observation.evidence.pageLabel ? ` · ${observation.evidence.pageLabel}` : ""}
                  </figcaption>
                  {observation.evidence.href ? (
                    <div className="mt-1">
                      <SourceLink href={observation.evidence.href} label="View document" />
                    </div>
                  ) : null}
                  {observation.formalReview?.state === "CORRECTED" ? (
                    <p className="mt-2 text-[12px] leading-4 text-ink-secondary">
                      Reviewed correction {observation.formalReview.extractedSummary} → {observation.formalReview.effectiveSummary}
                    </p>
                  ) : null}
                </figure>
              ))}
            </div>
          )}
        </section>

        {companions.length > 0 ? (
          <section>
            <h3 className="text-[13px] font-medium text-ink">Settled companion facts</h3>
            <ul className="mt-2 space-y-1">
              {companions.map((line) => (
                <li key={line} className="text-[14px] leading-5 text-ink-secondary">{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="text-[13px] font-medium text-ink">Conflict</h3>
          {term.conflict ? (
            <p className="mt-2 text-[14px] leading-5 text-warning">
              <Status tone="warning">Conflict</Status>
              <span className="mt-2 block">Competing formal candidates are stored. DealWatch has not chosen one.</span>
            </p>
          ) : (
            <p className="mt-2 text-[14px] leading-5 text-ink-secondary">
              No conflict. Each figure shown is the latest formal position on its own side.
            </p>
          )}
        </section>

        {emailEntries.length > 0 ? (
          <section>
            <h3 className="text-[13px] font-medium text-ink">In email</h3>
            <p className="mt-1 text-[12px] leading-4 text-ink-secondary">Communication does not replace the formal paper.</p>
            <ul className="mt-3 space-y-3">
              {emailEntries.map((entry) => (
                <li key={`${entry.occurredAt}:${entry.statement}`} className="border-t border-dashed border-[#e4ddd2] pt-3">
                  <p className="text-[12px] text-ink-muted"><time dateTime={entry.occurredAt}>{date(entry.occurredAt)}</time> · In email</p>
                  <p className="mt-1 text-[14px] leading-5 text-ink-secondary">{entry.statement}</p>
                  <p className="mt-1 text-[12px] text-ink-secondary">Does not change the formal paper.</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
