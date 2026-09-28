import type { EvidenceSupport } from "@/lib/promotion/types";
import type { ActivityEntityRef, ActivityEvent } from "./types";

export interface ActivityEvidenceObservation {
  id: string;
  evidenceQuote: string;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
  sourceKind: string;
  sourceLocation: string | null;
  messageId: string | null;
  documentId: string | null;
  documentPageId: string | null;
  document: { id: string; originalFilename: string; documentDate: Date | null } | null;
  documentPage: { id?: string; pageNumber: number } | null;
  message: { sentAt: Date } | null;
}

export function activityEvidenceSupport(row: ActivityEvidenceObservation): EvidenceSupport {
  const pageNumber = row.provenanceStatus === "EXACT" ? row.documentPage?.pageNumber ?? null : null;
  return {
    observationId: row.id,
    quote: row.evidenceQuote,
    provenanceStatus: row.provenanceStatus,
    pageNumber,
    documentId: row.document?.id ?? row.documentId,
    documentName: row.document?.originalFilename ?? null,
    messageId: row.messageId,
    sourceKind: row.sourceKind,
    sourceLocation: row.sourceLocation,
    sourceDate: (row.document?.documentDate ?? row.message?.sentAt)?.toISOString() ?? null,
    href: row.document ? `/api/documents/${row.document.id}/file${pageNumber ? `#page=${pageNumber}` : ""}` : null,
  };
}

export function observationOccurredAt(row: ActivityEvidenceObservation): string | null {
  return (row.document?.documentDate ?? row.message?.sentAt)?.toISOString() ?? null;
}

export function buildDocumentEvent(row: {
  id: string;
  dealId: string;
  originalFilename: string;
  documentType: string;
  documentDate: Date | null;
  negotiationSide: string | null;
  ingestionStatus: string;
  graphExtractionStatus: string;
  createdAt: Date;
  pageCount: number | null;
}, refs: ActivityEntityRef[]): ActivityEvent {
  const side = row.negotiationSide ? `${sentence(row.negotiationSide)} · ` : "";
  const analysis = row.graphExtractionStatus === "SUCCEEDED" ? "Entity analysis complete" : row.graphExtractionStatus === "FAILED" ? "Entity analysis failed" : "Entity analysis not run";
  return {
    id: `document:${row.id}`,
    occurredAt: row.documentDate?.toISOString() ?? null,
    recordedAt: row.createdAt.toISOString(),
    eventType: "DOCUMENT",
    title: row.originalFilename,
    description: `${side}${sentence(row.documentType)} · ${sentence(row.ingestionStatus)} · ${analysis}${row.pageCount ? ` · ${row.pageCount} pages` : ""}`,
    entityRefs: refs,
    dealId: row.dealId,
    documentId: row.id,
    sourceType: "DOCUMENT",
    sourceId: row.id,
    dedupeKey: `document:${row.id}`,
  };
}

export function sentence(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
