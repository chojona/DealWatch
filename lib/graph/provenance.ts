import type { EvidenceSupport, EvidenceView } from "@/lib/promotion/types";

export const graphEvidenceInclude = {
  document: { select: { id: true, originalFilename: true, documentDate: true } },
  documentPage: { select: { pageNumber: true } },
  message: {
    select: {
      id: true,
      sender: true,
      sentAt: true,
      thread: { select: { subject: true } },
    },
  },
} as const;

export const relationshipEvidenceInclude = {
  ...graphEvidenceInclude,
  promotion: { select: { decision: true } },
} as const;

export type ProvenanceObservation = {
  id: string;
  evidenceQuote: string;
  evidenceStartOffset?: number | null;
  evidenceEndOffset?: number | null;
  provenanceStatus: EvidenceSupport["provenanceStatus"];
  sourceKind: string;
  sourceLocation: string | null;
  messageId: string | null;
  documentId?: string | null;
  document: { id: string; originalFilename: string; documentDate: Date | null } | null;
  documentPage: { pageNumber: number } | null;
  message: { id: string; sender: string; sentAt: Date; thread: { subject: string } } | null;
  promotion?: { decision: string } | null;
};

export function graphReviewHref(input: {
  documentId: string | null;
  observationId: string;
  kind: "entity" | "relationship";
}): string | null {
  if (!input.documentId) return null;
  const section = input.kind === "entity" ? "entities" : "relationships";
  const params = new URLSearchParams({ section, focus: input.observationId });
  return `/documents/${input.documentId}/review?${params.toString()}`;
}

export function graphSourceLabel(input: {
  sourceKind: string;
  documentName: string | null;
  messageSubject: string | null;
  messageSender: string | null;
}): string {
  if (input.documentName) return input.documentName;
  if (input.sourceKind === "MESSAGE") {
    const subject = input.messageSubject?.trim() || "Message";
    return input.messageSender ? `${subject} · ${input.messageSender}` : subject;
  }
  if (input.sourceKind === "MANUAL") return "Manual source";
  return input.sourceKind;
}

export function evidenceSupportFromObservation(
  input: ProvenanceObservation,
  kind: "entity" | "relationship",
  reviewState: string | null = input.promotion?.decision ?? null
): EvidenceSupport {
  const documentId = input.document?.id ?? input.documentId ?? null;
  const pageNumber = input.provenanceStatus === "EXACT" ? input.documentPage?.pageNumber ?? null : null;
  const href =
    input.document && pageNumber
      ? `/api/documents/${input.document.id}/file#page=${pageNumber}`
      : input.document
        ? `/api/documents/${input.document.id}/file`
        : null;
  return {
    observationId: input.id,
    quote: input.evidenceQuote,
    provenanceStatus: input.provenanceStatus,
    pageNumber,
    documentId,
    documentName: input.document?.originalFilename ?? null,
    messageId: input.messageId,
    messageSubject: input.message?.thread.subject ?? null,
    messageSender: input.message?.sender ?? null,
    sourceKind: input.sourceKind,
    sourceLocation: input.sourceLocation,
    sourceDate: (input.document?.documentDate ?? input.message?.sentAt)?.toISOString() ?? null,
    href,
    reviewHref: graphReviewHref({ documentId, observationId: input.id, kind }),
    evidenceStartOffset: input.evidenceStartOffset ?? null,
    evidenceEndOffset: input.evidenceEndOffset ?? null,
    reviewState,
  };
}

export function entityOriginView(title: string, observations: ProvenanceObservation[]): EvidenceView {
  return {
    title,
    supportCount: observations.length,
    supports: observations.map((observation) => evidenceSupportFromObservation(observation, "entity", "ACCEPTED")),
  };
}

export function relationshipEvidenceView(
  title: string,
  supports: Array<{ relationshipObservation: ProvenanceObservation }>
): EvidenceView {
  return {
    title,
    supportCount: supports.length,
    supports: supports.map((support) => evidenceSupportFromObservation(support.relationshipObservation, "relationship")),
  };
}
