export type DocumentLifecycleStatus =
  | "NOT_READY"
  | "READY_TO_PREPARE"
  | "READY_TO_ANALYZE"
  | "ANALYZING"
  | "REVIEW_REQUIRED"
  | "REVIEWED"
  | "FAILED";

export type DocumentReviewPresentationState =
  | "NOT_STARTED"
  | "NEEDS_REVIEW"
  | "REVIEWED";

export interface DocumentLifecyclePresentation {
  primaryLabel: string;
  analysis: { label: string };
  review: {
    state: DocumentReviewPresentationState;
    label: string;
  };
  knowledge: { label: string };
  failureTitle: string | null;
  retryExplanation: string | null;
}

/**
 * User-facing projection over independent ingestion, graph-extraction, and
 * review state. Database enums remain unchanged; every Document surface uses
 * this projection so a completed analysis is not mistaken for completed review.
 */
export function presentDocumentLifecycle(input: {
  overallStatus: DocumentLifecycleStatus;
  ingestionStatus: string;
  graphExtractionStatus: string;
  failureCode: string | null;
  requiresReview: boolean;
  canRetry: boolean;
}): DocumentLifecyclePresentation {
  const analysisLabel = analysisStatusLabel(
    input.overallStatus,
    input.ingestionStatus,
    input.failureCode
  );
  const review = reviewPresentation(input.ingestionStatus, input.requiresReview);
  const knowledgeLabel = graphStatusLabel(input.graphExtractionStatus);
  const failureTitle = failureLabel(input);

  return {
    primaryLabel: failureTitle ?? overallStatusLabel(input.overallStatus),
    analysis: { label: analysisLabel },
    review,
    knowledge: { label: knowledgeLabel },
    failureTitle,
    retryExplanation: failureTitle
      ? input.canRetry
        ? "Saved text and completed work were kept. Retry reruns the existing analysis pipeline without creating another saved round."
        : "Retry is unavailable for this failure. The source or preparation problem must be corrected first."
      : null,
  };
}

export function overallStatusLabel(status: DocumentLifecycleStatus): string {
  if (status === "NOT_READY") return "Needs preparation";
  if (status === "READY_TO_PREPARE") return "Needs metadata";
  if (status === "READY_TO_ANALYZE") return "Ready to analyze";
  if (status === "ANALYZING") return "Analyzing";
  if (status === "REVIEW_REQUIRED") return "Needs review";
  if (status === "FAILED") return "Failed";
  return "Reviewed";
}

function analysisStatusLabel(
  overallStatus: DocumentLifecycleStatus,
  ingestionStatus: string,
  failureCode: string | null
): string {
  if (ingestionStatus === "EXTRACTING") return "Extracting text";
  if (ingestionStatus === "ANALYZING") return "Analyzing";
  if (ingestionStatus === "COMPLETE") return "Analysis complete";
  if (ingestionStatus === "FAILED" && failureCode === "ANALYSIS_FAILED") return "Analysis failed";
  if (ingestionStatus === "FAILED") return "Preparation failed";
  if (overallStatus === "READY_TO_PREPARE") return "Waiting for metadata";
  if (overallStatus === "READY_TO_ANALYZE") return "Ready to analyze";
  if (ingestionStatus === "UPLOADED") return "Uploaded";
  if (ingestionStatus === "READY") return "Ready to analyze";
  return "Not started";
}

function reviewPresentation(
  ingestionStatus: string,
  requiresReview: boolean
): DocumentLifecyclePresentation["review"] {
  if (ingestionStatus !== "COMPLETE") {
    return { state: "NOT_STARTED", label: "Not started" };
  }
  if (requiresReview) {
    return { state: "NEEDS_REVIEW", label: "Needs review" };
  }
  return { state: "REVIEWED", label: "Reviewed" };
}

function graphStatusLabel(status: string): string {
  if (status === "SUCCEEDED") return "Complete";
  if (status === "FAILED") return "Failed";
  return "Not run";
}

function failureLabel(input: {
  overallStatus: DocumentLifecycleStatus;
  ingestionStatus: string;
  graphExtractionStatus: string;
  failureCode: string | null;
}): string | null {
  if (input.overallStatus !== "FAILED") return null;
  if (input.ingestionStatus === "FAILED" && input.failureCode === "ANALYSIS_FAILED") {
    return "Analysis failed";
  }
  if (input.ingestionStatus === "FAILED") return "Preparation failed";
  if (input.graphExtractionStatus === "FAILED") return "Knowledge extraction failed";
  return "Processing failed";
}
