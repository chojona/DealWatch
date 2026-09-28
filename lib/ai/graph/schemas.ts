import { z } from "zod";

export const OBSERVED_ENTITY_TYPES = ["PERSON", "COMPANY", "PROPERTY"] as const;

export const RELATIONSHIP_PREDICATES = [
  "WORKS_AT",
  "OWNS",
  "MANAGES",
  "OCCUPIES",
  "DEVELOPED",
  "LENDS_ON",
  "PARTICIPATES_AS",
  "CONCERNS_PROPERTY",
] as const;

export const PARTICIPATION_ROLES = [
  "TENANT",
  "LANDLORD",
  "SUBTENANT",
  "SUBLANDLORD",
  "TENANT_BROKER",
  "LANDLORD_BROKER",
  "TENANT_BROKERAGE",
  "LANDLORD_BROKERAGE",
  "LENDER",
  "COUNSEL",
  "PROPERTY_MANAGER",
  "GUARANTOR",
  "OTHER",
] as const;

export const AFFILIATION_KINDS = [
  "UNKNOWN",
  "STAFF",
  "BROKER",
  "EXECUTIVE",
  "FOUNDER",
  "COUNSEL",
  "PROPERTY_MANAGER",
] as const;

export const ASSERTION_STRENGTHS = [
  "STATED",
  "HISTORICAL",
  "NEGATED",
  "UNCERTAIN",
] as const;

const nullableText = z.string().nullable();

/**
 * Model-facing entity. Every key is required so Structured Outputs stays strict.
 * Application validation may still reject an item after parsing.
 */
export const GraphEntityModelSchema = z.object({
  observationKey: z.string(),
  observedType: z.enum(OBSERVED_ENTITY_TYPES),
  observedName: z.string(),
  observedTitle: nullableText,
  observedEmail: nullableText,
  observedPhone: nullableText,
  observedLinkedIn: nullableText,
  observedWebsite: nullableText,
  observedDomain: nullableText,
  observedAddress: nullableText,
  evidenceQuote: z.string(),
  extractionConfidence: z.number().min(0).max(1).nullable(),
});

export const GraphRelationshipModelSchema = z.object({
  subjectObservationKey: z.string(),
  predicate: z.enum(RELATIONSHIP_PREDICATES),
  objectObservationKey: z.string().nullable(),
  principalObservationKey: z.string().nullable(),
  participationRole: z.enum(PARTICIPATION_ROLES).nullable(),
  roleLabel: nullableText,
  affiliationKind: z.enum(AFFILIATION_KINDS).nullable(),
  statedTitle: nullableText,
  statedValidFrom: nullableText,
  statedValidTo: nullableText,
  assertionStrength: z.enum(ASSERTION_STRENGTHS),
  evidenceQuote: z.string(),
  extractionConfidence: z.number().min(0).max(1).nullable(),
});

export const GraphExtractionModelSchema = z.object({
  entities: z.array(GraphEntityModelSchema),
  relationships: z.array(GraphRelationshipModelSchema),
});

export type GraphEntityModel = z.infer<typeof GraphEntityModelSchema>;
export type GraphRelationshipModel = z.infer<typeof GraphRelationshipModelSchema>;
export type GraphExtractionModel = z.infer<typeof GraphExtractionModelSchema>;
