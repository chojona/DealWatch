"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceDot } from "@/components/confidence-badge";
import { formatDate, formatRelative } from "@/lib/formatters";
import { ChevronDown, ChevronRight } from "lucide-react";

interface ObligationRowProps {
  id: string;
  owner: string;
  counterparty: string | null;
  description: string;
  dueAt: Date | null;
  status: string;
  confidence: number;
  evidenceQuote: string;
  createdAt: Date;
}

export function ObligationRow({
  owner,
  counterparty,
  description,
  dueAt,
  status,
  confidence,
  evidenceQuote,
}: ObligationRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-zinc-100 last:border-0">
      <button
        className="w-full text-left px-4 py-3 hover:bg-zinc-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-zinc-300">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusBadge status={status} />
              <span className="text-[10px] text-zinc-400 font-medium">
                {owner}
                {counterparty && (
                  <span className="text-zinc-300"> → {counterparty}</span>
                )}
              </span>
            </div>
            <p className="text-sm text-zinc-700">{description}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            {dueAt && (
              <span
                className={`text-[10px] font-medium ${
                  status === "OVERDUE"
                    ? "text-red-500"
                    : "text-zinc-400"
                }`}
              >
                {status === "OVERDUE"
                  ? `Due ${formatDate(dueAt)}`
                  : `Due ${formatRelative(dueAt)}`}
              </span>
            )}
            <ConfidenceDot confidence={confidence} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 ml-6 mr-4">
          <div className="rounded-sm border border-zinc-100 bg-zinc-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mb-1">
              Evidence
            </p>
            <blockquote className="text-xs text-zinc-600 italic leading-relaxed border-l-2 border-zinc-300 pl-2">
              &ldquo;{evidenceQuote}&rdquo;
            </blockquote>
          </div>
        </div>
      )}
    </div>
  );
}
