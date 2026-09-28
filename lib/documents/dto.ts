import type { Document, DocumentType } from "@prisma/client";

export interface DocumentRoundSummary {
  id: string;
  _count?: { terms: number };
  terms?: Array<{ id: string }>;
}

export interface DocumentRecord extends Document {
  negotiationRounds?: DocumentRoundSummary[];
}

export interface DocumentDto {
  id: string;
  dealId: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  documentType: DocumentType;
  documentDate: string | null;
  negotiationSide: string | null;
  ingestionStatus: Document["ingestionStatus"];
  failureCode: string | null;
  failureReason: string | null;
  graphExtractionStatus: Document["graphExtractionStatus"];
  graphFailureCode: string | null;
  graphFailureReason: string | null;
  pageCount: number | null;
  createdAt: string;
  updatedAt: string;
  roundId: string | null;
  termCount: number;
}

function termCount(round: DocumentRoundSummary | undefined): number {
  if (!round) return 0;
  if (round._count) return round._count.terms;
  return round.terms?.length ?? 0;
}

export function toDocumentDto(document: DocumentRecord): DocumentDto {
  const round = document.negotiationRounds?.[0];
  return {
    id: document.id,
    dealId: document.dealId,
    filename: document.filename,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    documentType: document.documentType,
    documentDate: document.documentDate?.toISOString() ?? null,
    negotiationSide: document.negotiationSide,
    ingestionStatus: document.ingestionStatus,
    failureCode: document.failureCode,
    failureReason: document.failureReason,
    graphExtractionStatus: document.graphExtractionStatus,
    graphFailureCode: document.graphFailureCode,
    graphFailureReason: document.graphFailureReason,
    pageCount: document.pageCount,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    roundId: round?.id ?? null,
    termCount: termCount(round),
  };
}
