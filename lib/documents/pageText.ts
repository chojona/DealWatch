/** Maximum source text accepted by the frozen negotiation extractor. */
export const MAX_NEGOTIATION_DOCUMENT_CHARS = 120_000;

/**
 * Conservative cleanup of extractor artifacts. Does not rewrite words,
 * punctuation, or line breaks that carry document meaning.
 */
export function normalizePageText(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasUsableText(pages: Array<{ text: string }>): boolean {
  return pages.some((page) => page.text.replace(/\s+/g, "").length > 0);
}

/**
 * Canonical source passed to the negotiation extractor. Page markers are
 * deterministic and are not evidence. Provenance is resolved against the
 * page texts themselves, never by trusting a marker the model repeats.
 */
export function toPageMarkedText(
  pages: Array<{ pageNumber: number; text: string }>
): string {
  return [...pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => `--- PAGE ${page.pageNumber} ---\n${page.text}`)
    .join("\n\n");
}
