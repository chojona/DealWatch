/**
 * evals/negotiation/v2/payloadLibrary.ts
 *
 * Canonical expected CREStructuredPayload values for V2 scoring.
 *
 * These are V2 gold expectations only. They do not modify V1 fixtures.ts.
 * Live extraction expectations and oracle observations both import from here
 * so a payload is authored once.
 */

import type { CREStructuredPayload } from "@/lib/ai/negotiation/payloads";

export const n01Rent: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 42 },
};

export const n03Rent: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 58.5 },
};

export const n03TI: CREStructuredPayload = {
  termType: "TI_ALLOWANCE",
  amount: { amount: 110, unit: "USD_PER_RSF_YEAR" },
  conditions: [],
  drawDeadline: null,
  unusedConversion: null,
};

export const n04TenantRent: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 50 },
};

export const n04LandlordRent: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 56 },
};

export const n06TI: CREStructuredPayload = {
  termType: "TI_ALLOWANCE",
  amount: { amount: 95, unit: "USD_PER_RSF_YEAR" },
  conditions: [],
  drawDeadline: null,
  unusedConversion: null,
};

/** n07: three-step non-uniform schedule. Each V1 step observation carries this full payload. */
export const n07SteppedRent: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: {
    kind: "stepped",
    steps: [
      { startMonth: 1, endMonth: 24, amountPerRSFYear: 48 },
      { startMonth: 25, endMonth: 60, amountPerRSFYear: 51 },
      { startMonth: 61, endMonth: 120, amountPerRSFYear: 55.5 },
    ],
  },
};

export const n08TI: CREStructuredPayload = {
  termType: "TI_ALLOWANCE",
  amount: { amount: 120, unit: "USD_PER_RSF_YEAR" },
  conditions: ["subject to investment committee approval"],
  drawDeadline: null,
  unusedConversion: null,
};

export const n08Commencement: CREStructuredPayload = {
  termType: "COMMENCEMENT_DATE",
  fixedDate: "2027-07-01",
  conditions: ["existing tenant surrenders by May 15, 2027"],
  deliveryGuaranty: "NOT_MENTIONED",
};

/**
 * n09 irregular abatement: months 2, 4, 6, 8 at 100% plus month 10 at 50%.
 *
 * equivalentFullMonths is the economic equivalent 4.5 (4 full + 0.5 partial).
 * The payload schema comment describes a FULL-only sum; V2 scores the
 * derived 4.5 separately at low weight so a matching total cannot hide
 * wrong period boundaries.
 */
export const n09FreeRent: CREStructuredPayload = {
  termType: "FREE_RENT",
  abatement: {
    kind: "irregular",
    periods: [
      { startMonth: 2, endMonth: 2, abatementType: "FULL" },
      { startMonth: 4, endMonth: 4, abatementType: "FULL" },
      { startMonth: 6, endMonth: 6, abatementType: "FULL" },
      { startMonth: 8, endMonth: 8, abatementType: "FULL" },
      { startMonth: 10, endMonth: 10, abatementType: "PARTIAL", partialPct: 50 },
    ],
    equivalentFullMonths: 4.5,
  },
  scope: "BASE_RENT_ONLY",
};

export const n09OpEx: CREStructuredPayload = {
  termType: "OPERATING_EXPENSES",
  structure: "OTHER",
  baseYear: null,
  controllableCapPct: null,
  taxesInsuranceUncapped: null,
  exclusions: [],
  managementFeePct: null,
};

export const n10Renewal: CREStructuredPayload = {
  termType: "RENEWAL_OPTIONS",
  options: [
    {
      optionNumber: 1,
      durationMonths: 60,
      pricingMethod: "PERCENT_OF_THEN_CURRENT",
      pricingValue: 95,
      noticeLatestMonths: 12,
      conditions: ["not in monetary default beyond notice and cure"],
    },
    {
      optionNumber: 2,
      durationMonths: 60,
      pricingMethod: "PERCENT_OF_THEN_CURRENT",
      pricingValue: 95,
      noticeLatestMonths: 12,
      conditions: ["not in monetary default beyond notice and cure"],
    },
  ],
  personal: null,
};

/**
 * n11 termination: after month 84, 15 months notice, compound fee.
 *
 * SCHEMA LIMITATION (documented, not fixed in Phase 4): TerminationFeeSchema
 * is a single-kind union and cannot represent "unamortized costs PLUS three
 * months rent" as two fee structures. The unamortized_costs description
 * carries both components as document language.
 */
export const n11Termination: CREStructuredPayload = {
  termType: "TERMINATION_RIGHTS",
  right: {
    eligibleAfterYear: null,
    eligibleAfterMonth: 84,
    noticeMonths: 15,
    terminationFee: {
      kind: "unamortized_costs",
      description:
        "unamortized TI allowance and commissions plus three months of then-current Base Rent",
    },
    conditions: [],
  },
};

export const n12Expansion: CREStructuredPayload = {
  termType: "EXPANSION_RIGHTS",
  rightKind: "ROFO",
  applicableSpace: "adjacent fourth floor",
  trigger: null,
  noticeMonths: null,
  pricingMethod: null,
  conditions: [],
};

export const n12Parking: CREStructuredPayload = {
  termType: "PARKING",
  spacesCount: 42,
  spacesRatio: null,
  ratePerSpacePerMonth: null,
  rateType: "PREVAILING",
  reserved: false,
  conditions: [],
};

export const n13Rent64: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 64 },
};

export const n13Rent62: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 62 },
};

export const n15RentOriginal: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 70 },
};

export const n15RentAmended: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 67.5 },
};

export const n15TI: CREStructuredPayload = {
  termType: "TI_ALLOWANCE",
  amount: { amount: 80, unit: "USD_PER_RSF_YEAR" },
  conditions: [],
  drawDeadline: null,
  unusedConversion: null,
};

export const n16Rent: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 65 },
};

export const n17OpEx: CREStructuredPayload = {
  termType: "OPERATING_EXPENSES",
  structure: "OTHER",
  baseYear: null,
  controllableCapPct: 5,
  taxesInsuranceUncapped: null,
  exclusions: [],
  managementFeePct: null,
};

export const n17Parking: CREStructuredPayload = {
  termType: "PARKING",
  spacesCount: 20,
  spacesRatio: null,
  ratePerSpacePerMonth: 325,
  rateType: "FIXED",
  reserved: null,
  conditions: [],
};

export const n20TenantCommencement: CREStructuredPayload = {
  termType: "COMMENCEMENT_DATE",
  fixedDate: "2027-10-01",
  conditions: [],
  deliveryGuaranty: "NOT_MENTIONED",
};

export const n20LandlordCommencement: CREStructuredPayload = {
  termType: "COMMENCEMENT_DATE",
  fixedDate: "2027-10-01",
  conditions: ["vacant possession occurs by September 15, 2027"],
  deliveryGuaranty: "NOT_MENTIONED",
};

export const n20AgreedCommencement: CREStructuredPayload = {
  termType: "COMMENCEMENT_DATE",
  fixedDate: "2027-10-01",
  conditions: [],
  deliveryGuaranty: "NOT_MENTIONED",
};

export const n20TenantFreeRent: CREStructuredPayload = {
  termType: "FREE_RENT",
  abatement: {
    kind: "irregular",
    periods: [
      { startMonth: 1, endMonth: 5, abatementType: "FULL" },
      { startMonth: 13, endMonth: 17, abatementType: "FULL" },
    ],
    equivalentFullMonths: 10,
  },
  scope: "BASE_RENT_ONLY",
};

export const n20LandlordFreeRent: CREStructuredPayload = {
  termType: "FREE_RENT",
  abatement: {
    kind: "irregular",
    periods: [
      { startMonth: 1, endMonth: 4, abatementType: "FULL" },
      { startMonth: 13, endMonth: 16, abatementType: "FULL" },
    ],
    equivalentFullMonths: 8,
  },
  scope: "BASE_RENT_ONLY",
};

export const n20TenantTermination: CREStructuredPayload = {
  termType: "TERMINATION_RIGHTS",
  right: {
    eligibleAfterYear: null,
    eligibleAfterMonth: 72,
    noticeMonths: 12,
    terminationFee: {
      kind: "unamortized_costs",
      description: "unamortized transaction costs",
    },
    conditions: [],
  },
};

/** Explicit carry-forward oracle: Round 1 rent $65 + TI $110; Round 2 rent $67. */
export const carryForwardRent65: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 65 },
};

export const carryForwardRent67: CREStructuredPayload = {
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: 67 },
};

export const carryForwardTI110: CREStructuredPayload = {
  termType: "TI_ALLOWANCE",
  amount: { amount: 110, unit: "USD_PER_RSF_YEAR" },
  conditions: [],
  drawDeadline: null,
  unusedConversion: null,
};

/** Representative annual-escalation oracle (no V1 fixture covers this type). */
export const oracleAnnualEscalation: CREStructuredPayload = {
  termType: "ANNUAL_ESCALATION",
  escalation: { kind: "percent", pct: 3 },
  firstEscalationMonth: 13,
  frequency: "ANNUAL",
};
