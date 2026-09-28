import { z } from "zod";
import { CREStructuredPayloadSchema } from "./payloads";

export const NegotiationSideSchema = z.enum(["TENANT", "LANDLORD"]);

export const CanonicalTermTypeSchema = z.enum([
  "PREMISES_RSF",
  "BASE_RENT",
  "RENT_STRUCTURE",
  "ANNUAL_ESCALATION",
  "LEASE_TERM",
  "COMMENCEMENT_DATE",
  "TI_ALLOWANCE",
  "FREE_RENT",
  "SECURITY_DEPOSIT",
  "RENEWAL_OPTIONS",
  "EXPANSION_RIGHTS",
  "TERMINATION_RIGHTS",
  "ASSIGNMENT_SUBLETTING",
  "OPERATING_EXPENSES",
  "PARKING",
  "DELIVERY_CONDITION",
]);

export const NegotiationTermStatusSchema = z.enum([
  "PROPOSED",
  "AGREED",
  "REJECTED",
  "WITHDRAWN",
  "UNRESOLVED",
  "NOT_MENTIONED",
]);

export const NormalizedUnitSchema = z.enum([
  "RSF",
  "USD_PER_RSF_YEAR",
  "PERCENT_ANNUAL",
  "MONTHS",
  "DATE",
  "USD",
  "MONTHS_RENT",
  "SPACES",
  "OTHER",
]);

/**
 * Model-facing candidates. Nullable fields are required for Structured Outputs.
 * structuredPayload is untyped here so the JSON schema stays shallow and
 * Gemini/OpenAI structured-output enforcement stays reliable; the payload is
 * validated against the full CREStructuredPayloadSchema inside validateTerms.
 */
export const NegotiationExtractionSchema = z.object({
  terms: z.array(
    z.object({
      canonicalType: CanonicalTermTypeSchema,
      normalizedValue: z.string().nullable(),
      normalizedNumeric: z.number().nullable(),
      normalizedUnit: NormalizedUnitSchema.nullable(),
      rawValue: z.string(),
      status: NegotiationTermStatusSchema,
      confidence: z.number(),
      evidenceQuote: z.string(),
      sourceLocation: z.string().nullable(),
      /**
       * Typed CRE structured payload. Populated for supported term types;
       * null for unsupported types or when the document lacks enough structure.
       * The raw value here is validated against CREStructuredPayloadSchema in
       * validateTerms before being promoted to a ValidatedNegotiationTerm.
       */
      structuredPayload: z.unknown().nullable(),
    })
  ),
  overallConfidence: z.number(),
});

export const ValidatedNegotiationTermSchema = z.object({
  canonicalType: CanonicalTermTypeSchema,
  normalizedValue: z.string().optional(),
  normalizedNumeric: z.number().optional(),
  normalizedUnit: NormalizedUnitSchema.optional(),
  rawValue: z.string(),
  status: NegotiationTermStatusSchema.exclude(["NOT_MENTIONED"]),
  confidence: z.number().min(0).max(1),
  evidenceQuote: z.string(),
  sourceLocation: z.string().optional(),
  /**
   * Typed CRE structured payload — Zod-validated at the deterministic
   * validation boundary in validateTerms. null for legacy / unsupported terms
   * and whenever the raw payload fails schema validation or canonicalType
   * mismatch is detected. Never causes an otherwise-valid term to be dropped.
   */
  structuredPayload: CREStructuredPayloadSchema.nullable().optional(),
});

export const ExtractTermsOutputSchema = z.object({
  terms: z.array(ValidatedNegotiationTermSchema),
  metadata: z.object({
    model: z.string(),
    extractedAt: z.string().datetime({ offset: true }),
    latencyMs: z.number().nonnegative(),
    extractionConfidence: z.number().min(0).max(1),
    validationFailures: z.number().int().nonnegative(),
  }),
});

export type NegotiationExtraction = z.infer<typeof NegotiationExtractionSchema>;
export type ValidatedNegotiationTerm = z.infer<
  typeof ValidatedNegotiationTermSchema
>;
export type ExtractTermsOutput = z.infer<typeof ExtractTermsOutputSchema>;
export type NegotiationSide = z.infer<typeof NegotiationSideSchema>;
export type CanonicalTermType = z.infer<typeof CanonicalTermTypeSchema>;
export type NegotiationTermStatus = z.infer<
  typeof NegotiationTermStatusSchema
>;
