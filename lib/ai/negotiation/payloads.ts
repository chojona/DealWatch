/**
 * lib/ai/negotiation/payloads.ts
 *
 * Typed CRE structured payloads for NegotiationTerm.structuredPayload.
 *
 * ARCHITECTURAL CONSTRAINT (see artifacts/cre-ontology-design.md §2.1):
 * These types describe only the CRE semantics of a negotiation observation —
 * amounts, periods, schedules, rights, conditions, and their provenance within
 * the observation layer. They must never embed Person, Company, Property, Deal,
 * Document, or knowledge-graph entity references.
 *
 * Free-text fields (conditions, descriptions, applicableSpace, trigger) may
 * reproduce document language that mentions party names. Those are verbatim
 * document strings — they are NOT stable entity references.
 *
 * ObservationRef.observationId references a NegotiationTerm row in the
 * observation layer. It is a provenance cross-reference within that layer, not
 * a reference to a Person, Company, or Property entity.
 *
 * BACKWARD COMPATIBILITY:
 * All existing NegotiationTerm rows have structuredPayload = null. All existing
 * code paths that read normalizedNumeric / normalizedValue / normalizedUnit
 * continue to work unchanged. Nothing in this file modifies extraction logic,
 * state resolution, prompts, eval fixtures, or UI.
 */

import { z } from "zod";
import type { CanonicalTermType } from "./schemas";

// ─── Shared primitives ────────────────────────────────────────────────────────

/**
 * Reference back to a source NegotiationTerm observation in the observation
 * layer. Enables provenance drill-down from any structured field to:
 *   - the exact evidenceQuote
 *   - the source document and round
 *   - the side (TENANT / LANDLORD)
 *   - the confidence score
 *
 * This is a cross-reference within the observation layer.
 * It is NOT a reference to a Person, Company, Property, or Deal entity.
 */
export const ObservationRefSchema = z.object({
  /** NegotiationTerm.id of the source observation. */
  observationId: z.string().min(1),
  /**
   * Verbatim substring of the source evidenceQuote that supports this
   * particular field, when the reference can be narrowed below the full quote.
   */
  evidenceSpan: z.string().optional(),
});
export type ObservationRef = z.infer<typeof ObservationRefSchema>;

export const RentStructureSchema = z.enum([
  "NNN",
  "GROSS",
  "MODIFIED_GROSS",
  "BASE_YEAR",
  "OTHER",
]);
export type RentStructure = z.infer<typeof RentStructureSchema>;

export const PricingMethodSchema = z.enum([
  "FAIR_MARKET_RENT",
  "FIXED_RATE",
  "PERCENT_OF_THEN_CURRENT",
  "LESSER_OF_FMR_AND_FIXED",
  "OTHER",
]);
export type PricingMethod = z.infer<typeof PricingMethodSchema>;

const AmountPerRSFYearSchema = z.object({
  amount: z.number().positive(),
  unit: z.literal("USD_PER_RSF_YEAR"),
});
export type AmountPerRSFYear = z.infer<typeof AmountPerRSFYearSchema>;

const TotalUSDSchema = z.object({
  amount: z.number().positive(),
  unit: z.literal("USD"),
});
export type TotalUSD = z.infer<typeof TotalUSDSchema>;

/**
 * A monetary amount, either per-RSF-per-year (the canonical CRE unit for
 * rents and TI allowances) or as a total USD amount.
 */
export const MonetaryAmountSchema = z.discriminatedUnion("unit", [
  AmountPerRSFYearSchema,
  TotalUSDSchema,
]);
export type MonetaryAmount = z.infer<typeof MonetaryAmountSchema>;

// ─── EscalationSpec (recursive discriminated union) ──────────────────────────

/**
 * Describes how rent escalates. The "greater_of" variant is recursive.
 * z.lazy is required to handle the self-reference; the schema is resolved
 * at first parse time, by which point all const declarations are initialized.
 */
export type EscalationSpec =
  | { kind: "percent"; pct: number }
  | { kind: "fixed_amount_per_rsf"; amount: number }
  | { kind: "cpi"; capPct?: number; floorPct?: number }
  | { kind: "greater_of"; options: EscalationSpec[] }
  | { kind: "other"; description: string };

export const EscalationSpecSchema: z.ZodType<EscalationSpec> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("percent"), pct: z.number() }),
    z.object({
      kind: z.literal("fixed_amount_per_rsf"),
      amount: z.number().positive(),
    }),
    z.object({
      kind: z.literal("cpi"),
      capPct: z.number().optional(),
      floorPct: z.number().optional(),
    }),
    z.object({
      kind: z.literal("greater_of"),
      options: z.array(EscalationSpecSchema).min(2),
    }),
    z.object({ kind: z.literal("other"), description: z.string().min(1) }),
  ])
);

// ─── BASE_RENT ────────────────────────────────────────────────────────────────

/** One step in a stepped rent schedule. */
export const RentStepSchema = z.object({
  /** 1-based month offset from lease commencement (inclusive start). */
  startMonth: z.number().int().positive(),
  /** 1-based month offset, inclusive end. Must be ≥ startMonth. */
  endMonth: z.number().int().positive(),
  amountPerRSFYear: z.number().positive(),
  /**
   * Provenance pointer back to the source NegotiationTerm observation for
   * this step. Enables per-step evidence drill-down.
   */
  observationRef: ObservationRefSchema,
});
export type RentStep = z.infer<typeof RentStepSchema>;

/** A single flat rent rate throughout the lease. */
export const SimpleBaseRentSchema = z.object({
  kind: z.literal("simple"),
  amountPerRSFYear: z.number().positive(),
  rentStructure: RentStructureSchema.optional(),
});
export type SimpleBaseRent = z.infer<typeof SimpleBaseRentSchema>;

/** A rent schedule with multiple distinct rate periods. Requires ≥ 2 steps. */
export const SteppedBaseRentSchema = z.object({
  kind: z.literal("stepped"),
  steps: z.array(RentStepSchema).min(2),
  rentStructure: RentStructureSchema.optional(),
});
export type SteppedBaseRent = z.infer<typeof SteppedBaseRentSchema>;

export const BaseRentPayloadSchema = z.object({
  termType: z.literal("BASE_RENT"),
  rent: z.discriminatedUnion("kind", [SimpleBaseRentSchema, SteppedBaseRentSchema]),
  /**
   * Escalation stated in the same clause as the rent. A separate
   * ANNUAL_ESCALATION observation may carry the same information.
   */
  inlineEscalation: EscalationSpecSchema.optional(),
});
export type BaseRentPayload = z.infer<typeof BaseRentPayloadSchema>;

// ─── FREE_RENT / ABATEMENT ───────────────────────────────────────────────────

/** A single abatement period within an irregular free-rent schedule. */
export const AbatementPeriodSchema = z.object({
  /** 1-based month from commencement (inclusive start). */
  startMonth: z.number().int().positive(),
  /** 1-based month, inclusive end. Must be ≥ startMonth. */
  endMonth: z.number().int().positive(),
  abatementType: z.enum(["FULL", "PARTIAL"]),
  /** Required when abatementType is "PARTIAL". Range 0–100. */
  partialPct: z.number().min(0).max(100).optional(),
  observationRef: ObservationRefSchema,
});
export type AbatementPeriod = z.infer<typeof AbatementPeriodSchema>;

/** A single contiguous block of free rent (the common case). */
export const ContiguousFreeRentSchema = z.object({
  kind: z.literal("contiguous"),
  months: z.number().int().positive(),
  abatementType: z.enum(["FULL", "PARTIAL"]),
  partialPct: z.number().min(0).max(100).optional(),
});
export type ContiguousFreeRent = z.infer<typeof ContiguousFreeRentSchema>;

/**
 * Non-contiguous abatement periods (e.g., months 1–3 and months 7–9).
 * Fixes the n09-irregular-free-rent benchmark failure where a single
 * normalizedNumeric integer could not represent split periods.
 */
export const IrregularFreeRentSchema = z.object({
  kind: z.literal("irregular"),
  periods: z.array(AbatementPeriodSchema).min(1),
  /**
   * Sum of (endMonth − startMonth + 1) for FULL periods, computed from
   * the periods array. Stored here so downstream economics can use the
   * total without recomputing; marked as derived — do not compare against
   * an observed single normalizedNumeric.
   */
  equivalentFullMonths: z.number().nonnegative(),
});
export type IrregularFreeRent = z.infer<typeof IrregularFreeRentSchema>;

export const FreeRentPayloadSchema = z.object({
  termType: z.literal("FREE_RENT"),
  abatement: z.discriminatedUnion("kind", [
    ContiguousFreeRentSchema,
    IrregularFreeRentSchema,
  ]),
  /**
   * Whether abatement covers base rent only or all charges.
   * null = not stated in the document.
   */
  scope: z.enum(["BASE_RENT_ONLY", "ALL_CHARGES"]).nullable(),
});
export type FreeRentPayload = z.infer<typeof FreeRentPayloadSchema>;

// ─── TI_ALLOWANCE ────────────────────────────────────────────────────────────

export const TIAllowancePayloadSchema = z.object({
  termType: z.literal("TI_ALLOWANCE"),
  amount: MonetaryAmountSchema,
  /**
   * Disbursement conditions stated in the document.
   * These are document-extracted strings. Party names that appear
   * (e.g., "subject to Landlord approval") are text — not entity references.
   */
  conditions: z.array(z.string()),
  /**
   * Deadline by which allowance must be drawn, as stated in the document:
   * an ISO-8601 date string or a relative description such as
   * "within 12 months of commencement". null = not stated.
   */
  drawDeadline: z.string().nullable(),
  /** What happens to unused allowance. null = not stated. */
  unusedConversion: z.enum(["FREE_RENT", "RENT_CREDIT", "FORFEITED"]).nullable(),
});
export type TIAllowancePayload = z.infer<typeof TIAllowancePayloadSchema>;

// ─── RENEWAL_OPTIONS ─────────────────────────────────────────────────────────

/** One renewal or extension option in the options package. */
export const RenewalOptionSchema = z.object({
  /** 1-based option sequence number. */
  optionNumber: z.number().int().positive(),
  durationMonths: z.number().int().positive(),
  pricingMethod: PricingMethodSchema,
  /**
   * For FIXED_RATE: the fixed $/RSF/yr rate.
   * For PERCENT_OF_THEN_CURRENT: the percentage (e.g., 100 for 100% of FMR).
   */
  pricingValue: z.number().optional(),
  /** Months before lease expiry when the option window opens. */
  noticeEarliestMonths: z.number().int().positive().optional(),
  /** Months before lease expiry when the option window closes (deadline). */
  noticeLatestMonths: z.number().int().positive().optional(),
  /**
   * Eligibility conditions. Document-extracted strings (e.g., "not in
   * default at time of exercise"). Not entity references.
   */
  conditions: z.array(z.string()),
});
export type RenewalOption = z.infer<typeof RenewalOptionSchema>;

export const RenewalOptionsPayloadSchema = z.object({
  termType: z.literal("RENEWAL_OPTIONS"),
  options: z.array(RenewalOptionSchema).min(1),
  /** Whether the options are personal to the named tenant (non-assignable). null = not stated. */
  personal: z.boolean().nullable(),
});
export type RenewalOptionsPayload = z.infer<typeof RenewalOptionsPayloadSchema>;

// ─── TERMINATION_RIGHTS ──────────────────────────────────────────────────────

/** Fee structure for a termination right. */
export const TerminationFeeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("unamortized_costs"),
    description: z.string().min(1),
  }),
  z.object({ kind: z.literal("fixed_amount"), amount: TotalUSDSchema }),
  z.object({ kind: z.literal("months_rent"), months: z.number().positive() }),
]);
export type TerminationFee = z.infer<typeof TerminationFeeSchema>;

export const TerminationRightSchema = z.object({
  /** Earliest lease year (1-based) when the right may first be exercised. */
  eligibleAfterYear: z.number().int().positive().nullable(),
  /** Earliest lease month (1-based) when the right may first be exercised. */
  eligibleAfterMonth: z.number().int().positive().nullable(),
  /** Required notice period in months. */
  noticeMonths: z.number().int().positive().nullable(),
  terminationFee: TerminationFeeSchema.nullable(),
  /**
   * Conditions on exercise. Document-extracted strings.
   * Not entity references.
   */
  conditions: z.array(z.string()),
});
export type TerminationRight = z.infer<typeof TerminationRightSchema>;

export const TerminationRightsPayloadSchema = z.object({
  termType: z.literal("TERMINATION_RIGHTS"),
  /**
   * null when the termination right has been rejected (check parent
   * NegotiationTerm.status === "REJECTED") or is unavailable.
   */
  right: TerminationRightSchema.nullable(),
});
export type TerminationRightsPayload = z.infer<
  typeof TerminationRightsPayloadSchema
>;

// ─── OPERATING_EXPENSES ──────────────────────────────────────────────────────

export const OperatingExpensesPayloadSchema = z.object({
  termType: z.literal("OPERATING_EXPENSES"),
  structure: z.enum(["GROSS", "NNN", "MODIFIED_GROSS", "BASE_YEAR", "OTHER"]),
  /** Calendar year used for expense reconciliation. null = not applicable / not stated. */
  baseYear: z.number().int().nullable(),
  /** Annual percentage cap on controllable expense increases. null = not stated. */
  controllableCapPct: z.number().positive().nullable(),
  /**
   * Whether taxes and insurance are explicitly excluded from the cap.
   * null = not stated.
   */
  taxesInsuranceUncapped: z.boolean().nullable(),
  /**
   * Specific expense categories excluded from pass-through.
   * Document-extracted strings.
   */
  exclusions: z.array(z.string()),
  /** Management or admin fee gross-up percentage. null = not stated. */
  managementFeePct: z.number().positive().nullable(),
});
export type OperatingExpensesPayload = z.infer<
  typeof OperatingExpensesPayloadSchema
>;

// ─── ANNUAL_ESCALATION ───────────────────────────────────────────────────────

export const AnnualEscalationPayloadSchema = z.object({
  termType: z.literal("ANNUAL_ESCALATION"),
  escalation: EscalationSpecSchema,
  /**
   * Lease month at which the first escalation takes effect.
   * null = not stated; assume month 13 (start of year 2) by CRE convention.
   */
  firstEscalationMonth: z.number().int().positive().nullable(),
  frequency: z.enum(["ANNUAL", "OTHER"]),
});
export type AnnualEscalationPayload = z.infer<
  typeof AnnualEscalationPayloadSchema
>;

// ─── PARKING ─────────────────────────────────────────────────────────────────

export const ParkingPayloadSchema = z.object({
  termType: z.literal("PARKING"),
  spacesCount: z.number().int().positive().nullable(),
  /**
   * Ratio expressed as a string (e.g., "3 per 1,000 RSF").
   * null = not stated as a ratio.
   */
  spacesRatio: z.string().nullable(),
  ratePerSpacePerMonth: z.number().nonnegative().nullable(),
  rateType: z.enum(["MARKET", "FIXED", "FREE", "PREVAILING"]).nullable(),
  /** Whether spaces are reserved (dedicated). null = not stated. */
  reserved: z.boolean().nullable(),
  /** Conditions stated in the document. Not entity references. */
  conditions: z.array(z.string()),
});
export type ParkingPayload = z.infer<typeof ParkingPayloadSchema>;

// ─── COMMENCEMENT_DATE ───────────────────────────────────────────────────────

export const CommencementDatePayloadSchema = z.object({
  termType: z.literal("COMMENCEMENT_DATE"),
  /**
   * Fixed calendar date in YYYY-MM-DD format.
   * null when the date is conditional or not yet determined.
   */
  fixedDate: z.string().nullable(),
  /**
   * Conditions that must be met before the date is confirmed (e.g., "subject
   * to existing tenant surrender"). Document-extracted strings.
   * Party names that appear are text — not entity references.
   */
  conditions: z.array(z.string()),
  /** Status of a delivery guaranty from the landlord, if mentioned. */
  deliveryGuaranty: z.enum([
    "AGREED",
    "PROPOSED",
    "REJECTED",
    "NOT_MENTIONED",
  ]),
});
export type CommencementDatePayload = z.infer<
  typeof CommencementDatePayloadSchema
>;

// ─── EXPANSION_RIGHTS / ROFO / ROFR ─────────────────────────────────────────

export const ExpansionRightsPayloadSchema = z.object({
  termType: z.literal("EXPANSION_RIGHTS"),
  rightKind: z.enum(["EXPANSION", "ROFO", "ROFR", "MUST_TAKE", "OTHER"]),
  /**
   * Description of the space the right applies to as stated in the document.
   * This is a document-extracted string, not a Property entity reference.
   * null = not specified.
   */
  applicableSpace: z.string().nullable(),
  /**
   * Event that triggers the right (e.g., "upon availability of contiguous
   * space"). Document-extracted text; not an entity reference.
   * null = not specified.
   */
  trigger: z.string().nullable(),
  noticeMonths: z.number().int().positive().nullable(),
  pricingMethod: PricingMethodSchema.nullable(),
  /** Conditions on exercise. Document-extracted strings. Not entity refs. */
  conditions: z.array(z.string()),
});
export type ExpansionRightsPayload = z.infer<typeof ExpansionRightsPayloadSchema>;

// ─── Master discriminated union ───────────────────────────────────────────────

/**
 * Master discriminated union of all typed CRE structured payloads.
 *
 * Discriminated on "termType", which always equals the parent
 * NegotiationTerm.canonicalType. The two fields must never disagree —
 * use canonicalTypeMatchesPayload() to enforce this invariant.
 *
 * Compatible with the future DealWatch knowledge graph: none of these
 * types embed Person, Company, Property, Deal, or entity-graph pointers.
 */
export const CREStructuredPayloadSchema = z.discriminatedUnion("termType", [
  BaseRentPayloadSchema,
  FreeRentPayloadSchema,
  TIAllowancePayloadSchema,
  RenewalOptionsPayloadSchema,
  TerminationRightsPayloadSchema,
  OperatingExpensesPayloadSchema,
  AnnualEscalationPayloadSchema,
  ParkingPayloadSchema,
  CommencementDatePayloadSchema,
  ExpansionRightsPayloadSchema,
]);

export type CREStructuredPayload = z.infer<typeof CREStructuredPayloadSchema>;

/**
 * The subset of CanonicalTermType values that have a CREStructuredPayload
 * shape. Equals CREStructuredPayload["termType"].
 *
 * Term types absent from this set — PREMISES_RSF, LEASE_TERM,
 * SECURITY_DEPOSIT, RENT_STRUCTURE, DELIVERY_CONDITION,
 * ASSIGNMENT_SUBLETTING — always have structuredPayload = null and continue
 * to be fully represented by their flat normalizedNumeric / normalizedValue
 * fields.
 */
export type CRETermType = CREStructuredPayload["termType"];

/**
 * Set of all CanonicalTermType values that support a CREStructuredPayload.
 * Used by supportsStructuredPayload() for a type-safe narrowing check.
 */
export const STRUCTURED_TERM_TYPES: ReadonlySet<CanonicalTermType> = new Set<
  CanonicalTermType
>([
  "BASE_RENT",
  "FREE_RENT",
  "TI_ALLOWANCE",
  "RENEWAL_OPTIONS",
  "TERMINATION_RIGHTS",
  "OPERATING_EXPENSES",
  "ANNUAL_ESCALATION",
  "PARKING",
  "COMMENCEMENT_DATE",
  "EXPANSION_RIGHTS",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Type-guard that returns true when the given CanonicalTermType supports a
 * CREStructuredPayload. Term types not in the set always have
 * structuredPayload = null.
 *
 * @example
 * if (supportsStructuredPayload(term.canonicalType)) {
 *   const payload = parseStructuredPayload(term.structuredPayload, term.canonicalType);
 * }
 */
export function supportsStructuredPayload(
  canonicalType: CanonicalTermType
): canonicalType is CRETermType {
  return STRUCTURED_TERM_TYPES.has(canonicalType);
}

/**
 * Returns true when payload.termType matches the canonicalType of its parent
 * NegotiationTerm row. Enforces the invariant that canonicalType and the
 * payload's own type discriminant never silently disagree.
 *
 * A mismatch indicates either a bug in the write path (wrong payload stored
 * for the row) or data corruption, and must be treated as an error.
 */
export function canonicalTypeMatchesPayload(
  canonicalType: CanonicalTermType,
  payload: CREStructuredPayload
): boolean {
  return payload.termType === canonicalType;
}

/**
 * Safely parses a raw value (as returned by Prisma for a Json? column) into
 * a typed CREStructuredPayload.
 *
 * Returns null when:
 * - raw is null or undefined (legacy row — backward-compatible path)
 * - Zod parsing fails (unknown shape or corrupt data)
 * - canonicalType is supplied and does not match payload.termType
 *
 * Never throws. Use parseStructuredPayloadOrThrow() for strict error handling.
 */
export function parseStructuredPayload(
  raw: unknown,
  canonicalType?: CanonicalTermType
): CREStructuredPayload | null {
  if (raw == null) return null;

  const result = CREStructuredPayloadSchema.safeParse(raw);
  if (!result.success) return null;

  if (
    canonicalType !== undefined &&
    !canonicalTypeMatchesPayload(canonicalType, result.data)
  ) {
    return null;
  }

  return result.data;
}

/** Thrown by parseStructuredPayloadOrThrow() on parse failure or type mismatch. */
export class StructuredPayloadParseError extends Error {
  constructor(
    message: string,
    public readonly issues?: z.ZodIssue[]
  ) {
    super(message);
    this.name = "StructuredPayloadParseError";
  }
}

/**
 * Parses a raw Prisma Json? value into a typed CREStructuredPayload.
 *
 * Returns null only when raw is null or undefined (legitimate absent payload).
 * Throws StructuredPayloadParseError on:
 * - Zod validation failure (unknown shape, wrong types, etc.)
 * - canonicalType mismatch (termType field disagrees with canonicalType)
 *
 * Use parseStructuredPayload() for a non-throwing safe version.
 */
export function parseStructuredPayloadOrThrow(
  raw: unknown,
  canonicalType?: CanonicalTermType
): CREStructuredPayload | null {
  if (raw == null) return null;

  const result = CREStructuredPayloadSchema.safeParse(raw);
  if (!result.success) {
    throw new StructuredPayloadParseError(
      "Failed to parse structuredPayload: " +
        result.error.issues.map((i) => i.message).join("; "),
      result.error.issues
    );
  }

  if (
    canonicalType !== undefined &&
    !canonicalTypeMatchesPayload(canonicalType, result.data)
  ) {
    throw new StructuredPayloadParseError(
      `structuredPayload termType "${result.data.termType}" does not match ` +
        `canonicalType "${canonicalType}"`
    );
  }

  return result.data;
}

/**
 * Validates a CREStructuredPayload through the full Zod schema and returns
 * the parsed (unknown-field-stripped) result. Intended as a pre-write
 * validation gate before storing to the database.
 *
 * Throws ZodError if the payload is invalid.
 *
 * At the Prisma call site, cast the return value:
 *   structuredPayload: validateStructuredPayload(payload) as Prisma.InputJsonValue
 */
export function validateStructuredPayload(
  payload: CREStructuredPayload
): CREStructuredPayload {
  return CREStructuredPayloadSchema.parse(payload);
}
