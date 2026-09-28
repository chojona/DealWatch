"use client";

import { useState } from "react";
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
  if (support.sourceKind === "MESSAGE") return "Message";
  return "Manual source";
}

export function EvidencePanel({ evidence }: { evidence: EvidenceView }) {
  const [open, setOpen] = useState(false);
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
        <div className="mt-2 rounded-sm border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-[11px] font-medium text-zinc-800">
            Supported by {evidence.supportCount} {evidence.supportCount === 1 ? "observation" : "observations"}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">{evidence.title}</p>
          <ul className="mt-2 space-y-2">
            {evidence.supports.map((support) => (
              <li key={support.observationId} className="text-[11px] text-zinc-700">
                <p className="font-medium text-zinc-800">
                  {support.documentName ?? (support.messageId ? "Message" : "Manual entry")}
                  <span className="ml-2 font-normal text-zinc-500">{provenanceLabel(support)}</span>
                </p>
                {support.provenanceStatus === "EXACT" && support.href && support.pageNumber && (
                  <a className="text-zinc-700 underline" href={support.href}>
                    Open page {support.pageNumber}
                  </a>
                )}
                {support.provenanceStatus === "AMBIGUOUS" && (
                  <p className="text-zinc-500">The quote appears on more than one page, so no single page is linked.</p>
                )}
                {support.provenanceStatus === "UNLOCATED" && (
                  <p className="text-zinc-500">The quote was not found on a stored page.</p>
                )}
                <blockquote className="mt-1 border-l-2 border-zinc-200 pl-2 text-zinc-600">
                  {support.quote}
                </blockquote>
              </li>
            ))}
            {evidence.supports.length === 0 && (
              <li className="text-[11px] text-zinc-500">No supporting observation is linked yet.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
