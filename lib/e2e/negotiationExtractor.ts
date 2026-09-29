import type { ExtractTermsInput } from "@/lib/ai/negotiation/extractTerms";
import { CREStructuredPayloadSchema } from "@/lib/ai/negotiation/payloads";
import {
  CanonicalTermTypeSchema,
  type ExtractTermsOutput,
  type NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";
import { shouldFailOnce } from "./failOnce";
import { isE2ETestMode } from "./mode";

const RENT_LINE = /Base Rent:\s*\$(\d+(?:\.\d+)?) per rentable square foot per year/i;
const OVERRIDE = /E2E_EXTRACT_BASE_RENT:(\d+(?:\.\d+)?)/;
const STATUS_OVERRIDE = /E2E_STATUS:(PROPOSED|AGREED|REJECTED|WITHDRAWN|UNRESOLVED)/;
const BOARD_LINE = /^([A-Z0-9_]+) is (PROPOSED|AGREED|REJECTED|WITHDRAWN|UNRESOLVED)$/gm;

function metadata(): ExtractTermsOutput["metadata"] {
  return {
    model: "e2e-deterministic",
    extractedAt: new Date().toISOString(),
    latencyMs: 1,
    extractionConfidence: 1,
    validationFailures: 0,
  };
}

type ExtractedStatus = Exclude<NegotiationTermStatus, "NOT_MENTIONED">;

function extractedStatus(value: string): ExtractedStatus {
  if (value === "AGREED" || value === "REJECTED" || value === "WITHDRAWN" || value === "UNRESOLVED") return value;
  return "PROPOSED";
}

function rentTerm(
  amount: number,
  evidenceQuote: string,
  rawValue: string,
  status: ExtractedStatus
): ExtractTermsOutput["terms"][number] {
  return {
    canonicalType: "BASE_RENT",
    normalizedValue: `$${amount.toFixed(2)}/RSF/year`,
    normalizedNumeric: amount,
    normalizedUnit: "USD_PER_RSF_YEAR",
    rawValue,
    status,
    confidence: 1,
    evidenceQuote,
    sourceLocation: "Letter of Intent",
    structuredPayload: CREStructuredPayloadSchema.parse({
      termType: "BASE_RENT",
      rent: { kind: "simple", amountPerRSFYear: amount },
    }),
  };
}

function boardTerms(documentText: string): ExtractTermsOutput["terms"] {
  const terms: ExtractTermsOutput["terms"] = [];
  for (const match of documentText.matchAll(BOARD_LINE)) {
    const parsedType = CanonicalTermTypeSchema.safeParse(match[1]);
    if (!parsedType.success) continue;
    const canonicalType = parsedType.data;
    const status = extractedStatus(match[2] ?? "");
    const evidenceQuote = `${canonicalType} is ${status}`;
    if (canonicalType === "BASE_RENT") {
      terms.push(rentTerm(72, evidenceQuote, evidenceQuote, status));
      continue;
    }
    terms.push({
      canonicalType,
      normalizedValue: evidenceQuote,
      rawValue: evidenceQuote,
      status,
      confidence: 1,
      evidenceQuote,
      sourceLocation: "E2E attention board",
    });
  }
  return terms;
}

/**
 * Deterministic negotiation extractor used only when E2E mode is on.
 * It reads the document text. It does not call Gemini or OpenAI.
 */
export async function e2eNegotiationExtractor(input: ExtractTermsInput): Promise<ExtractTermsOutput> {
  if (!isE2ETestMode()) {
    throw new Error("The deterministic E2E negotiation extractor is not active");
  }
  if (input.documentText.includes("E2E_FAIL_ONCE") && shouldFailOnce(`document:${input.documentText}`)) {
    throw new Error("E2E document analysis failed once");
  }
  if (input.documentText.includes("E2E_ATTENTION_BOARD")) {
    return { terms: boardTerms(input.documentText), metadata: metadata() };
  }

  const line = input.documentText.match(RENT_LINE);
  if (!line) return { terms: [], metadata: metadata() };
  const evidenceQuote = line[0];
  const override = input.documentText.match(OVERRIDE);
  const amount = Number(override?.[1] ?? line[1]);
  const status = extractedStatus(input.documentText.match(STATUS_OVERRIDE)?.[1] ?? "PROPOSED");
  const rawValue = override ? `$${override[1]}` : evidenceQuote;
  return {
    terms: [rentTerm(amount, evidenceQuote, rawValue, status)],
    metadata: metadata(),
  };
}
