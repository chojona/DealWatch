import type {
  CanonicalTermType,
  ExtractTermsOutput,
  NegotiationExtraction,
  ValidatedNegotiationTerm,
} from "./schemas";
import {
  coerceModelStructuredPayload,
  parseStructuredPayload,
  supportsStructuredPayload,
} from "./payloads";

const MIN_TERM_CONFIDENCE = 0.6;

const QUALITATIVE_TERM_TYPES = new Set<CanonicalTermType>([
  "RENT_STRUCTURE",
  "COMMENCEMENT_DATE",
  "RENEWAL_OPTIONS",
  "EXPANSION_RIGHTS",
  "TERMINATION_RIGHTS",
  "ASSIGNMENT_SUBLETTING",
  "OPERATING_EXPENSES",
  "DELIVERY_CONDITION",
]);

type Candidate = NegotiationExtraction["terms"][number];

function uniqueNumbers(matches: IterableIterator<RegExpMatchArray>) {
  return [
    ...new Set(
      [...matches].map((match) => Number(match[1]!.replaceAll(",", "")))
    ),
  ].filter(Number.isFinite);
}

function rentRates(value: string) {
  return uniqueNumbers(
    value.matchAll(
      /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/\s*(?:r?s?f|rentable\s+square\s+foot)\s*\/\s*year|per\s+(?:r?s?f|rentable\s+square\s+foot)\s+per\s+year)/gi
    )
  );
}

function parkingSpaceCounts(value: string) {
  return uniqueNumbers(
    value.matchAll(
      /\b([0-9][0-9,]*(?:\.[0-9]+)?)\s+(?:(?:reserved|unreserved|parking|garage)\s+)*spaces?\b/gi
    )
  );
}

function parkingRates(value: string) {
  return uniqueNumbers(
    value.matchAll(
      /\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/|per\s+)space\s*(?:\/|per\s+)month\b/gi
    )
  );
}

function explicitAbsenceStatement(value: string) {
  return (
    /\b(?:is|are|was|were)\s+not\s+(?:currently\s+)?(?:stated|specified|provided|included|addressed|mentioned)\b/i.test(
      value
    ) ||
    /\bno\b[^.!?]{0,160}\b(?:is|are|was|were)\s+(?:currently\s+)?(?:stated|specified|provided|included|addressed|mentioned)\b/i.test(
      value
    ) ||
    /\b(?:does|do|did)\s+not\s+(?:state|specify|provide|include|address|mention)\b/i.test(
      value
    ) ||
    /\b(?:states?|provides?|includes?)\s+no\s+current\b/i.test(value) ||
    /\bsilent\s+(?:on|as\s+to)\b/i.test(value)
  );
}

function normalizeCandidate(
  candidate: Candidate,
  groundedValue: string
): {
  canonicalType: CanonicalTermType;
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: Candidate["normalizedUnit"];
  numericRoleValid: boolean;
} {
  let canonicalType = candidate.canonicalType;
  let normalizedValue = candidate.normalizedValue;
  let normalizedNumeric = candidate.normalizedNumeric;
  let normalizedUnit = candidate.normalizedUnit;
  let numericRoleValid = true;

  if (
    canonicalType === "ANNUAL_ESCALATION" &&
    /\b(?:controllable\s+)?operating\s+expenses?\b/i.test(groundedValue)
  ) {
    canonicalType = "OPERATING_EXPENSES";
  }

  if (
    canonicalType === "BASE_RENT" &&
    /\b(?:base\s+)?rent\s+abatement\b|\bfree\s+(?:base\s+)?rent\b/i.test(
      groundedValue
    )
  ) {
    canonicalType = "FREE_RENT";
  }

  if (
    canonicalType === "BASE_RENT" &&
    normalizedNumeric === 0 &&
    normalizedUnit === "USD_PER_RSF_YEAR"
  ) {
    const rates = rentRates(groundedValue);
    if (rates.length === 1) normalizedNumeric = rates[0]!;
    else if (rates.some((rate) => rate !== 0)) numericRoleValid = false;
  }

  if (canonicalType === "PARKING") {
    const counts = parkingSpaceCounts(groundedValue);
    if (counts.length === 1) {
      normalizedNumeric = counts[0]!;
      normalizedUnit = "SPACES";
      const rates = parkingRates(groundedValue);
      if (rates.length === 1) {
        normalizedValue =
          "$" + rates[0] + "/space/month for " + counts[0] + " spaces";
      }
    } else if (counts.length > 1) {
      numericRoleValid = false;
    }
  }

  if (
    normalizedNumeric === 0 &&
    normalizedUnit === null &&
    QUALITATIVE_TERM_TYPES.has(canonicalType)
  ) {
    normalizedNumeric = null;
  }

  if (normalizedValue?.trim().toLowerCase() === "null") {
    normalizedValue = null;
  }

  return {
    canonicalType,
    normalizedValue,
    normalizedNumeric,
    normalizedUnit,
    numericRoleValid,
  };
}

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
    const rawValue = candidate.rawValue.trim();
    const groundedValue = documentText.includes(rawValue)
      ? rawValue
      : (evidenceQuote ?? "");
    const normalized = normalizeCandidate(candidate, groundedValue);
    const numericValid =
      normalized.normalizedNumeric === null ||
      Number.isFinite(normalized.normalizedNumeric);
    const numericHasUnit =
      normalized.normalizedNumeric === null || normalized.normalizedUnit !== null;

    if (
      !evidenceQuote ||
      !rawValue ||
      explicitAbsenceStatement(evidenceQuote) ||
      candidate.status === "NOT_MENTIONED" ||
      !validConfidence(candidate.confidence) ||
      candidate.confidence < MIN_TERM_CONFIDENCE ||
      !numericValid ||
      !numericHasUnit ||
      !normalized.numericRoleValid
    ) {
      validationFailures += 1;
      continue;
    }

    /**
     * Structured payload validation boundary.
     *
     * Rules:
     * - Only attempt parsing for canonicalTypes that have a payload shape.
     * - parseStructuredPayload returns null on malformed JSON, schema
     *   violations, or canonicalType mismatch — it never throws.
     * - A null or malformed payload must NOT cause an otherwise-valid
     *   legacy observation to be dropped; only the payload becomes null.
     * - canonicalType mismatch (payload.termType ≠ canonicalType) produces
     *   null here; the mismatch is silently handled conservatively.
     */
    const structuredPayload =
      supportsStructuredPayload(normalized.canonicalType) &&
      candidate.structuredPayload != null
        ? parseStructuredPayload(
            coerceModelStructuredPayload(candidate.structuredPayload),
            normalized.canonicalType
          )
        : null;

    terms.push({
      canonicalType: normalized.canonicalType,
      ...(normalized.normalizedValue?.trim()
        ? { normalizedValue: normalized.normalizedValue.trim() }
        : {}),
      ...(normalized.normalizedNumeric !== null
        ? { normalizedNumeric: normalized.normalizedNumeric }
        : {}),
      ...(normalized.normalizedUnit !== null
        ? { normalizedUnit: normalized.normalizedUnit }
        : {}),
      rawValue,
      status: candidate.status,
      confidence: candidate.confidence,
      evidenceQuote,
      ...(candidate.sourceLocation?.trim()
        ? { sourceLocation: candidate.sourceLocation.trim() }
        : {}),
      ...(structuredPayload !== null ? { structuredPayload } : {}),
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
