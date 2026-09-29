import type { DocumentReviewState, ReviewWork } from "@/lib/review/completion";
import { deriveDocumentReviewState } from "@/lib/review/completion";
import { overallStatusLabel } from "@/lib/documents/lifecycle";
import type {
  ActionEvidenceReviewState,
  MessageAnalysisState,
  MessageLifecycleState,
  MessageReviewState,
} from "@/lib/messages/state";
import type {
  EvidenceSummary,
  EntityReviewSummary,
  InboxFilter,
  InboxProcessingStatus,
  NegotiationSummary,
  RelationshipReviewSummary,
  ReviewProgress,
  ReviewReason,
} from "./types";

const NON_RETRYABLE_FAILURES = new Set([
  "SCANNED_OR_EMPTY",
  "EXTRACTION_FAILED",
  "TEXT_TOO_LARGE",
  "STORAGE_FAILED",
]);

export function canRetryDocument(input: {
  ingestionStatus: string;
  failureCode: string | null;
  graphExtractionStatus: string;
}): boolean {
  if (input.failureCode && NON_RETRYABLE_FAILURES.has(input.failureCode)) return false;
  if (input.failureCode === "ANALYSIS_FAILED") return true;
  return input.graphExtractionStatus === "FAILED" && input.ingestionStatus === "COMPLETE";
}

export function deriveInboxStatus(input: {
  ingestionStatus: string;
  graphExtractionStatus: string;
  failureCode?: string | null;
  fileReady: boolean;
  metadataReady: boolean;
  analysisReady: boolean;
  work: ReviewWork;
  reviewReasons: ReviewReason[];
}): { processingStatus: InboxProcessingStatus; requiresReview: boolean } {
  const reviewState: DocumentReviewState = deriveDocumentReviewState({
    ingestionStatus: input.ingestionStatus,
    graphExtractionStatus: input.graphExtractionStatus,
    failureCode: input.failureCode ?? null,
    fileReady: input.fileReady,
    metadataReady: input.metadataReady,
    analysisReady: input.analysisReady,
    work: input.work,
  });
  const needsReview =
    reviewState === "REVIEW_REQUIRED" ||
    (reviewState === "FAILED" && input.ingestionStatus !== "FAILED" && input.reviewReasons.length > 0);
  return { processingStatus: reviewState, requiresReview: needsReview };
}

export function reviewReasonsFor(input: {
  entities: EntityReviewSummary;
  relationships: RelationshipReviewSummary;
  negotiation: NegotiationSummary;
  evidence: EvidenceSummary;
}): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (input.entities.unresolved > 0) reasons.push("UNRESOLVED_ENTITIES");
  if (input.relationships.ready + input.relationships.blocked > 0) {
    reasons.push("UNRESOLVED_RELATIONSHIPS");
  }
  if (input.negotiation.pendingReviewCount > 0) reasons.push("NEGOTIATION_REVIEW_PENDING");
  if (input.negotiation.followUpCount > 0) reasons.push("NEGOTIATION_FOLLOW_UP");
  if (input.negotiation.unreviewedConflictCount > 0) reasons.push("NEGOTIATION_CONFLICT");
  if (input.evidence.ambiguous > 0) reasons.push("AMBIGUOUS_PROVENANCE");
  if (input.evidence.unlocated > 0) reasons.push("UNLOCATED_PROVENANCE");
  return reasons;
}

export function processingLabel(status: InboxProcessingStatus): string {
  return overallStatusLabel(status);
}

export function nextActionFor(input: {
  processingStatus: InboxProcessingStatus;
  canRetry: boolean;
  reviewHref: string;
}): { label: string; href: string } {
  if (input.processingStatus === "READY_TO_PREPARE") {
    return { label: "Prepare document", href: input.reviewHref };
  }
  if (input.processingStatus === "READY_TO_ANALYZE") {
    return { label: "Analyze document", href: input.reviewHref };
  }
  if (input.processingStatus === "ANALYZING" || input.processingStatus === "NOT_READY") {
    return { label: "View document", href: input.reviewHref };
  }
  if (input.processingStatus === "FAILED") {
    return {
      label: input.canRetry ? "Retry analysis" : "View failure",
      href: input.reviewHref,
    };
  }
  if (input.processingStatus === "REVIEW_REQUIRED") {
    return { label: "Review document", href: input.reviewHref };
  }
  return { label: "Open document", href: input.reviewHref };
}

export function reviewProgress(input: {
  sourceFileState: "AVAILABLE" | "MISSING" | "UNAVAILABLE";
  metadataReady: boolean;
  metadataMissing: string[];
  ingestionStatus: string;
  work: ReviewWork;
  overall: InboxProcessingStatus;
}): ReviewProgress {
  const sourceLabel =
    input.sourceFileState === "AVAILABLE"
      ? "Available"
      : input.sourceFileState === "UNAVAILABLE"
        ? "Unavailable"
        : "Missing";
  const metadataLabel = input.metadataReady
    ? "Complete"
    : input.metadataMissing.length > 0
      ? `Missing ${input.metadataMissing.join(", ")}`
      : "Incomplete";
  let analysisLabel = "Not run";
  if (input.ingestionStatus === "COMPLETE") analysisLabel = "Complete";
  else if (input.ingestionStatus === "ANALYZING" || input.ingestionStatus === "EXTRACTING") analysisLabel = "Running";
  else if (input.ingestionStatus === "FAILED") analysisLabel = "Failed";
  else if (input.overall === "READY_TO_ANALYZE") analysisLabel = "Ready";
  return {
    sourceLabel,
    sourceReady: input.sourceFileState === "AVAILABLE",
    metadataLabel,
    metadataReady: input.metadataReady,
    analysisLabel,
    negotiationReviewed: input.work.negotiationAcknowledged,
    negotiationTotal: input.work.negotiationTotal,
    entitiesAddressed: input.work.entitiesAddressed,
    entitiesTotal: input.work.entitiesTotal,
    relationshipsReviewed: input.work.relationshipsReviewed,
    relationshipsTotal: input.work.relationshipsTotal,
    evidenceReviewed: input.work.evidenceAddressed,
    evidenceTotal: input.work.evidenceTotal,
    overall: input.overall,
  };
}

export function matchesInboxFilter(
  status: InboxProcessingStatus,
  requiresReview: boolean,
  filter: InboxFilter
): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "NEEDS_REVIEW":
      return requiresReview;
    case "PROCESSING":
      return status === "ANALYZING";
    case "COMPLETE":
      return status === "REVIEWED";
    case "FAILED":
      return status === "FAILED";
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

/**
 * Message review is acknowledgement of the current extraction, plus action
 * evidence when a directive exists. A confirmed ActivityFact does not settle
 * the message. Failed, imported, and in-progress analysis are not review work.
 */
export function matchesMessageInboxFilter(
  state: {
    analysisState: MessageAnalysisState;
    lifecycleState: MessageLifecycleState;
  },
  filter: InboxFilter
): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "NEEDS_REVIEW":
      return state.lifecycleState === "REVIEW_REQUIRED";
    case "PROCESSING":
      return state.analysisState === "ANALYZING";
    case "COMPLETE":
      return state.lifecycleState === "REVIEWED";
    case "FAILED":
      return state.analysisState === "ANALYSIS_FAILED";
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

export function messageAnalysisLabel(state: MessageAnalysisState): string {
  switch (state) {
    case "NOT_ANALYZED":
      return "Not analyzed";
    case "ANALYZING":
      return "Analyzing";
    case "ANALYZED":
      return "Analyzed";
    case "ANALYSIS_FAILED":
      return "Analysis failed";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function messageReviewLabel(state: MessageReviewState): string {
  switch (state) {
    case "NOT_REVIEWED":
      return "Not reviewed";
    case "REVIEW_REQUIRED":
      return "Needs review";
    case "NEEDS_FOLLOW_UP":
      return "Needs follow-up";
    case "REVIEWED":
      return "Message reviewed";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function messageNextAction(input: {
  analysisState: MessageAnalysisState;
  reviewState: MessageReviewState;
  actionReviewState: ActionEvidenceReviewState;
  evidenceSettled: boolean;
  href: string;
}): { label: string; href: string } {
  if (input.analysisState === "ANALYSIS_FAILED") {
    return { label: "Retry analysis", href: input.href };
  }
  if (input.analysisState === "NOT_ANALYZED") {
    return { label: "Analyze", href: input.href };
  }
  if (input.analysisState === "ANALYZING" || input.evidenceSettled) {
    return { label: "View message", href: input.href };
  }
  if (input.reviewState === "REVIEWED" && input.actionReviewState === "PENDING") {
    return { label: "Review action evidence", href: input.href };
  }
  return { label: "Review message", href: input.href };
}
