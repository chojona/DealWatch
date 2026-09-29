import type { ReviewDecisionState } from "@prisma/client";

export const DOCUMENT_REVIEW_STATES = [
  "NOT_READY",
  "READY_TO_PREPARE",
  "READY_TO_ANALYZE",
  "ANALYZING",
  "REVIEW_REQUIRED",
  "REVIEWED",
  "FAILED",
] as const;

export type DocumentReviewState = (typeof DOCUMENT_REVIEW_STATES)[number];

export interface ReviewWork {
  negotiationPending: number;
  negotiationFollowUp: number;
  negotiationAcknowledged: number;
  negotiationTotal: number;
  conflictPending: number;
  conflictFollowUp: number;
  conflictAcknowledged: number;
  conflictTotal: number;
  entitiesAddressed: number;
  entitiesTotal: number;
  relationshipsReviewed: number;
  relationshipsTotal: number;
  evidenceAddressed: number;
  evidenceFollowUp: number;
  evidenceTotal: number;
}

/**
 * REVIEWED means human review of this document is complete.
 * It does not mean every observation became canonical truth.
 * A resolved entity or an explicit left-unresolved decision both close
 * that entity. A blocked relationship closes only when the reviewer
 * acknowledges the block, or when it is approved or rejected.
 *
 * A needs-follow-up decision keeps the document in REVIEW_REQUIRED.
 * NegotiationTerm.status is not an input.
 */
export function deriveDocumentReviewState(input: {
  ingestionStatus: string;
  graphExtractionStatus: string;
  failureCode: string | null;
  fileReady: boolean;
  metadataReady: boolean;
  analysisReady: boolean;
  work: ReviewWork;
}): DocumentReviewState {
  if (input.ingestionStatus === "FAILED" || input.graphExtractionStatus === "FAILED") {
    return "FAILED";
  }
  if (input.ingestionStatus === "EXTRACTING" || input.ingestionStatus === "ANALYZING") {
    return "ANALYZING";
  }
  if (input.ingestionStatus === "COMPLETE") {
    return reviewWorkOpen(input.work) ? "REVIEW_REQUIRED" : "REVIEWED";
  }
  if (input.analysisReady) return "READY_TO_ANALYZE";
  if (!input.metadataReady) return "READY_TO_PREPARE";
  return "NOT_READY";
}

export function reviewWorkOpen(work: ReviewWork): boolean {
  return (
    work.negotiationPending > 0 ||
    work.negotiationFollowUp > 0 ||
    work.conflictPending > 0 ||
    work.conflictFollowUp > 0 ||
    work.entitiesAddressed < work.entitiesTotal ||
    work.relationshipsReviewed < work.relationshipsTotal ||
    work.evidenceAddressed < work.evidenceTotal ||
    work.evidenceFollowUp > 0
  );
}

export function decisionCounts(states: ReviewDecisionState[]): {
  pending: number;
  acknowledged: number;
  followUp: number;
} {
  let pending = 0;
  let acknowledged = 0;
  let followUp = 0;
  for (const state of states) {
    if (state === "ACKNOWLEDGED") acknowledged += 1;
    else if (state === "NEEDS_FOLLOW_UP") followUp += 1;
    else pending += 1;
  }
  return { pending, acknowledged, followUp };
}

export function emptyReviewWork(): ReviewWork {
  return {
    negotiationPending: 0,
    negotiationFollowUp: 0,
    negotiationAcknowledged: 0,
    negotiationTotal: 0,
    conflictPending: 0,
    conflictFollowUp: 0,
    conflictAcknowledged: 0,
    conflictTotal: 0,
    entitiesAddressed: 0,
    entitiesTotal: 0,
    relationshipsReviewed: 0,
    relationshipsTotal: 0,
    evidenceAddressed: 0,
    evidenceFollowUp: 0,
    evidenceTotal: 0,
  };
}
