/**
 * Formal review sits between immutable NegotiationTerm extraction and the
 * existing resolvers. It does not write NegotiationTerm and it does not read
 * ActivityFact. Rejected extractions drop out of the resolver input. Corrected
 * extractions are projected onto a copy. Accepted and unreviewed terms pass
 * through unchanged.
 */

import { Prisma } from "@prisma/client";
import {
  parseStructuredPayload,
  validateStructuredPayload,
  type BaseRentPayload,
  type CREStructuredPayload,
} from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import { comparableNegotiationValue } from "@/lib/deals/reconciliation/value";
import { formatStructuredPayload } from "@/lib/negotiation/intelligence/formatting";
import type { TermWithPayload } from "@/lib/negotiation/resolveStructuredState";
import type { NegotiationRoundRecord } from "@/lib/negotiation/types";

export const FORMAL_REVIEW_STATES = ["ACCEPTED", "CORRECTED", "REJECTED"] as const;
export type FormalReviewState = (typeof FORMAL_REVIEW_STATES)[number];

export interface FormalReviewSnapshot {
  state: FormalReviewState;
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: string | null;
  rawValue: string | null;
  structuredPayload: unknown;
  note: string | null;
  reviewedAt: Date;
  actor: "MANUAL_REVIEW" | "SYSTEM";
  reviewerUserId: string | null;
}

export interface FormalCommercialFields {
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: string | null;
  rawValue: string;
  structuredPayload: CREStructuredPayload | null;
}

export type FormalCorrectionMode = "BASE_RENT_SIMPLE" | "LEGACY" | "STRUCTURED";

type RoundLike = Omit<NegotiationRoundRecord, "terms"> & { terms: TermWithPayload[] };

const MONEY_UNITS = new Set(["USD", "USD_PER_RSF_YEAR"]);

export function formalCorrectionMode(term: {
  canonicalType: string;
  structuredPayload: unknown;
}): FormalCorrectionMode {
  const payload = readPayload(term.canonicalType, term.structuredPayload);
  if (!payload) return "LEGACY";
  if (payload.termType === "BASE_RENT" && payload.rent.kind === "simple") return "BASE_RENT_SIMPLE";
  return "STRUCTURED";
}

export function effectiveFormalTerm<T extends TermWithPayload>(
  term: T,
  review: FormalReviewSnapshot | null | undefined
): T | null {
  if (!review || review.state === "ACCEPTED") return term;
  if (review.state === "REJECTED") return null;
  const parsed = parseStructuredPayload(review.structuredPayload, term.canonicalType);
  return {
    ...term,
    normalizedValue: review.normalizedValue,
    normalizedNumeric: review.normalizedNumeric,
    normalizedUnit: review.normalizedUnit,
    rawValue: review.rawValue?.trim() || term.rawValue,
    structuredPayload: parsed,
  };
}

export function projectEffectiveRounds<T extends RoundLike>(
  rounds: T[],
  reviews: ReadonlyMap<string, FormalReviewSnapshot>
): T[] {
  return rounds.map((round) => ({
    ...round,
    terms: round.terms.flatMap((term) => {
      const effective = effectiveFormalTerm(term, reviews.get(term.id));
      return effective ? [effective] : [];
    }),
  }));
}

export function commercialFieldsFromPayload(
  payload: CREStructuredPayload,
  rawValue: string
): FormalCommercialFields {
  const summary = formatStructuredPayload(payload).summary;
  const comparable = comparableNegotiationValue({
    canonicalType: payload.termType,
    structuredPayload: payload,
    display: summary,
  });
  return {
    normalizedValue: summary,
    normalizedNumeric: comparable?.numeric ?? null,
    normalizedUnit: comparable?.unit ?? null,
    rawValue: rawValue.trim() || summary,
    structuredPayload: payload,
  };
}

export function resolveFormalCorrection(
  term: {
    canonicalType: CanonicalTermType;
    structuredPayload: unknown;
  },
  input: {
    rawValue?: string | null;
    normalizedValue?: string | null;
    normalizedNumeric?: number | null;
    normalizedUnit?: string | null;
    structuredPayload?: unknown;
    amountPerRSFYear?: number | null;
  }
): FormalCommercialFields {
  const stored = readPayload(term.canonicalType, term.structuredPayload);
  const submittedPayload = input.structuredPayload == null
    ? null
    : validateSubmittedPayload(term.canonicalType, input.structuredPayload);

  if (stored && input.amountPerRSFYear != null && submittedPayload?.termType === "BASE_RENT" && submittedPayload.rent.kind === "simple") {
    if (submittedPayload.rent.amountPerRSFYear !== input.amountPerRSFYear) {
      throw new FormalCorrectionError("The corrected rent amount does not match the structured value.");
    }
  }

  let payload = submittedPayload;
  if (!payload && input.amountPerRSFYear != null) {
    if (!stored || stored.termType !== "BASE_RENT" || stored.rent.kind !== "simple") {
      throw new FormalCorrectionError("A rent amount can correct only a simple base-rent extraction.");
    }
    if (!Number.isFinite(input.amountPerRSFYear) || input.amountPerRSFYear <= 0) {
      throw new FormalCorrectionError("Corrected base rent must be a positive amount.");
    }
    payload = validateStructuredPayload({
      ...stored,
      rent: { ...stored.rent, amountPerRSFYear: input.amountPerRSFYear },
    } as BaseRentPayload);
  }

  if (payload) {
    const rawValue = input.rawValue?.trim() || formatStructuredPayload(payload).summary;
    const derived = commercialFieldsFromPayload(payload, rawValue);
    if (
      input.normalizedNumeric != null &&
      derived.normalizedNumeric != null &&
      Math.abs(input.normalizedNumeric - derived.normalizedNumeric) > 1e-6
    ) {
      throw new FormalCorrectionError("The corrected number does not match the structured value.");
    }
    if (input.normalizedUnit && derived.normalizedUnit && input.normalizedUnit !== derived.normalizedUnit) {
      throw new FormalCorrectionError("The corrected unit does not match the structured value.");
    }
    return derived;
  }

  if (stored) {
    throw new FormalCorrectionError("This extraction has a structured value. Correct that structured value.");
  }
  if (input.structuredPayload != null || input.amountPerRSFYear != null) {
    throw new FormalCorrectionError("This extraction has no structured value. Correct the stored commercial fields.");
  }
  return legacyCommercialFields(input);
}

export class FormalCorrectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormalCorrectionError";
  }
}

export function formalReviewWriteData(fields: FormalCommercialFields | null): {
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: string | null;
  rawValue: string | null;
  structuredPayload: Prisma.InputJsonValue | typeof Prisma.JsonNull;
} {
  if (!fields) {
    return {
      normalizedValue: null,
      normalizedNumeric: null,
      normalizedUnit: null,
      rawValue: null,
      structuredPayload: Prisma.JsonNull,
    };
  }
  return {
    normalizedValue: fields.normalizedValue,
    normalizedNumeric: fields.normalizedNumeric,
    normalizedUnit: fields.normalizedUnit,
    rawValue: fields.rawValue,
    structuredPayload: fields.structuredPayload
      ? (fields.structuredPayload as Prisma.InputJsonValue)
      : Prisma.JsonNull,
  };
}

function legacyCommercialFields(input: {
  rawValue?: string | null;
  normalizedValue?: string | null;
  normalizedNumeric?: number | null;
  normalizedUnit?: string | null;
}): FormalCommercialFields {
  const rawValue = input.rawValue?.trim() ?? "";
  const normalizedValue = input.normalizedValue?.trim() || rawValue || null;
  if (!rawValue && !normalizedValue) {
    throw new FormalCorrectionError("A corrected formal value needs the reviewed commercial text.");
  }
  const numeric = input.normalizedNumeric ?? null;
  const unit = input.normalizedUnit?.trim() || null;
  if (numeric != null && !Number.isFinite(numeric)) {
    throw new FormalCorrectionError("The corrected number is not finite.");
  }
  if (numeric != null && !unit) {
    throw new FormalCorrectionError("A numeric correction needs a unit.");
  }
  if (unit && numeric == null) {
    throw new FormalCorrectionError("A unit correction needs a number.");
  }
  if (numeric != null && numeric <= 0 && unit && MONEY_UNITS.has(unit)) {
    throw new FormalCorrectionError("A corrected money amount must be positive.");
  }
  return {
    normalizedValue,
    normalizedNumeric: numeric,
    normalizedUnit: unit,
    rawValue: rawValue || normalizedValue!,
    structuredPayload: null,
  };
}

function readPayload(canonicalType: string, value: unknown): CREStructuredPayload | null {
  return parseStructuredPayload(value, canonicalType as CanonicalTermType);
}

function validateSubmittedPayload(canonicalType: CanonicalTermType, value: unknown): CREStructuredPayload {
  let parsed: CREStructuredPayload;
  try {
    parsed = validateStructuredPayload(value as CREStructuredPayload);
  } catch {
    throw new FormalCorrectionError("The corrected structured value is invalid.");
  }
  if (parsed.termType !== canonicalType) {
    throw new FormalCorrectionError("The corrected value is for a different term type.");
  }
  return parsed;
}
