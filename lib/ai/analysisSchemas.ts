import { z } from "zod";

export const DealStageSchema = z.enum([
  "Prospect",
  "Market Survey",
  "Tour",
  "LOI",
  "Negotiation",
  "Lease Execution",
  "Closed",
]);

export const EventTypeSchema = z.enum([
  "REQUIREMENTS_CONFIRMED",
  "PROPOSAL_SENT",
  "COUNTER_RECEIVED",
  "LOI_SUBMITTED",
  "LEASE_EXECUTED",
  "TOUR_SCHEDULED",
  "COMMITMENT_MADE",
  "DEADLINE_SET",
  "FOLLOW_UP_SENT",
  "BOARD_MEETING_SCHEDULED",
  "CLIENT_CONFIRMED",
  "OTHER",
]);

export const ObligationKindSchema = z.enum([
  "COMMITMENT",
  "REQUEST",
  "CONDITIONAL_FOLLOW_UP",
]);

export const AccountablePartySchema = z.enum([
  "OUR_SIDE",
  "COUNTERPARTY",
  "UNKNOWN",
]);

/**
 * This is the model-facing schema. Every property is required because OpenAI
 * Structured Outputs supports nullable values more reliably than optional ones.
 * It intentionally describes candidate facts, not final application state.
 */
export const ThreadExtractionSchema = z.object({
  deal: z.object({
    company: z.string().nullable(),
    property: z.string().nullable(),
    stage: DealStageSchema.nullable(),
    brokerName: z.string().nullable(),
    confidence: z.number(),
    evidenceQuote: z.string().nullable(),
  }),
  events: z.array(
    z.object({
      id: z.string(),
      type: EventTypeSchema,
      description: z.string(),
      occurredAt: z.string().nullable(),
      confidence: z.number(),
      evidenceQuote: z.string(),
    })
  ),
  obligations: z.array(
    z.object({
      id: z.string(),
      owner: z.string(),
      counterparty: z.string().nullable(),
      description: z.string(),
      dueAt: z.string().nullable(),
      messageAt: z.string().nullable(),
      kind: ObligationKindSchema,
      accountableParty: AccountablePartySchema,
      confidence: z.number(),
      evidenceQuote: z.string(),
    })
  ),
  obligationUpdates: z.array(
    z.object({
      targetObligationId: z.string(),
      type: z.enum(["COMPLETES", "SUPERSEDES"]),
      replacementObligationId: z.string().nullable(),
      occurredAt: z.string().nullable(),
      confidence: z.number(),
      evidenceQuote: z.string(),
    })
  ),
  overallConfidence: z.number(),
});

export type ThreadExtraction = z.infer<typeof ThreadExtractionSchema>;

export const ObligationStatusSchema = z.enum([
  "OPEN",
  "COMPLETED",
  "OVERDUE",
  "WAITING",
]);

export const UrgencySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const AnalyzeThreadOutputSchema = z.object({
  deal: z.object({
    company: z.string().optional(),
    property: z.string().optional(),
    stage: DealStageSchema.optional(),
    brokerName: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    evidenceQuote: z.string().optional(),
  }),
  events: z.array(
    z.object({
      type: EventTypeSchema,
      description: z.string(),
      occurredAt: z.string().datetime({ offset: true }).optional(),
      confidence: z.number().min(0).max(1),
      evidenceQuote: z.string(),
    })
  ),
  obligations: z.array(
    z.object({
      owner: z.string(),
      counterparty: z.string().optional(),
      description: z.string(),
      dueAt: z.string().datetime({ offset: true }).optional(),
      status: ObligationStatusSchema,
      kind: ObligationKindSchema.optional(),
      accountableParty: AccountablePartySchema.optional(),
      confidence: z.number().min(0).max(1),
      evidenceQuote: z.string(),
      statusEvidenceQuote: z.string().optional(),
    })
  ),
  nextAction: z
    .object({
      description: z.string(),
      owner: z.string(),
      urgency: UrgencySchema,
      confidence: z.number().min(0).max(1).optional(),
      evidenceQuote: z.string().optional(),
    })
    .optional(),
  metadata: z.object({
    model: z.string(),
    analyzedAt: z.string().datetime({ offset: true }),
    latencyMs: z.number().nonnegative(),
    extractionConfidence: z.number().min(0).max(1),
    detectedEvents: z.number().int().nonnegative(),
    detectedObligations: z.number().int().nonnegative(),
    validationFailures: z.number().int().nonnegative(),
  }),
});
