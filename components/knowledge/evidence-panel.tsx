"use client";

import { useState } from "react";
import { EvidenceQuote } from "@/components/ui/evidence-quote";
import type { EvidenceSupport, EvidenceView } from "@/lib/promotion/types";

function provenanceLabel(support: EvidenceSupport): string {
  if (support.provenanceStatus === "EXACT" && support.pageNumber) {
    return `Page ${support.pageNumber}`;
  }
  if (support.provenanceStatus === "AMBIGUOUS") {
    return "Ambiguous page";
  }
  if (support.provenanceStatus === "UNLOCATED") {
    return "Unlocated";
  }
  if (support.sourceKind === "MESSAGE") {
    return support.messageSender ? `Message · ${support.messageSender}` : "Message";
  }
  return "Manual source";
}

function sourceTitle(support: EvidenceSupport): string {
  if (support.documentName) return support.documentName;
  if (support.messageSubject) return support.messageSubject;
  if (support.messageId) return "Message";
  return "Manual source";
}

function EvidenceList({ evidence }: { evidence: EvidenceView }) {
  return (
    <div className="rounded-sm border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-[11px] font-medium text-zinc-800">
        Supported by {evidence.supportCount} {evidence.supportCount === 1 ? "observation" : "observations"}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{evidence.title}</p>
      <ul className="mt-2 space-y-2">
        {evidence.supports.map((support) => (
          <li key={support.observationId} className="text-[11px] text-zinc-700">
            <p className="font-medium text-zinc-800">
              {sourceTitle(support)}
              <span className="ml-2 font-normal text-zinc-500">{provenanceLabel(support)}</span>
              {support.reviewState && (
                <span className="ml-2 font-normal uppercase tracking-wider text-zinc-400">{support.reviewState.replaceAll("_", " ")}</span>
              )}
              {support.sourceDate && (
                <span className="ml-2 font-normal text-zinc-400">
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(support.sourceDate))}
                </span>
              )}
            </p>
            {support.evidenceStartOffset != null && support.evidenceEndOffset != null && (
              <p className="text-zinc-500">Span {support.evidenceStartOffset}–{support.evidenceEndOffset}</p>
            )}
            <p className="mt-1 flex flex-wrap gap-3">
              {support.reviewHref && (
                <a className="font-medium text-zinc-900 underline" href={support.reviewHref}>
                  Review source
                </a>
              )}
              {support.provenanceStatus === "EXACT" && support.href && support.pageNumber && (
                <a className="text-zinc-700 underline" href={support.href}>
                  Open page {support.pageNumber}
                </a>
              )}
            </p>
            {support.provenanceStatus === "AMBIGUOUS" && (
              <p className="text-zinc-500">The quote appears on more than one page, so no single page is linked.</p>
            )}
            {support.provenanceStatus === "UNLOCATED" && (
              <p className="text-zinc-500">The quote was not found on a stored page.</p>
            )}
            <EvidenceQuote className="mt-1">{support.quote}</EvidenceQuote>
          </li>
        ))}
        {evidence.supports.length === 0 && (
          <li className="text-[11px] text-zinc-500">No documentary support is currently linked to this canonical assertion.</li>
        )}
      </ul>
    </div>
  );
}

export function EvidencePanel({
  evidence,
  embedded = false,
}: {
  evidence: EvidenceView;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (embedded) return <EvidenceList evidence={evidence} />;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-[11px] font-medium text-zinc-700 underline"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Hide evidence" : "Why do we believe this?"}
      </button>
      {open && (
        <div className="mt-2">
          <EvidenceList evidence={evidence} />
        </div>
      )}
    </div>
  );
}
