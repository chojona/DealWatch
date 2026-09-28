export interface EvidencePage {
  id?: string;
  pageNumber: number;
  text: string;
}

export interface EvidenceMatch {
  pageNumber: number;
  pageId: string | null;
  startOffset: number;
  endOffset: number;
}

export type EvidenceLocation =
  | ({ status: "EXACT" } & EvidenceMatch)
  | { status: "AMBIGUOUS"; matches: EvidenceMatch[] }
  | { status: "UNLOCATED" };

export interface ProvenanceWrite {
  documentPageId: string | null;
  evidenceStartOffset: number | null;
  evidenceEndOffset: number | null;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED";
}

/**
 * Exact substring match against extracted page text. A quote that appears on
 * more than one page is ambiguous. This function never guesses a page.
 */
export function locateEvidence({
  evidenceQuote,
  pages,
}: {
  evidenceQuote: string;
  pages: EvidencePage[];
}): EvidenceLocation {
  const quote = evidenceQuote.trim();
  if (!quote) return { status: "UNLOCATED" };

  const matches: EvidenceMatch[] = [];
  for (const page of [...pages].sort(
    (left, right) => left.pageNumber - right.pageNumber
  )) {
    const startOffset = page.text.indexOf(quote);
    if (startOffset < 0) continue;
    matches.push({
      pageNumber: page.pageNumber,
      pageId: page.id ?? null,
      startOffset,
      endOffset: startOffset + quote.length,
    });
  }

  if (matches.length === 0) return { status: "UNLOCATED" };
  if (matches.length === 1) return { status: "EXACT", ...matches[0]! };
  return { status: "AMBIGUOUS", matches };
}

/**
 * Drop model-supplied page claims. Section headings that are not page
 * numbers are preserved. Page provenance comes only from locateEvidence.
 */
export function sectionSourceLocation(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^pages?\b/i.test(trimmed)) return null;
  return trimmed;
}

export function attachEvidenceProvenance<
  T extends { evidenceQuote: string; sourceLocation?: string | null },
>(term: T, pages: EvidencePage[]): T & { provenance: ProvenanceWrite } {
  const location = locateEvidence({
    evidenceQuote: term.evidenceQuote,
    pages,
  });
  const sourceLocation = sectionSourceLocation(term.sourceLocation) ?? undefined;
  if (location.status === "EXACT") {
    return {
      ...term,
      sourceLocation,
      provenance: {
        provenanceStatus: "EXACT",
        documentPageId: location.pageId,
        evidenceStartOffset: location.startOffset,
        evidenceEndOffset: location.endOffset,
      },
    };
  }
  return {
    ...term,
    sourceLocation,
    provenance: {
      provenanceStatus: location.status,
      documentPageId: null,
      evidenceStartOffset: null,
      evidenceEndOffset: null,
    },
  };
}
