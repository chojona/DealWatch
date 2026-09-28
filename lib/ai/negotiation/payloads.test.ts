/**
 * lib/ai/negotiation/payloads.test.ts
 *
 * Comprehensive unit tests for CRE structured payload types, Zod schemas,
 * and parse/serialize helpers.
 *
 * Tests verify:
 *   1. All 10 payload types accept valid inputs
 *   2. Invalid inputs are rejected with the correct schema paths
 *   3. canonicalType ↔ termType mismatch is detected
 *   4. Null / undefined input returns null (backward-compat path)
 *   5. Stepped rent (≥2 steps) vs. simple rent validation
 *   6. Irregular free-rent period assembly and equivalentFullMonths
 *   7. Recursive EscalationSpec (greater_of)
 *   8. Round-trip validate → parse identity
 *   9. NegotiationTermRecordV2 is a structural subtype of NegotiationTermRecord
 *  10. supportsStructuredPayload type-guard
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AnnualEscalationPayloadSchema,
  BaseRentPayloadSchema,
  CREStructuredPayloadSchema,
  CommencementDatePayloadSchema,
  EscalationSpecSchema,
  ExpansionRightsPayloadSchema,
  FreeRentPayloadSchema,
  OperatingExpensesPayloadSchema,
  ParkingPayloadSchema,
  RenewalOptionsPayloadSchema,
  STRUCTURED_TERM_TYPES,
  StructuredPayloadParseError,
  TerminationRightsPayloadSchema,
  TIAllowancePayloadSchema,
  canonicalTypeMatchesPayload,
  coerceModelStructuredPayload,
  describeStructuredPayloadRejection,
  parseModelStructuredPayload,
  parseStructuredPayload,
  parseStructuredPayloadOrThrow,
  supportsStructuredPayload,
  validateStructuredPayload,
  type CREStructuredPayload,
} from "./payloads";
import type { NegotiationTermRecord } from "@/lib/negotiation/types";
import type { NegotiationTermRecordV2 } from "@/lib/negotiation/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseOk<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

function parseErr(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  value: unknown
): void {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, "Expected Zod parse to fail");
}

// ─── BASE_RENT ────────────────────────────────────────────────────────────────

test("BASE_RENT simple — valid parse", () => {
  const payload = parseOk(BaseRentPayloadSchema, {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 61, rentStructure: "NNN" },
  });
  assert.equal(payload.termType, "BASE_RENT");
  assert.equal(payload.rent.kind, "simple");
  if (payload.rent.kind === "simple") {
    assert.equal(payload.rent.amountPerRSFYear, 61);
    assert.equal(payload.rent.rentStructure, "NNN");
  }
});

test("BASE_RENT simple — inlineEscalation percent", () => {
  const payload = parseOk(BaseRentPayloadSchema, {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 72 },
    inlineEscalation: { kind: "percent", pct: 2.5 },
  });
  assert.ok(payload.inlineEscalation);
  assert.equal(payload.inlineEscalation.kind, "percent");
  if (payload.inlineEscalation.kind === "percent") {
    assert.equal(payload.inlineEscalation.pct, 2.5);
  }
});

test("BASE_RENT stepped — valid parse with two steps", () => {
  const obs = { observationId: "obs-1" };
  const payload = parseOk(BaseRentPayloadSchema, {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: [
        { startMonth: 1, endMonth: 24, amountPerRSFYear: 55, observationRef: obs },
        { startMonth: 25, endMonth: 48, amountPerRSFYear: 58, observationRef: obs },
      ],
      rentStructure: "NNN",
    },
  });
  assert.equal(payload.rent.kind, "stepped");
  if (payload.rent.kind === "stepped") {
    assert.equal(payload.rent.steps.length, 2);
    assert.equal(payload.rent.steps[0]?.amountPerRSFYear, 55);
    assert.equal(payload.rent.steps[1]?.amountPerRSFYear, 58);
  }
});

test("BASE_RENT stepped — three steps with provenance", () => {
  const obs = (id: string) => ({ observationId: id, evidenceSpan: "step text" });
  const payload = parseOk(BaseRentPayloadSchema, {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: [
        { startMonth: 1, endMonth: 24, amountPerRSFYear: 55, observationRef: obs("o1") },
        { startMonth: 25, endMonth: 48, amountPerRSFYear: 58, observationRef: obs("o2") },
        { startMonth: 49, endMonth: 60, amountPerRSFYear: 62, observationRef: obs("o3") },
      ],
    },
  });
  if (payload.rent.kind === "stepped") {
    assert.equal(payload.rent.steps[2]?.observationRef?.observationId, "o3");
    assert.equal(
      payload.rent.steps[2]?.observationRef?.evidenceSpan,
      "step text"
    );
  }
});

test("BASE_RENT stepped — rejects single step (must be ≥2)", () => {
  parseErr(BaseRentPayloadSchema, {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: [
        {
          startMonth: 1,
          endMonth: 60,
          amountPerRSFYear: 65,
          observationRef: { observationId: "o1" },
        },
      ],
    },
  });
});

test("BASE_RENT — rejects non-positive amountPerRSFYear", () => {
  parseErr(BaseRentPayloadSchema, {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 0 },
  });
});

test("BASE_RENT — rejects missing termType", () => {
  parseErr(BaseRentPayloadSchema, {
    rent: { kind: "simple", amountPerRSFYear: 65 },
  });
});

// ─── FREE_RENT ────────────────────────────────────────────────────────────────

test("FREE_RENT contiguous — valid parse", () => {
  const payload = parseOk(FreeRentPayloadSchema, {
    termType: "FREE_RENT",
    abatement: { kind: "contiguous", months: 6, abatementType: "FULL" },
    scope: "BASE_RENT_ONLY",
  });
  assert.equal(payload.abatement.kind, "contiguous");
  if (payload.abatement.kind === "contiguous") {
    assert.equal(payload.abatement.months, 6);
  }
  assert.equal(payload.scope, "BASE_RENT_ONLY");
});

test("FREE_RENT contiguous — scope null is valid (not stated)", () => {
  const payload = parseOk(FreeRentPayloadSchema, {
    termType: "FREE_RENT",
    abatement: { kind: "contiguous", months: 4, abatementType: "FULL" },
    scope: null,
  });
  assert.equal(payload.scope, null);
});

test("FREE_RENT contiguous — partial abatement with pct", () => {
  const payload = parseOk(FreeRentPayloadSchema, {
    termType: "FREE_RENT",
    abatement: {
      kind: "contiguous",
      months: 3,
      abatementType: "PARTIAL",
      partialPct: 50,
    },
    scope: null,
  });
  if (payload.abatement.kind === "contiguous") {
    assert.equal(payload.abatement.partialPct, 50);
  }
});

test("FREE_RENT irregular — two non-contiguous periods (n09 scenario)", () => {
  const obs = { observationId: "obs-fr" };
  const payload = parseOk(FreeRentPayloadSchema, {
    termType: "FREE_RENT",
    abatement: {
      kind: "irregular",
      periods: [
        {
          startMonth: 1,
          endMonth: 3,
          abatementType: "FULL",
          observationRef: obs,
        },
        {
          startMonth: 7,
          endMonth: 9,
          abatementType: "FULL",
          observationRef: obs,
        },
      ],
      equivalentFullMonths: 6,
    },
    scope: "BASE_RENT_ONLY",
  });
  assert.equal(payload.abatement.kind, "irregular");
  if (payload.abatement.kind === "irregular") {
    assert.equal(payload.abatement.periods.length, 2);
    assert.equal(payload.abatement.equivalentFullMonths, 6);
    assert.equal(payload.abatement.periods[0]?.startMonth, 1);
    assert.equal(payload.abatement.periods[1]?.startMonth, 7);
  }
});

test("FREE_RENT irregular — rejects empty periods array", () => {
  parseErr(FreeRentPayloadSchema, {
    termType: "FREE_RENT",
    abatement: { kind: "irregular", periods: [], equivalentFullMonths: 0 },
    scope: null,
  });
});

test("FREE_RENT contiguous — rejects zero months", () => {
  parseErr(FreeRentPayloadSchema, {
    termType: "FREE_RENT",
    abatement: { kind: "contiguous", months: 0, abatementType: "FULL" },
    scope: null,
  });
});

// ─── TI_ALLOWANCE ─────────────────────────────────────────────────────────────

test("TI_ALLOWANCE — per-RSF amount", () => {
  const payload = parseOk(TIAllowancePayloadSchema, {
    termType: "TI_ALLOWANCE",
    amount: { amount: 125, unit: "USD_PER_RSF_YEAR" },
    conditions: [],
    drawDeadline: null,
    unusedConversion: null,
  });
  assert.equal(payload.amount.unit, "USD_PER_RSF_YEAR");
  assert.equal(payload.amount.amount, 125);
});

test("TI_ALLOWANCE — total USD amount", () => {
  const payload = parseOk(TIAllowancePayloadSchema, {
    termType: "TI_ALLOWANCE",
    amount: { amount: 1_850_000, unit: "USD" },
    conditions: ["subject to Landlord approval of plans"],
    drawDeadline: "within 18 months of commencement",
    unusedConversion: "FREE_RENT",
  });
  assert.equal(payload.amount.unit, "USD");
  assert.equal(payload.conditions.length, 1);
  assert.equal(payload.unusedConversion, "FREE_RENT");
});

test("TI_ALLOWANCE — rejects non-positive amount", () => {
  parseErr(TIAllowancePayloadSchema, {
    termType: "TI_ALLOWANCE",
    amount: { amount: -10, unit: "USD_PER_RSF_YEAR" },
    conditions: [],
    drawDeadline: null,
    unusedConversion: null,
  });
});

test("TI_ALLOWANCE — rejects unknown unit", () => {
  parseErr(TIAllowancePayloadSchema, {
    termType: "TI_ALLOWANCE",
    amount: { amount: 100, unit: "USD_PER_RSF_MONTH" },
    conditions: [],
    drawDeadline: null,
    unusedConversion: null,
  });
});

// ─── RENEWAL_OPTIONS ──────────────────────────────────────────────────────────

test("RENEWAL_OPTIONS — two FMR options", () => {
  const payload = parseOk(RenewalOptionsPayloadSchema, {
    termType: "RENEWAL_OPTIONS",
    options: [
      {
        optionNumber: 1,
        durationMonths: 60,
        pricingMethod: "FAIR_MARKET_RENT",
        conditions: [],
      },
      {
        optionNumber: 2,
        durationMonths: 60,
        pricingMethod: "FAIR_MARKET_RENT",
        conditions: [],
      },
    ],
    personal: null,
  });
  assert.equal(payload.options.length, 2);
  assert.equal(payload.options[0]?.pricingMethod, "FAIR_MARKET_RENT");
});

test("RENEWAL_OPTIONS — fixed-rate option with pricingValue", () => {
  const payload = parseOk(RenewalOptionsPayloadSchema, {
    termType: "RENEWAL_OPTIONS",
    options: [
      {
        optionNumber: 1,
        durationMonths: 60,
        pricingMethod: "PERCENT_OF_THEN_CURRENT",
        pricingValue: 100,
        noticeEarliestMonths: 12,
        noticeLatestMonths: 9,
        conditions: ["not in default at time of exercise"],
      },
    ],
    personal: true,
  });
  assert.equal(payload.options[0]?.pricingValue, 100);
  assert.equal(payload.personal, true);
});

test("RENEWAL_OPTIONS — rejects empty options array", () => {
  parseErr(RenewalOptionsPayloadSchema, {
    termType: "RENEWAL_OPTIONS",
    options: [],
    personal: null,
  });
});

// ─── TERMINATION_RIGHTS ───────────────────────────────────────────────────────

test("TERMINATION_RIGHTS — right present with unamortized fee", () => {
  const payload = parseOk(TerminationRightsPayloadSchema, {
    termType: "TERMINATION_RIGHTS",
    right: {
      eligibleAfterYear: 5,
      eligibleAfterMonth: null,
      noticeMonths: 9,
      terminationFee: {
        kind: "unamortized_costs",
        description: "unamortized transaction costs",
      },
      conditions: [],
    },
  });
  assert.ok(payload.right);
  assert.equal(payload.right?.eligibleAfterYear, 5);
  assert.equal(payload.right?.noticeMonths, 9);
  if (payload.right?.terminationFee?.kind === "unamortized_costs") {
    assert.equal(
      payload.right.terminationFee.description,
      "unamortized transaction costs"
    );
  }
});

test("TERMINATION_RIGHTS — null right (rejected termination right)", () => {
  const payload = parseOk(TerminationRightsPayloadSchema, {
    termType: "TERMINATION_RIGHTS",
    right: null,
  });
  assert.equal(payload.right, null);
});

test("TERMINATION_RIGHTS — months_rent fee kind", () => {
  const payload = parseOk(TerminationRightsPayloadSchema, {
    termType: "TERMINATION_RIGHTS",
    right: {
      eligibleAfterYear: 6,
      eligibleAfterMonth: null,
      noticeMonths: 12,
      terminationFee: { kind: "months_rent", months: 6 },
      conditions: [],
    },
  });
  if (payload.right?.terminationFee?.kind === "months_rent") {
    assert.equal(payload.right.terminationFee.months, 6);
  }
});

// ─── OPERATING_EXPENSES ───────────────────────────────────────────────────────

test("OPERATING_EXPENSES — NNN with controllable cap", () => {
  const payload = parseOk(OperatingExpensesPayloadSchema, {
    termType: "OPERATING_EXPENSES",
    structure: "NNN",
    baseYear: null,
    controllableCapPct: 5,
    taxesInsuranceUncapped: null,
    exclusions: [],
    managementFeePct: null,
  });
  assert.equal(payload.structure, "NNN");
  assert.equal(payload.controllableCapPct, 5);
});

test("OPERATING_EXPENSES — 7% cap, taxes/insurance uncapped", () => {
  const payload = parseOk(OperatingExpensesPayloadSchema, {
    termType: "OPERATING_EXPENSES",
    structure: "NNN",
    baseYear: null,
    controllableCapPct: 7,
    taxesInsuranceUncapped: true,
    exclusions: ["real estate taxes", "insurance"],
    managementFeePct: null,
  });
  assert.equal(payload.taxesInsuranceUncapped, true);
  assert.equal(payload.exclusions.length, 2);
});

test("OPERATING_EXPENSES — BASE_YEAR structure", () => {
  const payload = parseOk(OperatingExpensesPayloadSchema, {
    termType: "OPERATING_EXPENSES",
    structure: "BASE_YEAR",
    baseYear: 2027,
    controllableCapPct: null,
    taxesInsuranceUncapped: null,
    exclusions: [],
    managementFeePct: 3,
  });
  assert.equal(payload.baseYear, 2027);
  assert.equal(payload.managementFeePct, 3);
});

// ─── ANNUAL_ESCALATION ────────────────────────────────────────────────────────

test("ANNUAL_ESCALATION — percent escalation", () => {
  const payload = parseOk(AnnualEscalationPayloadSchema, {
    termType: "ANNUAL_ESCALATION",
    escalation: { kind: "percent", pct: 2.75 },
    firstEscalationMonth: null,
    frequency: "ANNUAL",
  });
  assert.equal(payload.escalation.kind, "percent");
  if (payload.escalation.kind === "percent") {
    assert.equal(payload.escalation.pct, 2.75);
  }
});

test("ANNUAL_ESCALATION — CPI escalation with cap and floor", () => {
  const payload = parseOk(AnnualEscalationPayloadSchema, {
    termType: "ANNUAL_ESCALATION",
    escalation: { kind: "cpi", capPct: 5, floorPct: 2 },
    firstEscalationMonth: 13,
    frequency: "ANNUAL",
  });
  if (payload.escalation.kind === "cpi") {
    assert.equal(payload.escalation.capPct, 5);
    assert.equal(payload.escalation.floorPct, 2);
  }
  assert.equal(payload.firstEscalationMonth, 13);
});

test("EscalationSpec — recursive greater_of", () => {
  const result = EscalationSpecSchema.parse({
    kind: "greater_of",
    options: [
      { kind: "percent", pct: 3 },
      { kind: "cpi", capPct: 5 },
    ],
  });
  assert.equal(result.kind, "greater_of");
  if (result.kind === "greater_of") {
    assert.equal(result.options.length, 2);
    assert.equal(result.options[0]?.kind, "percent");
  }
});

test("EscalationSpec — greater_of rejects fewer than 2 options", () => {
  parseErr(EscalationSpecSchema, {
    kind: "greater_of",
    options: [{ kind: "percent", pct: 3 }],
  });
});

// ─── PARKING ──────────────────────────────────────────────────────────────────

test("PARKING — count + fixed rate", () => {
  const payload = parseOk(ParkingPayloadSchema, {
    termType: "PARKING",
    spacesCount: 12,
    spacesRatio: "1 per 1,000 RSF",
    ratePerSpacePerMonth: 275,
    rateType: "FIXED",
    reserved: null,
    conditions: [],
  });
  assert.equal(payload.spacesCount, 12);
  assert.equal(payload.ratePerSpacePerMonth, 275);
  assert.equal(payload.rateType, "FIXED");
});

test("PARKING — free parking (rate 0 is allowed)", () => {
  const payload = parseOk(ParkingPayloadSchema, {
    termType: "PARKING",
    spacesCount: 4,
    spacesRatio: null,
    ratePerSpacePerMonth: 0,
    rateType: "FREE",
    reserved: true,
    conditions: [],
  });
  assert.equal(payload.ratePerSpacePerMonth, 0);
  assert.equal(payload.rateType, "FREE");
  assert.equal(payload.reserved, true);
});

test("PARKING — all nullable fields are null", () => {
  const payload = parseOk(ParkingPayloadSchema, {
    termType: "PARKING",
    spacesCount: null,
    spacesRatio: null,
    ratePerSpacePerMonth: null,
    rateType: null,
    reserved: null,
    conditions: [],
  });
  assert.equal(payload.spacesCount, null);
});

// ─── COMMENCEMENT_DATE ────────────────────────────────────────────────────────

test("COMMENCEMENT_DATE — fixed date no conditions", () => {
  const payload = parseOk(CommencementDatePayloadSchema, {
    termType: "COMMENCEMENT_DATE",
    fixedDate: "2027-03-01",
    conditions: [],
    deliveryGuaranty: "NOT_MENTIONED",
  });
  assert.equal(payload.fixedDate, "2027-03-01");
  assert.equal(payload.deliveryGuaranty, "NOT_MENTIONED");
});

test("COMMENCEMENT_DATE — conditional with delivery guaranty proposed", () => {
  const payload = parseOk(CommencementDatePayloadSchema, {
    termType: "COMMENCEMENT_DATE",
    fixedDate: "2027-04-01",
    conditions: ["subject to existing tenant surrender"],
    deliveryGuaranty: "PROPOSED",
  });
  assert.equal(payload.conditions[0], "subject to existing tenant surrender");
  assert.equal(payload.deliveryGuaranty, "PROPOSED");
});

test("COMMENCEMENT_DATE — null fixedDate (open / conditional)", () => {
  const payload = parseOk(CommencementDatePayloadSchema, {
    termType: "COMMENCEMENT_DATE",
    fixedDate: null,
    conditions: ["subject to delivery"],
    deliveryGuaranty: "NOT_MENTIONED",
  });
  assert.equal(payload.fixedDate, null);
});

// ─── EXPANSION_RIGHTS ─────────────────────────────────────────────────────────

test("EXPANSION_RIGHTS — ROFO with pricing", () => {
  const payload = parseOk(ExpansionRightsPayloadSchema, {
    termType: "EXPANSION_RIGHTS",
    rightKind: "ROFO",
    applicableSpace: "contiguous space on the same floor",
    trigger: "upon availability",
    noticeMonths: 3,
    pricingMethod: "FAIR_MARKET_RENT",
    conditions: ["not in default"],
  });
  assert.equal(payload.rightKind, "ROFO");
  assert.equal(payload.noticeMonths, 3);
  assert.equal(payload.pricingMethod, "FAIR_MARKET_RENT");
});

test("EXPANSION_RIGHTS — ROFR all nulls allowed", () => {
  const payload = parseOk(ExpansionRightsPayloadSchema, {
    termType: "EXPANSION_RIGHTS",
    rightKind: "ROFR",
    applicableSpace: null,
    trigger: null,
    noticeMonths: null,
    pricingMethod: null,
    conditions: [],
  });
  assert.equal(payload.applicableSpace, null);
  assert.equal(payload.pricingMethod, null);
});

// ─── CREStructuredPayloadSchema (master union) ───────────────────────────────

test("CREStructuredPayloadSchema — dispatches on termType correctly", () => {
  const basRent = CREStructuredPayloadSchema.parse({
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 65 },
  });
  assert.equal(basRent.termType, "BASE_RENT");

  const freeRent = CREStructuredPayloadSchema.parse({
    termType: "FREE_RENT",
    abatement: { kind: "contiguous", months: 3, abatementType: "FULL" },
    scope: null,
  });
  assert.equal(freeRent.termType, "FREE_RENT");

  const renewal = CREStructuredPayloadSchema.parse({
    termType: "RENEWAL_OPTIONS",
    options: [
      {
        optionNumber: 1,
        durationMonths: 60,
        pricingMethod: "FAIR_MARKET_RENT",
        conditions: [],
      },
    ],
    personal: null,
  });
  assert.equal(renewal.termType, "RENEWAL_OPTIONS");
});

test("CREStructuredPayloadSchema — rejects unknown termType", () => {
  parseErr(CREStructuredPayloadSchema, {
    termType: "UNKNOWN_TYPE",
    value: 42,
  });
});

test("CREStructuredPayloadSchema — rejects missing termType", () => {
  parseErr(CREStructuredPayloadSchema, { rent: { kind: "simple", amountPerRSFYear: 65 } });
});

// ─── parseStructuredPayload helper ───────────────────────────────────────────

test("parseStructuredPayload — null input returns null (backward compat)", () => {
  assert.equal(parseStructuredPayload(null), null);
  assert.equal(parseStructuredPayload(undefined), null);
});

test("parseStructuredPayload — valid payload round-trips", () => {
  const raw = {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 67 },
  };
  const payload = parseStructuredPayload(raw);
  assert.ok(payload);
  assert.equal(payload.termType, "BASE_RENT");
});

test("parseStructuredPayload — invalid shape returns null (no throw)", () => {
  const result = parseStructuredPayload({ termType: "BASE_RENT", rent: "invalid" });
  assert.equal(result, null);
});

test("parseStructuredPayload — canonicalType match passes", () => {
  const raw = {
    termType: "TI_ALLOWANCE",
    amount: { amount: 115, unit: "USD_PER_RSF_YEAR" },
    conditions: [],
    drawDeadline: null,
    unusedConversion: null,
  };
  const payload = parseStructuredPayload(raw, "TI_ALLOWANCE");
  assert.ok(payload);
  assert.equal(payload.termType, "TI_ALLOWANCE");
});

test("parseStructuredPayload — canonicalType mismatch returns null", () => {
  const raw = {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 65 },
  };
  // raw says BASE_RENT but we ask for TI_ALLOWANCE — mismatch
  const payload = parseStructuredPayload(raw, "TI_ALLOWANCE");
  assert.equal(payload, null);
});

test("parseStructuredPayload — canonicalType without payload support returns null", () => {
  // PREMISES_RSF has no structured payload; passing a payload should return null
  // because the JSON can't parse as any known termType with termType="PREMISES_RSF"
  const raw = { termType: "PREMISES_RSF", rsf: 22400 };
  const result = parseStructuredPayload(raw);
  assert.equal(result, null);
});

// ─── parseStructuredPayloadOrThrow helper ────────────────────────────────────

test("parseStructuredPayloadOrThrow — null returns null", () => {
  assert.equal(parseStructuredPayloadOrThrow(null), null);
  assert.equal(parseStructuredPayloadOrThrow(undefined), null);
});

test("parseStructuredPayloadOrThrow — valid payload returns typed result", () => {
  const raw = {
    termType: "ANNUAL_ESCALATION",
    escalation: { kind: "percent", pct: 3 },
    firstEscalationMonth: null,
    frequency: "ANNUAL",
  };
  const payload = parseStructuredPayloadOrThrow(raw);
  assert.ok(payload);
  assert.equal(payload.termType, "ANNUAL_ESCALATION");
});

test("parseStructuredPayloadOrThrow — invalid shape throws StructuredPayloadParseError", () => {
  assert.throws(
    () => parseStructuredPayloadOrThrow({ termType: "BASE_RENT", rent: null }),
    (err: unknown) => {
      assert.ok(err instanceof StructuredPayloadParseError);
      assert.equal(err.name, "StructuredPayloadParseError");
      return true;
    }
  );
});

test("parseStructuredPayloadOrThrow — canonicalType mismatch throws StructuredPayloadParseError", () => {
  const raw = {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 65 },
  };
  assert.throws(
    () => parseStructuredPayloadOrThrow(raw, "FREE_RENT"),
    (err: unknown) => {
      assert.ok(err instanceof StructuredPayloadParseError);
      assert.ok(
        err.message.includes("BASE_RENT"),
        `Expected message to contain "BASE_RENT", got: ${err.message}`
      );
      assert.ok(
        err.message.includes("FREE_RENT"),
        `Expected message to contain "FREE_RENT", got: ${err.message}`
      );
      return true;
    }
  );
});

test("parseStructuredPayloadOrThrow — ZodIssues are attached on parse failure", () => {
  assert.throws(
    () => parseStructuredPayloadOrThrow({ termType: "PARKING", spacesCount: "not-a-number" }),
    (err: unknown) => {
      assert.ok(err instanceof StructuredPayloadParseError);
      assert.ok(err.issues && err.issues.length > 0);
      return true;
    }
  );
});

// ─── validateStructuredPayload helper ────────────────────────────────────────

test("validateStructuredPayload — strips unknown fields", () => {
  const payload: CREStructuredPayload = {
    termType: "PARKING",
    spacesCount: 10,
    spacesRatio: null,
    ratePerSpacePerMonth: 300,
    rateType: "FIXED",
    reserved: null,
    conditions: [],
  };
  const raw = { ...payload, __unknownField: "should-be-stripped" };
  const validated = validateStructuredPayload(raw as CREStructuredPayload);
  assert.ok(!("__unknownField" in validated));
  assert.equal(validated.termType, "PARKING");
});

test("validateStructuredPayload — round-trip identity", () => {
  const payload: CREStructuredPayload = {
    termType: "COMMENCEMENT_DATE",
    fixedDate: "2027-04-01",
    conditions: ["subject to existing tenant surrender"],
    deliveryGuaranty: "PROPOSED",
  };
  const validated = validateStructuredPayload(payload);
  assert.deepEqual(validated, payload);
});

// ─── supportsStructuredPayload type-guard ────────────────────────────────────

test("supportsStructuredPayload — returns true for all 10 supported types", () => {
  const supported = [
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
  ] as const;
  for (const type of supported) {
    assert.ok(
      supportsStructuredPayload(type),
      `Expected supportsStructuredPayload("${type}") to be true`
    );
  }
});

test("supportsStructuredPayload — returns false for non-structured types", () => {
  const notSupported = [
    "PREMISES_RSF",
    "LEASE_TERM",
    "SECURITY_DEPOSIT",
    "RENT_STRUCTURE",
    "DELIVERY_CONDITION",
    "ASSIGNMENT_SUBLETTING",
  ] as const;
  for (const type of notSupported) {
    assert.equal(
      supportsStructuredPayload(type),
      false,
      `Expected supportsStructuredPayload("${type}") to be false`
    );
  }
});

test("STRUCTURED_TERM_TYPES — has exactly 10 entries", () => {
  assert.equal(STRUCTURED_TERM_TYPES.size, 10);
});

// ─── canonicalTypeMatchesPayload ──────────────────────────────────────────────

test("canonicalTypeMatchesPayload — match returns true", () => {
  const payload = CREStructuredPayloadSchema.parse({
    termType: "FREE_RENT",
    abatement: { kind: "contiguous", months: 5, abatementType: "FULL" },
    scope: null,
  });
  assert.equal(canonicalTypeMatchesPayload("FREE_RENT", payload), true);
});

test("canonicalTypeMatchesPayload — mismatch returns false", () => {
  const payload = CREStructuredPayloadSchema.parse({
    termType: "FREE_RENT",
    abatement: { kind: "contiguous", months: 5, abatementType: "FULL" },
    scope: null,
  });
  assert.equal(canonicalTypeMatchesPayload("BASE_RENT", payload), false);
  assert.equal(canonicalTypeMatchesPayload("TI_ALLOWANCE", payload), false);
  assert.equal(canonicalTypeMatchesPayload("PARKING", payload), false);
});

// ─── Backward compatibility: NegotiationTermRecord ───────────────────────────

test("NegotiationTermRecordV2 with null structuredPayload is assignable to NegotiationTermRecord", () => {
  // Construct a V2 record with null payload.
  const v2Record: NegotiationTermRecordV2 = {
    id: "term-bc-1",
    canonicalType: "BASE_RENT",
    normalizedValue: "$61.00/RSF/year",
    normalizedNumeric: 61,
    normalizedUnit: "USD_PER_RSF_YEAR",
    rawValue: "$61.00 per RSF per year",
    status: "PROPOSED",
    side: "TENANT",
    roundNumber: 1,
    confidence: 0.99,
    evidenceQuote: "Base Rent: $61.00 per RSF per year.",
    sourceLocation: "Base Rent",
    structuredPayload: null,
  };

  // Assign to the base interface — must compile without error.
  const baseRecord: NegotiationTermRecord = v2Record;
  assert.equal(baseRecord.id, "term-bc-1");
  assert.equal(baseRecord.normalizedNumeric, 61);
});

test("NegotiationTermRecordV2 with null payload behaves identically to existing record in type system", () => {
  // V2 records can be used anywhere NegotiationTermRecord[] is expected.
  function countTerms(terms: NegotiationTermRecord[]): number {
    return terms.length;
  }

  const v2Records: NegotiationTermRecordV2[] = [
    {
      id: "bc-2",
      canonicalType: "LEASE_TERM",
      normalizedValue: "84 months",
      normalizedNumeric: 84,
      normalizedUnit: "MONTHS",
      rawValue: "seven-year lease term",
      status: "AGREED",
      side: "TENANT",
      roundNumber: 2,
      confidence: 0.99,
      evidenceQuote: "Tenant agrees to the seven-year lease term.",
      sourceLocation: "Opening",
      structuredPayload: null,
    },
  ];

  // Should compile and run without error.
  assert.equal(countTerms(v2Records), 1);
});

test("NegotiationTermRecordV2 structuredPayload can hold a typed payload", () => {
  const payload: CREStructuredPayload = {
    termType: "TI_ALLOWANCE",
    amount: { amount: 125, unit: "USD_PER_RSF_YEAR" },
    conditions: [],
    drawDeadline: null,
    unusedConversion: null,
  };

  const v2: NegotiationTermRecordV2 = {
    id: "term-ti-1",
    canonicalType: "TI_ALLOWANCE",
    normalizedValue: "$125.00/RSF",
    normalizedNumeric: 125,
    normalizedUnit: "USD_PER_RSF_YEAR",
    rawValue: "$125.00 per rentable square foot",
    status: "PROPOSED",
    side: "TENANT",
    roundNumber: 1,
    confidence: 0.99,
    evidenceQuote: "Tenant Improvement Allowance: $125.00 per rentable square foot.",
    sourceLocation: "Tenant Improvement Allowance",
    structuredPayload: payload,
  };

  assert.ok(v2.structuredPayload);
  assert.equal(v2.structuredPayload.termType, "TI_ALLOWANCE");
  // Verify canonicalType matches termType.
  assert.ok(canonicalTypeMatchesPayload(v2.canonicalType, v2.structuredPayload));
});

// ─── Seeded-deal scenario: 200 Clarendon tenant R1 ──────────────────────────

test("seeded-deal scenario — Tenant R1 BASE_RENT payload round-trips", () => {
  const raw: CREStructuredPayload = {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 61, rentStructure: "NNN" },
    inlineEscalation: { kind: "percent", pct: 2.5 },
  };
  const validated = validateStructuredPayload(raw);
  const parsed = parseStructuredPayload(validated, "BASE_RENT");
  assert.ok(parsed);
  assert.equal(parsed.termType, "BASE_RENT");
  if (parsed.rent.kind === "simple") {
    assert.equal(parsed.rent.amountPerRSFYear, 61);
  }
});

test("seeded-deal scenario — Landlord R2 OPERATING_EXPENSES payload", () => {
  const raw: CREStructuredPayload = {
    termType: "OPERATING_EXPENSES",
    structure: "NNN",
    baseYear: null,
    controllableCapPct: 7,
    taxesInsuranceUncapped: true,
    exclusions: [],
    managementFeePct: null,
  };
  const parsed = parseStructuredPayload(raw, "OPERATING_EXPENSES");
  assert.ok(parsed);
  assert.equal(parsed.termType, "OPERATING_EXPENSES");
  if (parsed.termType === "OPERATING_EXPENSES") {
    assert.equal(parsed.controllableCapPct, 7);
    assert.equal(parsed.taxesInsuranceUncapped, true);
  }
});

test("seeded-deal scenario — Renewal options comparison (n10 scenario)", () => {
  // Tenant: two 5-year options at FMR
  const tenantRenewal: CREStructuredPayload = {
    termType: "RENEWAL_OPTIONS",
    options: [
      { optionNumber: 1, durationMonths: 60, pricingMethod: "FAIR_MARKET_RENT", conditions: [] },
      { optionNumber: 2, durationMonths: 60, pricingMethod: "FAIR_MARKET_RENT", conditions: [] },
    ],
    personal: null,
  };
  // Landlord: one 5-year option at 100% FMR
  const landlordRenewal: CREStructuredPayload = {
    termType: "RENEWAL_OPTIONS",
    options: [
      {
        optionNumber: 1,
        durationMonths: 60,
        pricingMethod: "PERCENT_OF_THEN_CURRENT",
        pricingValue: 100,
        conditions: [],
      },
    ],
    personal: null,
  };

  const tParsed = parseStructuredPayload(tenantRenewal, "RENEWAL_OPTIONS");
  const lParsed = parseStructuredPayload(landlordRenewal, "RENEWAL_OPTIONS");

  assert.ok(tParsed);
  assert.ok(lParsed);
  if (
    tParsed.termType === "RENEWAL_OPTIONS" &&
    lParsed.termType === "RENEWAL_OPTIONS"
  ) {
    // The structural gap is now measurable: 2 options vs 1
    assert.equal(tParsed.options.length, 2);
    assert.equal(lParsed.options.length, 1);
    // Pricing method difference is now structurally visible
    assert.equal(tParsed.options[0]?.pricingMethod, "FAIR_MARKET_RENT");
    assert.equal(lParsed.options[0]?.pricingMethod, "PERCENT_OF_THEN_CURRENT");
  }
});

test("coercion drops optional null placeholders and keeps required nulls", () => {
  const raw = {
    termType: "FREE_RENT" as const,
    abatement: {
      kind: "contiguous" as const,
      months: 3,
      abatementType: "FULL" as const,
      partialPct: null,
    },
    scope: null,
  };
  assert.equal(parseStructuredPayload(raw), null);
  const coerced = coerceModelStructuredPayload(raw);
  assert.deepEqual(coerced, {
    termType: "FREE_RENT",
    abatement: { kind: "contiguous", months: 3, abatementType: "FULL" },
    scope: null,
  });
  const parsed = parseModelStructuredPayload(raw, "FREE_RENT");
  assert.ok(parsed && parsed.termType === "FREE_RENT");
  if (parsed?.termType === "FREE_RENT") assert.equal(parsed.scope, null);
});

test("strict rejection diagnostics include the payload path", () => {
  const detail = describeStructuredPayloadRejection({
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 50, rentStructure: null },
  });
  assert.match(
    detail ?? "",
    /BASE_RENT\.rent\.rentStructure: Expected 'NNN' \| 'GROSS' \| 'MODIFIED_GROSS' \| 'BASE_YEAR' \| 'OTHER', received null/
  );
  assert.equal(
    describeStructuredPayloadRejection({
      termType: "BASE_RENT",
      rent: { kind: "simple", amountPerRSFYear: 50 },
    }),
    null
  );
  const escalation = describeStructuredPayloadRejection({
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 42 },
    inlineEscalation: null,
  });
  assert.match(
    escalation ?? "",
    /BASE_RENT\.inlineEscalation: Expected object, received null/
  );
  assert.doesNotMatch(escalation ?? "", /Invalid input/);
});
