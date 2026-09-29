import type { ReadinessGapCode } from "./readiness";
import type { SourceFileState } from "./sourceFile";

export interface ReadinessGuidance {
  title: string;
  action: string;
}

/**
 * Upload extracts pages before analysis. A promoted attachment is stored
 * first and extracted later. Analyze may run the existing PDF extractor
 * when that is the only remaining gap.
 */
export function needsStoredPageExtraction(
  readiness: {
    fileReady: boolean;
    metadataReady: boolean;
    analysisEligible?: boolean;
    analysisReady: boolean;
    missing: Array<{ code: string }>;
  },
  ingestionStatus: string
): boolean {
  return (
    ingestionStatus === "UPLOADED" &&
    readiness.fileReady &&
    readiness.metadataReady &&
    (readiness.analysisEligible ?? true) &&
    !readiness.analysisReady &&
    readiness.missing.length === 1 &&
    readiness.missing[0]?.code === "EXTRACTED_PAGES"
  );
}

/**
 * Gaps the user must resolve. A stored promoted PDF does not ask the user to
 * extract pages; the existing Analyze path performs that step automatically.
 */
export function actionableReadinessGaps<T extends { code: string }>(
  gaps: T[],
  input: { ingestionStatus: string; fileReady: boolean }
): T[] {
  if (input.ingestionStatus !== "UPLOADED" || !input.fileReady) return gaps;
  return gaps.filter((gap) => gap.code !== "EXTRACTED_PAGES");
}

export function readinessGuidance(
  code: ReadinessGapCode,
  sourceFileState: SourceFileState = "MISSING"
): ReadinessGuidance {
  switch (code) {
    case "SOURCE_FILE":
      return {
        title: "Missing source PDF",
        action: sourceFileState === "AVAILABLE"
          ? "Confirm the stored PDF is the original file."
          : "Original PDF required. Upload the original PDF before analysis.",
      };
    case "MIME_TYPE":
      return {
        title: "Unsupported file type",
        action: "Replace the file with a PDF before analysis.",
      };
    case "EXTRACTED_PAGES":
      return {
        title: "Missing extracted pages",
        action: "Extract text from the original PDF before analysis.",
      };
    case "AUTHORING_SIDE":
      return {
        title: "Missing authoring side",
        action: "Set the authoring side to Tenant or Landlord, then save metadata.",
      };
    case "DOCUMENT_DATE":
      return {
        title: "Missing document date",
        action: "Enter the document date, then save metadata.",
      };
    case "DEAL":
      return {
        title: "Missing deal",
        action: "Associate this document with a deal before analysis.",
      };
    case "INGESTION_STATE":
      return {
        title: "Ingestion blocked",
        action: "Resolve the ingestion failure before analysis.",
      };
  }
}
