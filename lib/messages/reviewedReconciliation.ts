import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";
import { storedFactValue } from "./facts";

function displayNumber(display: string | null | undefined): number | null {
  const match = display?.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** Additional reviewed comparison. It never replaces the canonical raw link. */
export function reviewedReconciliationForFact(raw: ReconciliationLink | null, correctedPayload: unknown): ReconciliationLink | null {
  if (!raw) return null;
  const corrected = storedFactValue(correctedPayload);
  if (corrected.numeric == null || !raw.canonicalType) return { ...raw, eventValue: corrected };
  const currentNumeric = displayNumber(raw.currentPosition?.display);
  if (currentNumeric == null) return { ...raw, eventValue: corrected };
  const matches = Math.abs(currentNumeric - corrected.numeric) < 1e-6;
  return {
    ...raw,
    eventValue: corrected,
    relationship: matches ? "MATCHES_CURRENT" : "DIFFERS_FROM_CURRENT",
    explanationCode: matches ? "MATCHES_CURRENT_OBSERVATION" : "DIFFERS_FROM_CURRENT_OBSERVATION",
    matchedObservationIds: matches && raw.currentPosition ? [raw.currentPosition.observationId] : [],
    disagreement: matches || !raw.currentPosition ? null : {
      activityDisplay: corrected.display ?? String(corrected.numeric),
      observationDisplay: raw.currentPosition.display,
      observationId: raw.currentPosition.observationId,
      currentDisplay: raw.currentPosition.display,
    },
  };
}
