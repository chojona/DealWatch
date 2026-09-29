import type { DocumentReviewState, ReviewWork } from "@/lib/review/completion";
import { deriveDocumentReviewState } from "@/lib/review/completion";
import type {
  EvidenceSummary,
  EntityReviewSummary,
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
  if (status === "NOT_READY") return "Not ready";
  if (status === "READY_TO_PREPARE") return "Ready to prepare";
  if (status === "READY_TO_ANALYZE") return "Ready to analyze";
  if (status === "ANALYZING") return "Analyzing";
  if (status === "REVIEW_REQUIRED") return "Review required";
  if (status === "FAILED") return "Failed";
  return "Reviewed";
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
    negotiationReviewed: input.work.negotiationAcknowledged + input.work.negotiationFollowUp,
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
  filter: "ALL" | "NEEDS_REVIEW" | "PROCESSING" | "COMPLETE" | "FAILED"
): boolean {
  if (filter === "ALL") return true;
  if (filter === "NEEDS_REVIEW") return requiresReview;
  if (filter === "PROCESSING") return status === "ANALYZING";
  if (filter === "COMPLETE") return status === "REVIEWED";
  if (filter === "FAILED") return status === "FAILED";
  return true;
}
