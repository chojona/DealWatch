import { storedFactValue } from "./facts";

interface FactReviewLike { id: string; state: string; createdAt: Date; correction?: { id: string; structuredPayload: unknown; note: string | null; createdAt: Date } | null }

/** Deterministic reviewed presentation. Raw extraction is always returned too. */
export function effectiveActivityFact<T extends { structuredPayload: unknown; reviews: FactReviewLike[] }>(fact: T) {
  const latestReview = [...fact.reviews].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))[0] ?? null;
  const correction = latestReview?.state === "INCORRECT" ? latestReview.correction ?? null : null;
  return {
    raw: { payload: fact.structuredPayload, value: storedFactValue(fact.structuredPayload) },
    review: latestReview ? { id: latestReview.id, state: latestReview.state, createdAt: latestReview.createdAt.toISOString() } : null,
    correction: correction ? { id: correction.id, payload: correction.structuredPayload, value: storedFactValue(correction.structuredPayload), note: correction.note } : null,
    presentationPayload: correction?.structuredPayload ?? fact.structuredPayload,
    presentationValue: storedFactValue(correction?.structuredPayload ?? fact.structuredPayload),
  };
}
