import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatCalendarDate } from "@/lib/formatters";
import { emptyReviewWork } from "@/lib/review/completion";
import { deriveInboxStatus, canRetryDocument, processingLabel } from "@/lib/inbox/status";
import { deriveReadiness } from "./readiness";
import { actionableReadinessGaps, needsStoredPageExtraction } from "./readinessCopy";
import { presentDocumentLifecycle } from "./lifecycle";

function readiness(overrides: Partial<Parameters<typeof deriveReadiness>[0]> = {}) {
  return deriveReadiness({
    mimeType: "application/pdf",
    sourceFileState: "AVAILABLE",
    hasUsableText: false,
    negotiationSide: null,
    documentDate: null,
    dealId: "deal",
    ingestionStatus: "UPLOADED",
    failureCode: null,
    ...overrides,
  });
}

function presentation(overrides: Partial<Parameters<typeof presentDocumentLifecycle>[0]> = {}) {
  return presentDocumentLifecycle({
    overallStatus: "READY_TO_ANALYZE",
    ingestionStatus: "UPLOADED",
    graphExtractionStatus: "NOT_RUN",
    failureCode: null,
    requiresReview: false,
    canRetry: false,
    ...overrides,
  });
}

test("uploaded documents name incomplete metadata and list exact requirements", () => {
  const state = readiness();
  assert.equal(state.metadataReady, false);
  assert.equal(state.analysisEligible, false);
  assert.deepEqual(
    state.missing.map((gap) => gap.code),
    ["EXTRACTED_PAGES", "AUTHORING_SIDE", "DOCUMENT_DATE"]
  );
  assert.deepEqual(
    actionableReadinessGaps(state.missing, {
      ingestionStatus: "UPLOADED",
      fileReady: state.fileReady,
    }).map((gap) => gap.code),
    ["AUTHORING_SIDE", "DOCUMENT_DATE"]
  );
  const derived = deriveInboxStatus({
    ingestionStatus: "UPLOADED",
    graphExtractionStatus: "NOT_RUN",
    fileReady: state.fileReady,
    metadataReady: state.metadataReady,
    analysisReady: state.analysisEligible,
    work: emptyReviewWork(),
    reviewReasons: [],
  });
  assert.equal(derived.processingStatus, "READY_TO_PREPARE");
  assert.equal(processingLabel(derived.processingStatus), "Needs metadata");
  const shown = presentation({ overallStatus: derived.processingStatus });
  assert.equal(shown.primaryLabel, "Needs metadata");
  assert.equal(shown.analysis.label, "Waiting for metadata");
  assert.equal(shown.review.label, "Not started");
});

test("a promoted PDF with complete metadata is eligible for Analyze before pages exist", () => {
  const state = readiness({
    negotiationSide: "TENANT",
    documentDate: new Date("2026-09-15T00:00:00.000Z"),
  });
  assert.equal(state.analysisReady, false);
  assert.equal(state.analysisEligible, true);
  assert.equal(needsStoredPageExtraction(state, "UPLOADED"), true);
  const derived = deriveInboxStatus({
    ingestionStatus: "UPLOADED",
    graphExtractionStatus: "NOT_RUN",
    fileReady: state.fileReady,
    metadataReady: state.metadataReady,
    analysisReady: state.analysisEligible,
    work: emptyReviewWork(),
    reviewReasons: [],
  });
  assert.equal(derived.processingStatus, "READY_TO_ANALYZE");
  const shown = presentation();
  assert.equal(shown.primaryLabel, "Ready to analyze");
  assert.equal(shown.analysis.label, "Ready to analyze");
});

test("analyzing and retryable analysis failure have explicit user-facing states", () => {
  const running = presentation({
    overallStatus: "ANALYZING",
    ingestionStatus: "ANALYZING",
  });
  assert.equal(running.primaryLabel, "Analyzing");
  assert.equal(running.analysis.label, "Analyzing");

  const retryable = canRetryDocument({
    ingestionStatus: "FAILED",
    failureCode: "ANALYSIS_FAILED",
    graphExtractionStatus: "SUCCEEDED",
  });
  assert.equal(retryable, true);
  const failed = presentation({
    overallStatus: "FAILED",
    ingestionStatus: "FAILED",
    graphExtractionStatus: "SUCCEEDED",
    failureCode: "ANALYSIS_FAILED",
    canRetry: retryable,
  });
  assert.equal(failed.primaryLabel, "Analysis failed");
  assert.equal(failed.analysis.label, "Analysis failed");
  assert.match(failed.retryExplanation ?? "", /without creating another saved round/);
});

test("analysis completion and review completion stay separate and use shared labels", () => {
  const work = emptyReviewWork();
  work.negotiationTotal = 1;
  work.negotiationPending = 1;
  const pending = deriveInboxStatus({
    ingestionStatus: "COMPLETE",
    graphExtractionStatus: "SUCCEEDED",
    fileReady: true,
    metadataReady: true,
    analysisReady: false,
    work,
    reviewReasons: ["NEGOTIATION_REVIEW_PENDING"],
  });
  const shown = presentation({
    overallStatus: pending.processingStatus,
    ingestionStatus: "COMPLETE",
    graphExtractionStatus: "SUCCEEDED",
    requiresReview: pending.requiresReview,
  });
  assert.equal(shown.analysis.label, "Analysis complete");
  assert.equal(shown.review.label, "Needs review");
  assert.equal(shown.primaryLabel, "Needs review");
  assert.equal(shown.primaryLabel, processingLabel(pending.processingStatus));

  work.negotiationPending = 0;
  work.negotiationAcknowledged = 1;
  const reviewed = deriveInboxStatus({
    ingestionStatus: "COMPLETE",
    graphExtractionStatus: "SUCCEEDED",
    fileReady: true,
    metadataReady: true,
    analysisReady: false,
    work,
    reviewReasons: [],
  });
  const closed = presentation({
    overallStatus: reviewed.processingStatus,
    ingestionStatus: "COMPLETE",
    graphExtractionStatus: "SUCCEEDED",
    requiresReview: reviewed.requiresReview,
  });
  assert.equal(closed.review.label, "Reviewed");
  assert.equal(closed.primaryLabel, "Reviewed");

  work.negotiationAcknowledged = 0;
  work.negotiationFollowUp = 1;
  const reopened = deriveInboxStatus({
    ingestionStatus: "COMPLETE",
    graphExtractionStatus: "SUCCEEDED",
    fileReady: true,
    metadataReady: true,
    analysisReady: false,
    work,
    reviewReasons: ["NEGOTIATION_FOLLOW_UP"],
  });
  assert.equal(reopened.processingStatus, "REVIEW_REQUIRED");
});

test("a graph failure does not rewrite completed negotiation analysis or review state", () => {
  const shown = presentation({
    overallStatus: "FAILED",
    ingestionStatus: "COMPLETE",
    graphExtractionStatus: "FAILED",
    requiresReview: true,
    canRetry: true,
  });
  assert.equal(shown.primaryLabel, "Knowledge extraction failed");
  assert.equal(shown.analysis.label, "Analysis complete");
  assert.equal(shown.review.label, "Needs review");
  assert.equal(shown.knowledge.label, "Failed");
});

test("document dates preserve the entered calendar day", () => {
  assert.equal(formatCalendarDate("2026-09-15T00:00:00.000Z"), "Sep 15, 2026");
});

test("obsolete document resolution and unsafe public deletion routes stay removed", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  assert.equal(existsSync(path.join(root, "app/documents/[id]/resolution/page.tsx")), false);
  const documentRoute = readFileSync(path.join(root, "app/api/documents/[id]/route.ts"), "utf8");
  assert.doesNotMatch(documentRoute, /export\s+async\s+function\s+DELETE\b/);
});

test("document retry still runs graph extraction after negotiation analysis returns", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const documentRoute = readFileSync(path.join(root, "app/api/documents/[id]/route.ts"), "utf8");
  const post = documentRoute.slice(documentRoute.indexOf("export async function POST"));
  const analyzeAt = post.indexOf("analyzeNegotiationDocument(");
  const graphAt = post.indexOf("runDocumentGraphExtraction(");
  assert.ok(analyzeAt >= 0);
  assert.ok(graphAt > analyzeAt);
});
