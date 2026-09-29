import { parseStructuredPayload } from "@/lib/ai/negotiation/payloads";
import { CanonicalTermTypeSchema } from "@/lib/ai/negotiation/schemas";

export interface ComparableDealValue {
  numeric: number;
  unit: string;
  display: string;
}

/**
 * Produces the same conservative scalar value used by reconciliation.
 * Complex schedules and qualitative terms deliberately return null when no
 * stored scalar fallback is supplied; callers must not guess at equivalence.
 */
export function comparableNegotiationValue(input: {
  canonicalType: string;
  structuredPayload: unknown;
  normalizedNumeric?: number | null;
  normalizedUnit?: string | null;
  display?: string | null;
}): ComparableDealValue | null {
  const canonicalType = CanonicalTermTypeSchema.safeParse(input.canonicalType);
  const payload = canonicalType.success
    ? parseStructuredPayload(input.structuredPayload, canonicalType.data)
    : null;

  if (payload?.termType === "BASE_RENT" && payload.rent.kind === "simple") {
    return {
      numeric: payload.rent.amountPerRSFYear,
      unit: "USD_PER_RSF_YEAR",
      display: `$${payload.rent.amountPerRSFYear.toFixed(2)} / RSF / year`,
    };
  }
  if (payload?.termType === "TI_ALLOWANCE") {
    return {
      numeric: payload.amount.amount,
      unit: payload.amount.unit,
      display: input.display?.trim() || String(payload.amount.amount),
    };
  }
  if (payload?.termType === "FREE_RENT" && payload.abatement.kind === "contiguous") {
    return {
      numeric: payload.abatement.months,
      unit: "MONTHS",
      display: input.display?.trim() || `${payload.abatement.months} months`,
    };
  }
  if (input.normalizedNumeric == null || !input.normalizedUnit) return null;
  return {
    numeric: input.normalizedNumeric,
    unit: input.normalizedUnit,
    display: input.display?.trim() || String(input.normalizedNumeric),
  };
}
