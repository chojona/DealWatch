export type ActivityProvenanceStatus = "EXACT" | "AMBIGUOUS" | "UNLOCATED";

export interface LocatedEvidence {
  provenanceStatus: ActivityProvenanceStatus;
  evidenceStartOffset: number | null;
  evidenceEndOffset: number | null;
}

/**
 * Offsets are recorded only when the quote occurs once.
 * A repeated quote is ambiguous. A missing quote is unlocated.
 * This function never guesses a span.
 */
export function locateEvidence(body: string, quote: string): LocatedEvidence {
  if (!quote) {
    return { provenanceStatus: "UNLOCATED", evidenceStartOffset: null, evidenceEndOffset: null };
  }
  const first = body.indexOf(quote);
  if (first < 0) {
    return { provenanceStatus: "UNLOCATED", evidenceStartOffset: null, evidenceEndOffset: null };
  }
  const second = body.indexOf(quote, first + 1);
  if (second >= 0) {
    return { provenanceStatus: "AMBIGUOUS", evidenceStartOffset: null, evidenceEndOffset: null };
  }
  return {
    provenanceStatus: "EXACT",
    evidenceStartOffset: first,
    evidenceEndOffset: first + quote.length,
  };
}

export function highlightSpans(body: string, spans: Array<{ start: number; end: number }>): Array<{ text: string; highlighted: boolean }> {
  const ranges = spans
    .filter((span) => span.start >= 0 && span.end > span.start && span.end <= body.length)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  const parts: Array<{ text: string; highlighted: boolean }> = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) parts.push({ text: body.slice(cursor, range.start), highlighted: false });
    parts.push({ text: body.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), highlighted: false });
  return parts.filter((part) => part.text.length > 0);
}
