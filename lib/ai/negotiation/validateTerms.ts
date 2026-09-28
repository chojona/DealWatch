import type {
  ExtractTermsOutput,
  NegotiationExtraction,
  ValidatedNegotiationTerm,
} from "./schemas";

const MIN_TERM_CONFIDENCE = 0.6;

function exactEvidence(documentText: string, quote: string): string | null {
  const trimmed = quote.trim();
  return trimmed && documentText.includes(trimmed) ? trimmed : null;
}

function validConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateExtractedTerms({
  documentText,
  extraction,
  model,
  extractedAt,
  latencyMs,
}: {
  documentText: string;
  extraction: NegotiationExtraction;
  model: string;
  extractedAt: Date;
  latencyMs: number;
}): ExtractTermsOutput {
  const terms: ValidatedNegotiationTerm[] = [];
  let validationFailures = 0;

  for (const candidate of extraction.terms) {
    const evidenceQuote = exactEvidence(documentText, candidate.evidenceQuote);
    const numericValid =
      candidate.normalizedNumeric === null ||
      Number.isFinite(candidate.normalizedNumeric);
    const numericHasUnit =
      candidate.normalizedNumeric === null || candidate.normalizedUnit !== null;

    if (
      !evidenceQuote ||
      !candidate.rawValue.trim() ||
      candidate.status === "NOT_MENTIONED" ||
      !validConfidence(candidate.confidence) ||
      candidate.confidence < MIN_TERM_CONFIDENCE ||
      !numericValid ||
      !numericHasUnit
    ) {
      validationFailures += 1;
      continue;
    }

    terms.push({
      canonicalType: candidate.canonicalType,
      ...(candidate.normalizedValue?.trim()
        ? { normalizedValue: candidate.normalizedValue.trim() }
        : {}),
      ...(candidate.normalizedNumeric !== null
        ? { normalizedNumeric: candidate.normalizedNumeric }
        : {}),
      ...(candidate.normalizedUnit !== null
        ? { normalizedUnit: candidate.normalizedUnit }
        : {}),
      rawValue: candidate.rawValue.trim(),
      status: candidate.status,
      confidence: candidate.confidence,
      evidenceQuote,
      ...(candidate.sourceLocation?.trim()
        ? { sourceLocation: candidate.sourceLocation.trim() }
        : {}),
    });
  }

  const overallConfidence = validConfidence(extraction.overallConfidence)
    ? extraction.overallConfidence
    : 0;
  if (!validConfidence(extraction.overallConfidence)) validationFailures += 1;

  return {
    terms,
    metadata: {
      model,
      extractedAt: extractedAt.toISOString(),
      latencyMs: Math.max(0, latencyMs),
      extractionConfidence: overallConfidence,
      validationFailures,
    },
  };
}
