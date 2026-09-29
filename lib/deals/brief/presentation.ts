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
