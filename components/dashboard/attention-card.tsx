import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ConfidenceDot } from "@/components/confidence-badge";
import { formatCurrency, formatRelative } from "@/lib/formatters";

interface AttentionCardProps {
  dealId: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  property: string;
  company: string;
  stage: string;
  summary: string;
  nextAction: string;
  nextActionOwner: string;
  waitingSince: Date | null;
  estimatedValue: number | null;
  evidenceQuote: string;
  confidence: number;
}

const severityConfig = {
  HIGH: {
    bar: "bg-red-500",
    badge: "high" as const,
    label: "High Priority",
  },
  MEDIUM: {
    bar: "bg-amber-400",
    badge: "medium" as const,
    label: "Medium Priority",
  },
  LOW: {
    bar: "bg-zinc-300",
    badge: "low" as const,
    label: "Low Priority",
  },
};

export function AttentionCard({
  dealId,
  severity,
  property,
  company,
  stage,
  summary,
  nextAction,
  nextActionOwner,
  waitingSince,
  estimatedValue,
  evidenceQuote,
  confidence,
}: AttentionCardProps) {
  const config = severityConfig[severity];

  return (
    <Link href={`/deals/${dealId}`} className="block group">
      <div className="flex overflow-hidden rounded-sm border border-zinc-200 bg-white transition-colors group-hover:border-zinc-300">
        {/* Severity indicator */}
        <div className={`w-1 shrink-0 ${config.bar}`} />

        <div className="flex flex-1 flex-col gap-3 px-4 py-3">
          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Badge variant={config.badge}>{config.label}</Badge>
                <span className="text-[10px] text-zinc-400 uppercase tracking-wider">
                  {stage}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold text-zinc-900">
                  {property}
                </span>
                <span className="text-xs text-zinc-400">—</span>
                <span className="text-sm text-zinc-600">{company}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {estimatedValue && (
                <span className="text-xs font-medium text-zinc-500 tabular-nums">
                  {formatCurrency(estimatedValue)}
                </span>
              )}
              {waitingSince && (
                <span className="text-[10px] text-red-500 font-medium">
                  {formatRelative(waitingSince)}
                </span>
              )}
            </div>
          </div>

          {/* Summary */}
          <p className="text-sm text-zinc-600 leading-relaxed">{summary}</p>

          {/* Next action */}
          <div className="flex items-start gap-1.5 rounded-sm bg-zinc-50 border border-zinc-100 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 mt-0.5 shrink-0">
              Next
            </span>
            <span className="text-xs text-zinc-700">
              {nextAction}{" "}
              <span className="text-zinc-400">({nextActionOwner})</span>
            </span>
          </div>

          {/* Evidence */}
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 shrink-0 mt-0.5">
              Evidence
            </span>
            <blockquote className="text-[11px] text-zinc-500 italic leading-relaxed border-l-2 border-zinc-200 pl-2">
              &ldquo;{evidenceQuote}&rdquo;
            </blockquote>
            <ConfidenceDot confidence={confidence} />
          </div>
        </div>
      </div>
    </Link>
  );
}
