"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface TermView {
  id: string;
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: string | null;
  rawValue: string;
  status: string;
  confidence: number;
  evidenceQuote: string;
  sourceLocation: string | null;
  sourceFilename?: string | null;
  pageLabel?: string | null;
  pageNumber?: number | null;
  documentId?: string | null;
}

interface RoundView {
  id: string;
  side: string;
  roundNumber: number;
  documentName: string;
  documentDate: string;
}

interface RowView {
  type: string;
  label: string;
  status: string;
  contradictory: boolean;
  gap?: {
    currentGap: number;
    gapClosurePercent: number;
    unit: string;
  };
  cells: Array<{ roundId: string; terms: TermView[] }>;
}

function termDisplay(term: TermView) {
  return term.normalizedValue || term.rawValue;
}

function gapDisplay(value: number, unit: string) {
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  if (unit === "USD_PER_RSF_YEAR") return `$${formatted}/SF`;
  if (unit === "PERCENT_ANNUAL") return `${formatted}%`;
  if (unit === "MONTHS") return `${formatted} mo`;
  if (unit === "MONTHS_RENT") return `${formatted} mo rent`;
  if (unit === "RSF") return `${Number(value).toLocaleString()} RSF`;
  return formatted;
}

const statusClass: Record<string, string> = {
  AGREED: "border-green-200 bg-green-50 text-green-700",
  PROPOSED: "border-blue-200 bg-blue-50 text-blue-700",
  UNRESOLVED: "border-amber-200 bg-amber-50 text-amber-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  WITHDRAWN: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

export function NegotiationMatrix({
  rounds,
  rows,
}: {
  rounds: RoundView[];
  rows: RowView[];
}) {
  const [selection, setSelection] = useState<{
    terms: TermView[];
    round: RoundView;
    label: string;
  } | null>(null);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-sm border border-zinc-200 bg-white">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/80">
              <th className="sticky left-0 z-10 min-w-44 border-r border-zinc-200 bg-zinc-50 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Term
              </th>
              {rounds.map((round) => (
                <th key={round.id} className="min-w-44 border-r border-zinc-100 px-3 py-3 align-bottom">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-700">
                    {round.side === "TENANT" ? "Tenant" : "Landlord"} R{round.roundNumber}
                  </span>
                  <span className="mt-0.5 block max-w-40 truncate text-[10px] font-normal text-zinc-400" title={round.documentName}>
                    {round.documentName}
                  </span>
                </th>
              ))}
              <th className="min-w-36 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Current gap
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.type} className="border-b border-zinc-100 last:border-0">
                <th className="sticky left-0 z-10 border-r border-zinc-200 bg-white px-3 py-3 align-top">
                  <span className="block text-xs font-medium text-zinc-800">{row.label}</span>
                  {row.status !== "NOT_MENTIONED" && (
                    <span className={`mt-1 inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${statusClass[row.status] ?? statusClass.UNRESOLVED}`}>
                      {row.contradictory ? "CONTRADICTORY" : row.status.replace("_", " ")}
                    </span>
                  )}
                </th>
                {row.cells.map((cell) => {
                  const round = rounds.find((item) => item.id === cell.roundId)!;
                  return (
                    <td key={cell.roundId} className="border-r border-zinc-100 px-3 py-3 align-top">
                      {cell.terms.length === 0 ? (
                        <span className="text-xs text-zinc-300">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSelection({ terms: cell.terms, round, label: row.label })}
                          className="max-w-44 text-left text-xs font-medium leading-snug text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:text-blue-700 hover:decoration-blue-300"
                        >
                          {cell.terms.length > 1
                            ? `${cell.terms.length} assertions`
                            : termDisplay(cell.terms[0])}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-3 align-top">
                  {row.gap ? (
                    <div>
                      <p className="text-xs font-semibold tabular-nums text-zinc-900">
                        {gapDisplay(row.gap.currentGap, row.gap.unit)}
                      </p>
                      <p className="mt-0.5 text-[10px] tabular-nums text-zinc-400">
                        {row.gap.gapClosurePercent.toFixed(1)}% closed
                      </p>
                    </div>
                  ) : row.status === "AGREED" ? (
                    <span className="text-xs font-medium text-green-700">Resolved</span>
                  ) : (
                    <span className="text-xs text-zinc-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selection && (
        <section className="rounded-sm border border-blue-200 bg-white p-4 shadow-sm" aria-live="polite">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">Source detail</p>
              <h3 className="mt-0.5 text-sm font-semibold text-zinc-900">
                {selection.label} · {selection.round.side === "TENANT" ? "Tenant" : "Landlord"} R{selection.round.roundNumber}
              </h3>
            </div>
            <button type="button" aria-label="Close source detail" onClick={() => setSelection(null)} className="rounded-sm p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {selection.terms.map((term) => (
              <div key={term.id} className="rounded-sm border border-zinc-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold ${statusClass[term.status] ?? statusClass.UNRESOLVED}`}>
                    {term.status}
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {(term.confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
                <dl className="mt-3 space-y-2 text-xs">
                  <div><dt className="text-[10px] uppercase tracking-wider text-zinc-400">Raw value</dt><dd className="mt-0.5 text-zinc-800">{term.rawValue}</dd></div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-zinc-400">Source</dt>
                    <dd className="mt-0.5 text-zinc-700">
                      {term.documentId ? (
                        <>
                          <span className="block">{term.sourceFilename}</span>
                          {term.pageLabel ? <span className="block">{term.pageLabel}</span> : null}
                          {term.sourceLocation ? <span className="block text-zinc-500">{term.sourceLocation}</span> : null}
                          <a
                            className="mt-1 inline-block underline"
                            href={`/api/documents/${term.documentId}/file${term.pageNumber ? `#page=${term.pageNumber}` : ""}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View source PDF
                          </a>
                        </>
                      ) : (
                        <>
                          {selection.round.documentName} · {new Date(selection.round.documentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                          {term.sourceLocation ? ` · ${term.sourceLocation}` : ""}
                        </>
                      )}
                    </dd>
                  </div>
                  <div><dt className="text-[10px] uppercase tracking-wider text-zinc-400">Exact evidence</dt><dd className="mt-0.5 border-l-2 border-zinc-200 pl-2 italic text-zinc-600">&ldquo;{term.evidenceQuote}&rdquo;</dd></div>
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
