export interface TermSourcePresentation {
  filename: string;
  evidenceQuote: string;
  sectionLabel: string | null;
  pageLabel: string | null;
  documentId: string | null;
  pageNumber: number | null;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
}

/**
 * View model for term evidence. Legacy pasted rounds have no document and
 * no provenance status, and still render from the round's document name.
 */
export function presentTermSource(input: {
  documentName: string;
  evidenceQuote: string;
  sourceLocation: string | null;
  provenanceStatus?: string | null;
  pageNumber?: number | null;
  originalFilename?: string | null;
  documentId?: string | null;
}): TermSourcePresentation {
  const provenanceStatus =
    input.provenanceStatus === "EXACT" ||
    input.provenanceStatus === "AMBIGUOUS" ||
    input.provenanceStatus === "UNLOCATED"
      ? input.provenanceStatus
      : null;
  const pageNumber =
    provenanceStatus === "EXACT" && input.pageNumber
      ? input.pageNumber
      : null;

  return {
    filename: input.originalFilename?.trim() || input.documentName,
    evidenceQuote: input.evidenceQuote,
    sectionLabel: input.sourceLocation,
    pageLabel:
      pageNumber !== null
        ? `Page ${pageNumber}`
        : provenanceStatus === "AMBIGUOUS"
          ? "Page ambiguous"
          : null,
    documentId: input.documentId ?? null,
    pageNumber,
    provenanceStatus,
  };
}
