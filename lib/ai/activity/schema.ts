import { z } from "zod";
import { CREStructuredPayloadSchema } from "@/lib/ai/negotiation/payloads";
import { CanonicalTermTypeSchema } from "@/lib/ai/negotiation/schemas";

export const ACTIVITY_FACT_TYPES = [
  "NEGOTIATION_VALUE",
  "DEADLINE",
  "DOCUMENT_SENT",
  "DOCUMENT_RECEIVED",
  "MEETING",
  "CALL",
  "TOUR",
  "OTHER",
] as const;

export const ACTIVITY_SIDES = ["LANDLORD", "TENANT", "UNKNOWN"] as const;

export const ACTIVITY_ASSERTION_STATUSES = [
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
  "HISTORICAL",
  "UNRESOLVED",
] as const;

export const ActivityFactTypeSchema = z.enum(ACTIVITY_FACT_TYPES);
export const ActivitySideSchema = z.enum(ACTIVITY_SIDES);
export const ActivityAssertionStatusSchema = z.enum(ACTIVITY_ASSERTION_STATUSES);

/**
 * Optional normalized action directive.
 * Action intelligence reads this only when it is already present and valid.
 * Message prose is not parsed into this object, and model extraction does not copy it.
 */
export const STRUCTURED_ACTION_KINDS = [
  "RESPONSE_REQUESTED",
  "FOLLOW_UP_REQUESTED",
  "DOCUMENT_REQUESTED",
  "INFORMATION_REQUESTED",
  "MEETING_REQUESTED",
  "CALL_REQUESTED",
  "COMMITMENT",
  "NEXT_STEP",
  "FULFILLMENT",
  "SCHEDULED",
] as const;

export const STRUCTURED_RESPONSIBLE_SIDES = ["OUR_SIDE", "COUNTERPARTY", "BOTH", "UNKNOWN"] as const;

export const StructuredActionDirectiveSchema = z.object({
  kind: z.enum(STRUCTURED_ACTION_KINDS),
  responsibleSide: z.enum(STRUCTURED_RESPONSIBLE_SIDES),
  responsibleLabel: z.string().nullable(),
  counterpartyLabel: z.string().nullable(),
  dueAt: z.string().nullable(),
  dueText: z.string().nullable(),
  occursAt: z.string().nullable(),
  fulfillsFactId: z.string().nullable(),
}).strict();

export type StructuredActionDirective = z.infer<typeof StructuredActionDirectiveSchema>;

/**
 * Persisted JSON for an activity fact.
 * negotiation reuses the CRE payload contract when the fact is a supported term.
 * It never stores a Person, Company, Property, or NegotiationTerm id.
 */
export const ActivityStructuredPayloadSchema = z.object({
  display: z.string().min(1),
  numeric: z.number().nullable(),
  unit: z.string().nullable(),
  negotiation: CREStructuredPayloadSchema.nullable(),
  action: StructuredActionDirectiveSchema.nullable().optional(),
});

export type ActivityStructuredPayload = z.infer<typeof ActivityStructuredPayloadSchema>;

export const ActivityFactCandidateSchema = z.object({
  factType: ActivityFactTypeSchema,
  canonicalType: CanonicalTermTypeSchema.nullable(),
  side: ActivitySideSchema,
  assertionStatus: ActivityAssertionStatusSchema,
  evidenceQuote: z.string().min(1),
  display: z.string().min(1),
  numeric: z.number().nullable(),
  unit: z.string().nullable(),
  negotiation: CREStructuredPayloadSchema.nullable(),
});

export const ActivityExtractionResultSchema = z.object({
  facts: z.array(ActivityFactCandidateSchema),
});

export type ActivityFactCandidate = z.infer<typeof ActivityFactCandidateSchema>;
