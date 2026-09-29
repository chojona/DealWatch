import type { PrismaClient } from "@prisma/client";
import { hasUsableText } from "./pageText";
import { getDocumentStorage } from "./storage";
import { inspectSourceFile, type SourceFileState } from "./sourceFile";

export const READINESS_GAPS = [
  "SOURCE_FILE",
  "MIME_TYPE",
  "EXTRACTED_PAGES",
  "AUTHORING_SIDE",
  "DOCUMENT_DATE",
  "DEAL",
  "INGESTION_STATE",
] as const;

export type ReadinessGapCode = (typeof READINESS_GAPS)[number];

export interface ReadinessGap {
  code: ReadinessGapCode;
  label: string;
}

export interface DocumentReadiness {
  fileReady: boolean;
  metadataReady: boolean;
  analysisReady: boolean;
  reviewReady: boolean;
  sourceFileState: SourceFileState;
  missing: ReadinessGap[];
}

export interface ReadinessInput {
  mimeType: string;
  sourceFileState: SourceFileState;
  hasUsableText: boolean;
  negotiationSide: string | null;
  documentDate: Date | null;
  dealId: string | null;
  ingestionStatus: string;
  failureCode: string | null;
}

const SUPPORTED_MIME = "application/pdf";
const ANALYSIS_BLOCKERS = new Set([
  "SCANNED_OR_EMPTY",
  "EXTRACTION_FAILED",
  "TEXT_TOO_LARGE",
  "STORAGE_FAILED",
]);

export function sideReady(side: string | null | undefined): side is "TENANT" | "LANDLORD" {
  return side === "TENANT" || side === "LANDLORD";
}

export function dateReady(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Requirements for running the existing negotiation analysis pipeline.
 * Nothing here is inferred. A missing side or date stays missing.
 */
export function deriveReadiness(input: ReadinessInput): DocumentReadiness {
  const fileReady = input.sourceFileState === "AVAILABLE" && input.mimeType === SUPPORTED_MIME;
  const metadataReady = sideReady(input.negotiationSide) && dateReady(input.documentDate) && Boolean(input.dealId);
  const pagesReady = input.hasUsableText;
  const ingestionBlocked =
    input.ingestionStatus === "FAILED" &&
    input.failureCode !== "ANALYSIS_FAILED" &&
    input.failureCode !== null &&
    ANALYSIS_BLOCKERS.has(input.failureCode);
  const ingestionBusy = input.ingestionStatus === "EXTRACTING" || input.ingestionStatus === "ANALYZING";
  const analysisReady =
    fileReady &&
    metadataReady &&
    pagesReady &&
    !ingestionBlocked &&
    !ingestionBusy &&
    input.ingestionStatus !== "COMPLETE";
  const reviewReady = input.ingestionStatus === "COMPLETE";

  const missing: ReadinessGap[] = [];
  if (input.sourceFileState !== "AVAILABLE") {
    missing.push({
      code: "SOURCE_FILE",
      label:
        input.sourceFileState === "UNAVAILABLE"
          ? "Source file is unavailable"
          : "Source file",
    });
  }
  if (input.mimeType !== SUPPORTED_MIME) {
    missing.push({ code: "MIME_TYPE", label: "Supported PDF file type" });
  }
  if (!pagesReady) {
    missing.push({ code: "EXTRACTED_PAGES", label: "Extracted pages" });
  }
  if (!sideReady(input.negotiationSide)) {
    missing.push({ code: "AUTHORING_SIDE", label: "Authoring side" });
  }
  if (!dateReady(input.documentDate)) {
    missing.push({ code: "DOCUMENT_DATE", label: "Document date" });
  }
  if (!input.dealId) {
    missing.push({ code: "DEAL", label: "Deal association" });
  }
  if (ingestionBlocked) {
    missing.push({
      code: "INGESTION_STATE",
      label: "Ingestion must succeed before analysis",
    });
  }

  return {
    fileReady,
    metadataReady,
    analysisReady,
    reviewReady,
    sourceFileState: input.sourceFileState,
    missing: reviewReady || input.ingestionStatus === "COMPLETE" ? [] : missing,
  };
}

export async function loadDocumentReadiness(
  prisma: PrismaClient,
  documentId: string
): Promise<(DocumentReadiness & { documentId: string; dealId: string }) | null> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      dealId: true,
      mimeType: true,
      storageKey: true,
      negotiationSide: true,
      documentDate: true,
      ingestionStatus: true,
      failureCode: true,
      pages: { select: { text: true } },
    },
  });
  if (!document) return null;
  const sourceFileState = await inspectSourceFile(getDocumentStorage(), document.storageKey);
  return {
    documentId: document.id,
    dealId: document.dealId,
    ...deriveReadiness({
      mimeType: document.mimeType,
      sourceFileState,
      hasUsableText: hasUsableText(document.pages),
      negotiationSide: document.negotiationSide,
      documentDate: document.documentDate,
      dealId: document.dealId,
      ingestionStatus: document.ingestionStatus,
      failureCode: document.failureCode,
    }),
  };
}
