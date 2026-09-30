import { ActivityStructuredPayloadSchema } from "@/lib/ai/activity/schema";
import { ACTION_KIND_LABELS } from "@/lib/deals/actions/evidenceReviewView";
import { canonicalLabel } from "@/lib/messages/facts";
import type { DealEvidenceComparison, DealEvidenceComparisonOutcome } from "./types";

/**
 * Initial visible caps for the Deal Brief. The service payload may be larger.
 * These caps are presentation only; hidden rows stay in the payload or are
 * reported through `DealBrief.preview` totals.
 */
export const BRIEF_SECTION_CAPS = {
  attention: 6,
  changes: 7,
  communications: 6,
  timeline: 10,
  comparisons: 6,
} as const;

/**
 * Label a communication fact with the commercial thing it records.
 * Action directives are stored as OTHER, so the raw type would read "Other".
 */
export function communicationFactLabel(input: {
  factType: string;
  canonicalType: string | null;
  evidenceQuote: string;
  payload: unknown;
}): string {
  if (input.canonicalType) return canonicalLabel(input.canonicalType);
  const parsed = ActivityStructuredPayloadSchema.safeParse(input.payload);
  const kind = parsed.success ? parsed.data.action?.kind ?? null : null;
  if (kind) return ACTION_KIND_LABELS[kind];
  if (input.factType !== "OTHER") return canonicalLabel(input.factType);
  const quote = input.evidenceQuote.trim();
  if (!quote) return "Communication note";
  return quote.length > 90 ? `${quote.slice(0, 87)}…` : quote;
}

/** Value beside that label. A kind name repeated as the display is not the request. */
export function communicationFactDetail(input: {
  label: string;
  display: string | null;
  evidenceQuote: string;
}): string {
  const display = input.display?.trim() ?? "";
  const quote = input.evidenceQuote.trim();
  if (!display || display === input.label) return quote || display || input.label;
  return display;
}

export function hiddenCount(total: number, cap: number): number {
  return Math.max(0, total - cap);
}

export function remainderLabel(
  section: keyof typeof BRIEF_SECTION_CAPS,
  hidden: number
): string {
  switch (section) {
    case "attention":
      return hidden === 1
        ? "+ 1 more item needs attention"
        : `+ ${hidden} more items need attention`;
    case "changes":
      return hidden === 1
        ? "+ 1 more recent change"
        : `+ ${hidden} more recent changes`;
    case "communications":
      return hidden === 1
        ? "View 1 more communication"
        : `View ${hidden} more communications`;
    case "timeline":
      return hidden === 1
        ? "+ 1 earlier event"
        : `+ ${hidden} earlier events`;
    case "comparisons":
      return hidden === 1
        ? "1 additional paper/email comparison"
        : `${hidden} additional paper/email comparisons`;
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

/**
 * Paper/email rows the Brief is willing to show. Not-comparable rows stay in
 * the service payload for audit, and duplicate term/side pairs keep the first
 * deterministic comparison.
 */
export function displayedComparisons(
  comparisons: readonly DealEvidenceComparison[]
): DealEvidenceComparison[] {
  const seen = new Set<string>();
  return comparisons.filter((comparison) => {
    if (comparison.outcome === "NOT_COMPARABLE") return false;
    const key = `${comparison.canonicalType}:${comparison.side}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function comparisonOutcomeLabel(outcome: DealEvidenceComparisonOutcome): string {
  switch (outcome) {
    case "DIFFERS":
      return "Paper and communication differ";
    case "MATCH":
      return "Match";
    case "NOT_COMPARABLE":
      return "Not comparable";
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Analysis and extraction failures. These are DealWatch remediation, not deal action. */
export const OPERATIONAL_ANALYSIS_ATTENTION = [
  "MESSAGE_ANALYSIS_FAILED",
  "DOCUMENT_ANALYSIS_FAILED",
] as const;

export type OperationalAnalysisAttention = (typeof OPERATIONAL_ANALYSIS_ATTENTION)[number];

export function isOperationalAnalysisAttention(type: string): type is OperationalAnalysisAttention {
  return (OPERATIONAL_ANALYSIS_ATTENTION as readonly string[]).includes(type);
}

/** Inbox work queue that contains the same operational failures as Processing issues. */
export function processingIssuesInboxHref(dealId: string): string {
  const params = new URLSearchParams({ dealId, filter: "FAILED" });
  return `/inbox?${params.toString()}`;
}
