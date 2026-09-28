/**
 * lib/negotiation/resolveStructuredState.test.ts
 *
 * Phase 3 — Structured Current-State Resolution: comprehensive deterministic
 * tests. No live API calls.
 *
 * Coverage (A–V + regression cases):
 *
 *   A.  simple scalar carry-forward
 *   B.  simple rent superseded by stepped rent
 *   C.  stepped rent superseded by different stepped rent
 *   D.  omitted rent carries forward
 *   E.  irregular free-rent periods preserved
 *   F.  partial abatement preserved
 *   G.  renewal right replaced atomically
 *   H.  termination right replaced atomically
 *   I.  parking count + rate stay together
 *   J.  operating-expense cap resolution
 *   K.  annual escalation resolution
 *   L.  expansion right resolution
 *   M.  rejected proposal not current
 *   N.  withdrawn proposal not current
 *   O.  unilateral amendment does not create agreement
 *   P.  explicit agreement resolves AGREED state
 *   Q.  contradictory same-side/same-round rent creates CONFLICT
 *   R.  provenance uses real NegotiationTerm IDs
 *   S.  legacy null structuredPayload is ignored safely
 *   T.  malformed payload is ignored safely
 *   U.  legacy "pending" observationRef does not leak into resolved provenance
 *   V.  no input observation is mutated
 *
 * Regression cases structurally equivalent to:
 *   n07  stepped rent (multiple step observations with full schedule)
 *   n09  irregular free rent (non-contiguous abatement periods)
 *   n13  contradictory draft (same-side same-round conflict)
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { CREStructuredPayload, CRETermType } from "@/lib/ai/negotiation/payloads";
import type { NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";
import {
  isSideConflict,
  resolveStructuredState,
  type RoundWithPayload,
  type TermWithPayload,
} from "./resolveStructuredState";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let seq = 0;

function makeTerm(
  type: CRETermType,
  side: "TENANT" | "LANDLORD",
  roundNumber: number,
  payload: CREStructuredPayload | null,
  options: {
    id?: string;
    status?: NegotiationTermStatus;
    normalizedNumeric?: number | null;
    normalizedValue?: string | null;
    normalizedUnit?: string | null;
  } = {}
): TermWithPayload {
  seq += 1;
  return {
    id: options.id ?? `term-${seq}`,
    canonicalType: type,
    normalizedValue: options.normalizedValue ?? null,
    normalizedNumeric: options.normalizedNumeric ?? null,
    normalizedUnit: options.normalizedUnit ?? null,
    rawValue: "raw evidence text",
    status: options.status ?? "PROPOSED",
    side,
    roundNumber,
    confidence: 0.98,
    evidenceQuote: `evidence for ${type} ${side} R${roundNumber}`,
    sourceLocation: null,
    structuredPayload: payload,
  };
}

function makeRound(
  side: "TENANT" | "LANDLORD",
  roundNumber: number,
  day: number,
  terms: TermWithPayload[],
  idSuffix = ""
): RoundWithPayload {
  return {
    id: `${side}-R${roundNumber}${idSuffix}`,
    side,
    roundNumber,
    documentName: `${side} R${roundNumber}`,
    documentText: terms.map((t) => t.evidenceQuote).join("\n"),
    documentDate: new Date(
      `2026-09-${String(day).padStart(2, "0")}T12:00:00Z`
    ),
    createdAt: new Date(
      `2026-09-${String(day).padStart(2, "0")}T13:00:00Z`
    ),
    terms,
  };
}

// ─── Payload factories ────────────────────────────────────────────────────────

const simpleRent = (
  amount: number,
  rentStructure?: "NNN" | "GROSS" | "MODIFIED_GROSS" | "BASE_YEAR" | "OTHER"
): CREStructuredPayload => ({
  termType: "BASE_RENT",
  rent: { kind: "simple", amountPerRSFYear: amount, ...(rentStructure ? { rentStructure } : {}) },
});

const steppedRent = (
  steps: Array<[number, number, number]>, // [startMonth, endMonth, amount]
  rentStructure?: "NNN"
): CREStructuredPayload => ({
  termType: "BASE_RENT",
  rent: {
    kind: "stepped",
    steps: steps.map(([start, end, amount]) => ({
      startMonth: start!,
      endMonth: end!,
      amountPerRSFYear: amount!,
      // No observationRef — it will be attached by the resolver
    })),
    ...(rentStructure ? { rentStructure } : {}),
  },
});

const contiguousFreeRent = (
  months: number,
  abatementType: "FULL" | "PARTIAL" = "FULL",
  partialPct?: number,
  scope: "BASE_RENT_ONLY" | "ALL_CHARGES" | null = "BASE_RENT_ONLY"
): CREStructuredPayload => ({
  termType: "FREE_RENT",
  abatement: {
    kind: "contiguous",
    months,
    abatementType,
    ...(partialPct !== undefined ? { partialPct } : {}),
  },
  scope,
});

const irregularFreeRent = (
  periods: Array<[number, number, "FULL" | "PARTIAL", number?]>, // [start, end, type, pct?]
  scope: "BASE_RENT_ONLY" | "ALL_CHARGES" | null = "BASE_RENT_ONLY"
): CREStructuredPayload => ({
  termType: "FREE_RENT",
  abatement: {
    kind: "irregular",
    periods: periods.map(([start, end, type, pct]) => ({
      startMonth: start!,
      endMonth: end!,
      abatementType: type!,
      ...(pct !== undefined ? { partialPct: pct } : {}),
      // No observationRef — resolver attaches real ID
    })),
    equivalentFullMonths: periods
      .filter(([, , type]) => type === "FULL")
      .reduce((sum, [start, end]) => sum + (end! - start! + 1), 0),
  },
  scope,
});

const tiAllowance = (
  amount: number,
  conditions: string[] = []
): CREStructuredPayload => ({
  termType: "TI_ALLOWANCE",
  amount: { amount, unit: "USD_PER_RSF_YEAR" },
  conditions,
  drawDeadline: null,
  unusedConversion: null,
});

const renewalOptions = (
  opts: Array<{ durationMonths: number; pricingMethod: "FAIR_MARKET_RENT" | "FIXED_RATE" | "PERCENT_OF_THEN_CURRENT" | "LESSER_OF_FMR_AND_FIXED" | "OTHER"; pricingValue?: number }>
): CREStructuredPayload => ({
  termType: "RENEWAL_OPTIONS",
  options: opts.map((o, i) => ({
    optionNumber: i + 1,
    durationMonths: o.durationMonths,
    pricingMethod: o.pricingMethod,
    ...(o.pricingValue !== undefined ? { pricingValue: o.pricingValue } : {}),
    conditions: [],
  })),
  personal: null,
});

const terminationRight = (
  eligibleAfterYear: number,
  noticeMonths: number
): CREStructuredPayload => ({
  termType: "TERMINATION_RIGHTS",
  right: {
    eligibleAfterYear,
    eligibleAfterMonth: null,
    noticeMonths,
    terminationFee: { kind: "unamortized_costs", description: "unamortized TI and commissions" },
    conditions: [],
  },
});

const parking = (
  spacesCount: number,
  ratePerSpacePerMonth: number
): CREStructuredPayload => ({
  termType: "PARKING",
  spacesCount,
  spacesRatio: null,
  ratePerSpacePerMonth,
  rateType: "FIXED",
  reserved: null,
  conditions: [],
});

const opEx = (controllableCapPct: number, taxesInsuranceUncapped = false): CREStructuredPayload => ({
  termType: "OPERATING_EXPENSES",
  structure: "NNN",
  baseYear: null,
  controllableCapPct,
  taxesInsuranceUncapped,
  exclusions: [],
  managementFeePct: null,
});

const annualEscalation = (pct: number): CREStructuredPayload => ({
  termType: "ANNUAL_ESCALATION",
  escalation: { kind: "percent", pct },
  firstEscalationMonth: null,
  frequency: "ANNUAL",
});

const expansionRight = (rightKind: "EXPANSION" | "ROFO" | "ROFR"): CREStructuredPayload => ({
  termType: "EXPANSION_RIGHTS",
  rightKind,
  applicableSpace: "contiguous space on same floor",
  trigger: "upon availability",
  noticeMonths: 3,
  pricingMethod: "FAIR_MARKET_RENT",
  conditions: [],
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assertNoConflict(result: ReturnType<typeof resolveStructuredState>) {
  assert.ok(!result.tenant || !isSideConflict(result.tenant), "Tenant must not be a conflict");
  assert.ok(!result.landlord || !isSideConflict(result.landlord), "Landlord must not be a conflict");
}

function assertPosition(
  sideResult: ReturnType<typeof resolveStructuredState>["tenant"],
  label: string
) {
  assert.ok(sideResult, `${label} position must be present`);
  assert.ok(!isSideConflict(sideResult!), `${label} must not be a CONFLICT`);
  return sideResult as Exclude<typeof sideResult, { status: "CONFLICT" }>;
}

// ─── A. Simple scalar carry-forward ──────────────────────────────────────────

test("A. simple scalar carry-forward — TI position persists when not re-stated", () => {
  const tiTerm = makeTerm("TI_ALLOWANCE", "TENANT", 1, tiAllowance(110));
  const rentTerm = makeTerm("BASE_RENT", "TENANT", 2, simpleRent(67));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tiTerm]),
    makeRound("TENANT", 2, 8, [rentTerm]), // no TI mentioned in Round 2
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "TI_ALLOWANCE" });

  assert.equal(result.status, "PROPOSED");
  const pos = assertPosition(result.tenant, "Tenant");
  assert.equal(pos.payload.termType, "TI_ALLOWANCE");
  if (pos.payload.termType === "TI_ALLOWANCE") {
    assert.equal(pos.payload.amount.amount, 110, "Carry-forward: TI=$110 persists");
  }
  assert.ok(pos.observationIds.includes(tiTerm.id), "Provenance must reference Round 1 TI term");
});

// ─── B. Simple rent superseded by stepped rent ───────────────────────────────

test("B. simple rent superseded by stepped rent in later round", () => {
  const simpleT = makeTerm("BASE_RENT", "TENANT", 1, simpleRent(60));
  const steppedT = makeTerm("BASE_RENT", "TENANT", 2, steppedRent([[1, 24, 64], [25, 60, 66]]));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [simpleT]),
    makeRound("TENANT", 2, 8, [steppedT]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  assert.equal(result.status, "PROPOSED");
  const pos = assertPosition(result.tenant, "Tenant");
  assert.equal(pos.payload.termType, "BASE_RENT");
  if (pos.payload.termType === "BASE_RENT") {
    assert.equal(pos.payload.rent.kind, "stepped", "Must be stepped, not simple");
    if (pos.payload.rent.kind === "stepped") {
      assert.equal(pos.payload.rent.steps.length, 2);
      assert.equal(pos.payload.rent.steps[0]!.startMonth, 1);
      assert.equal(pos.payload.rent.steps[0]!.endMonth, 24);
      assert.equal(pos.payload.rent.steps[0]!.amountPerRSFYear, 64);
      assert.equal(pos.payload.rent.steps[1]!.startMonth, 25);
      assert.equal(pos.payload.rent.steps[1]!.endMonth, 60);
      assert.equal(pos.payload.rent.steps[1]!.amountPerRSFYear, 66);
    }
  }
  assert.ok(pos.observationIds.includes(steppedT.id), "Must reference Round 2 stepped term");
  assert.ok(!pos.observationIds.includes(simpleT.id), "Must NOT reference superseded Round 1 term");
});

// ─── C. Stepped rent superseded by different stepped rent ────────────────────

test("C. stepped rent superseded by different stepped rent in later round", () => {
  const t1 = makeTerm("BASE_RENT", "TENANT", 1, steppedRent([[1, 24, 60], [25, 60, 64]]));
  const t2 = makeTerm("BASE_RENT", "TENANT", 2, steppedRent([[1, 24, 64], [25, 60, 66]]));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [t1]),
    makeRound("TENANT", 2, 8, [t2]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });
  const pos = assertPosition(result.tenant, "Tenant");

  if (pos.payload.termType === "BASE_RENT" && pos.payload.rent.kind === "stepped") {
    assert.equal(pos.payload.rent.steps[0]!.amountPerRSFYear, 64, "Round 2 step 1 rate");
    assert.equal(pos.payload.rent.steps[1]!.amountPerRSFYear, 66, "Round 2 step 2 rate");
  } else {
    assert.fail("Expected stepped rent from Round 2");
  }
  assert.ok(pos.observationIds.includes(t2.id), "Must reference Round 2");
  assert.ok(!pos.observationIds.includes(t1.id), "Must NOT reference superseded Round 1");
});

// ─── D. Omitted rent carries forward ─────────────────────────────────────────

test("D. omitted BASE_RENT in later round carries forward from earlier round", () => {
  const rentTerm = makeTerm("BASE_RENT", "TENANT", 1, simpleRent(65));
  const tiTerm = makeTerm("TI_ALLOWANCE", "TENANT", 2, tiAllowance(110)); // Round 2 only changes TI

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [rentTerm]),
    makeRound("TENANT", 2, 8, [tiTerm]), // no BASE_RENT in Round 2
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  assert.equal(result.status, "PROPOSED");
  const pos = assertPosition(result.tenant, "Tenant");
  if (pos.payload.termType === "BASE_RENT") {
    assert.equal(pos.payload.rent.kind, "simple");
    if (pos.payload.rent.kind === "simple") {
      assert.equal(pos.payload.rent.amountPerRSFYear, 65, "Carry-forward: $65 from Round 1");
    }
  }
});

// ─── E. Irregular free-rent periods preserved ─────────────────────────────────

test("E. irregular free-rent — months 1-3 and 7-9 remain two distinct periods", () => {
  const freeRentTerm = makeTerm(
    "FREE_RENT",
    "TENANT",
    1,
    irregularFreeRent([[1, 3, "FULL"], [7, 9, "FULL"]])
  );

  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [freeRentTerm])];

  const result = resolveStructuredState({ rounds, canonicalType: "FREE_RENT" });
  const pos = assertPosition(result.tenant, "Tenant");

  assert.equal(pos.payload.termType, "FREE_RENT");
  if (pos.payload.termType === "FREE_RENT") {
    const ab = pos.payload.abatement;
    assert.equal(ab.kind, "irregular", "Must be irregular, not contiguous");
    if (ab.kind === "irregular") {
      assert.equal(ab.periods.length, 2, "Two non-contiguous periods must be preserved");
      assert.equal(ab.periods[0]!.startMonth, 1);
      assert.equal(ab.periods[0]!.endMonth, 3);
      assert.equal(ab.periods[1]!.startMonth, 7);
      assert.equal(ab.periods[1]!.endMonth, 9);
      assert.equal(ab.equivalentFullMonths, 6, "Derived summary = 6 months");
    }
  }
  // Do NOT collapse to a single numeric
  assert.ok(pos.observationIds.includes(freeRentTerm.id));
});

// ─── F. Partial abatement preserved ──────────────────────────────────────────

test("F. partial abatement — 50% abatement for months 1-6 is preserved", () => {
  const term = makeTerm(
    "FREE_RENT",
    "TENANT",
    1,
    contiguousFreeRent(6, "PARTIAL", 50)
  );
  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [term])];

  const result = resolveStructuredState({ rounds, canonicalType: "FREE_RENT" });
  const pos = assertPosition(result.tenant, "Tenant");

  if (pos.payload.termType === "FREE_RENT") {
    const ab = pos.payload.abatement;
    assert.equal(ab.kind, "contiguous");
    if (ab.kind === "contiguous") {
      assert.equal(ab.abatementType, "PARTIAL");
      assert.equal(ab.partialPct, 50);
      assert.equal(ab.months, 6);
    }
  }
});

// ─── G. Renewal right replaced atomically ─────────────────────────────────────

test("G. renewal right replaced atomically — newer proposal replaces prior as a whole", () => {
  // Round 1: two 5-year options at FMR
  const r1 = makeTerm(
    "RENEWAL_OPTIONS",
    "TENANT",
    1,
    renewalOptions([
      { durationMonths: 60, pricingMethod: "FAIR_MARKET_RENT" },
      { durationMonths: 60, pricingMethod: "FAIR_MARKET_RENT" },
    ])
  );
  // Round 2: one 5-year option at FMR (tenant conceded one option)
  const r2 = makeTerm(
    "RENEWAL_OPTIONS",
    "TENANT",
    2,
    renewalOptions([{ durationMonths: 60, pricingMethod: "FAIR_MARKET_RENT" }])
  );

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [r1]),
    makeRound("TENANT", 2, 8, [r2]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "RENEWAL_OPTIONS" });
  const pos = assertPosition(result.tenant, "Tenant");

  assert.equal(pos.payload.termType, "RENEWAL_OPTIONS");
  if (pos.payload.termType === "RENEWAL_OPTIONS") {
    assert.equal(pos.payload.options.length, 1, "Round 2 atomically replaced: 1 option");
  }
  assert.ok(!pos.observationIds.includes(r1.id), "Round 1 right must not appear in provenance");
});

// ─── H. Termination right replaced atomically ────────────────────────────────

test("H. termination right replaced atomically — notice months not mixed across rounds", () => {
  // Round 1: year 7, 12-month notice
  const r1 = makeTerm("TERMINATION_RIGHTS", "TENANT", 1, terminationRight(7, 12));
  // Round 2: year 8, 9-month notice (completely new proposal)
  const r2 = makeTerm("TERMINATION_RIGHTS", "TENANT", 2, terminationRight(8, 9));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [r1]),
    makeRound("TENANT", 2, 8, [r2]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "TERMINATION_RIGHTS" });
  const pos = assertPosition(result.tenant, "Tenant");

  assert.equal(pos.payload.termType, "TERMINATION_RIGHTS");
  if (pos.payload.termType === "TERMINATION_RIGHTS" && pos.payload.right) {
    // Must be the Round 2 right as a whole — NOT year 8 + old 12-month notice
    assert.equal(pos.payload.right.eligibleAfterYear, 8, "Year must be from Round 2");
    assert.equal(pos.payload.right.noticeMonths, 9, "Notice must be from Round 2, not Round 1");
  } else {
    assert.fail("Expected a non-null termination right from Round 2");
  }
  assert.ok(pos.observationIds.includes(r2.id));
  assert.ok(!pos.observationIds.includes(r1.id));
});

// ─── I. Parking count + rate stay together ────────────────────────────────────

test("I. parking — spacesCount and ratePerSpacePerMonth resolve together in one payload", () => {
  const term = makeTerm("PARKING", "TENANT", 1, parking(20, 350));
  const landlordTerm = makeTerm("PARKING", "LANDLORD", 1, parking(15, 300));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [term]),
    makeRound("LANDLORD", 1, 8, [landlordTerm]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "PARKING" });
  assertNoConflict(result);

  const tPos = assertPosition(result.tenant, "Tenant");
  if (tPos.payload.termType === "PARKING") {
    // Count and rate must not be separated
    assert.equal(tPos.payload.spacesCount, 20);
    assert.equal(tPos.payload.ratePerSpacePerMonth, 350);
    assert.equal(tPos.payload.rateType, "FIXED");
  }

  const lPos = assertPosition(result.landlord, "Landlord");
  if (lPos.payload.termType === "PARKING") {
    assert.equal(lPos.payload.spacesCount, 15);
    assert.equal(lPos.payload.ratePerSpacePerMonth, 300);
  }
});

// ─── J. Operating-expense cap resolution ─────────────────────────────────────

test("J. operating-expense cap — tenant 5% vs landlord 7% (taxes uncapped) resolved separately", () => {
  const tTerm = makeTerm("OPERATING_EXPENSES", "TENANT", 1, opEx(5, false));
  const lTerm = makeTerm("OPERATING_EXPENSES", "LANDLORD", 1, opEx(7, true));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tTerm]),
    makeRound("LANDLORD", 1, 8, [lTerm]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "OPERATING_EXPENSES" });

  assert.equal(result.status, "UNRESOLVED");

  const tPos = assertPosition(result.tenant, "Tenant");
  if (tPos.payload.termType === "OPERATING_EXPENSES") {
    assert.equal(tPos.payload.controllableCapPct, 5);
    assert.equal(tPos.payload.taxesInsuranceUncapped, false);
  }

  const lPos = assertPosition(result.landlord, "Landlord");
  if (lPos.payload.termType === "OPERATING_EXPENSES") {
    assert.equal(lPos.payload.controllableCapPct, 7);
    assert.equal(lPos.payload.taxesInsuranceUncapped, true);
  }
});

// ─── K. Annual escalation resolution ─────────────────────────────────────────

test("K. annual escalation — tenant 2% vs landlord 3.5% resolved separately", () => {
  const tTerm = makeTerm("ANNUAL_ESCALATION", "TENANT", 1, annualEscalation(2));
  const lTerm = makeTerm("ANNUAL_ESCALATION", "LANDLORD", 1, annualEscalation(3.5));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tTerm]),
    makeRound("LANDLORD", 1, 8, [lTerm]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "ANNUAL_ESCALATION" });
  assert.equal(result.status, "UNRESOLVED");

  const tPos = assertPosition(result.tenant, "Tenant");
  if (tPos.payload.termType === "ANNUAL_ESCALATION") {
    const esc = tPos.payload.escalation;
    assert.equal(esc.kind, "percent");
    if (esc.kind === "percent") assert.equal(esc.pct, 2);
  }

  const lPos = assertPosition(result.landlord, "Landlord");
  if (lPos.payload.termType === "ANNUAL_ESCALATION") {
    const esc = lPos.payload.escalation;
    assert.equal(esc.kind, "percent");
    if (esc.kind === "percent") assert.equal(esc.pct, 3.5);
  }
});

// ─── L. Expansion right resolution ───────────────────────────────────────────

test("L. expansion right — ROFO proposed by tenant, landlord has not responded", () => {
  const term = makeTerm("EXPANSION_RIGHTS", "TENANT", 1, expansionRight("ROFO"));
  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [term])];

  const result = resolveStructuredState({ rounds, canonicalType: "EXPANSION_RIGHTS" });
  assert.equal(result.status, "PROPOSED");

  const pos = assertPosition(result.tenant, "Tenant");
  assert.equal(pos.payload.termType, "EXPANSION_RIGHTS");
  if (pos.payload.termType === "EXPANSION_RIGHTS") {
    assert.equal(pos.payload.rightKind, "ROFO");
    assert.equal(pos.payload.pricingMethod, "FAIR_MARKET_RENT");
  }
  assert.equal(result.landlord, undefined);
});

// ─── M. Rejected proposal not current ────────────────────────────────────────

test("M. rejected termination right is not the current landlord position", () => {
  // Tenant proposes
  const tTerm = makeTerm("TERMINATION_RIGHTS", "TENANT", 1, terminationRight(5, 9));
  // Landlord rejects
  const lTerm = makeTerm(
    "TERMINATION_RIGHTS",
    "LANDLORD",
    1,
    null, // no structured payload for a rejection
    { status: "REJECTED" }
  );

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tTerm]),
    makeRound("LANDLORD", 1, 8, [lTerm]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "TERMINATION_RIGHTS" });

  // REJECTED status propagates from the latest overall observation
  assert.equal(result.status, "REJECTED");

  // Landlord has no structured position (REJECTED is excluded from current positions)
  assert.equal(result.landlord, undefined, "Rejected obs must not appear as current landlord position");
});

// ─── N. Withdrawn proposal not current ───────────────────────────────────────

test("N. withdrawn expansion right clears tenant's current position", () => {
  const r1 = makeTerm("EXPANSION_RIGHTS", "TENANT", 1, expansionRight("ROFO"));
  const r2 = makeTerm(
    "EXPANSION_RIGHTS",
    "TENANT",
    2,
    null,
    { status: "WITHDRAWN" }
  );

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [r1]),
    makeRound("TENANT", 2, 8, [r2]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "EXPANSION_RIGHTS" });

  assert.equal(result.status, "WITHDRAWN");
  assert.equal(result.tenant, undefined, "Withdrawn term must clear tenant position");
  // Historical observation still in sourceObservationIds
  assert.ok(result.sourceObservationIds.includes(r1.id));
  assert.ok(result.sourceObservationIds.includes(r2.id));
});

// ─── O. Unilateral amendment does not create agreement ───────────────────────

test("O. matching values on separate sides do not automatically create agreement", () => {
  // Both independently propose $65 — but neither explicitly agreed
  const tTerm = makeTerm("BASE_RENT", "TENANT", 1, simpleRent(65));
  const lTerm = makeTerm("BASE_RENT", "LANDLORD", 1, simpleRent(65));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tTerm]),
    makeRound("LANDLORD", 1, 8, [lTerm]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  // Matching values ≠ agreement without explicit assent evidence
  assert.notEqual(result.status, "AGREED", "Matching values alone must not create agreement");
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.agreed, undefined);
});

// ─── P. Explicit agreement resolves AGREED state ─────────────────────────────

test("P. explicit AGREED status on latest observation resolves AGREED state", () => {
  const t1 = makeTerm("TI_ALLOWANCE", "TENANT", 1, tiAllowance(110));
  const l1 = makeTerm("TI_ALLOWANCE", "LANDLORD", 1, tiAllowance(100));
  // Both agree on $105 in Round 2
  const t2 = makeTerm(
    "TI_ALLOWANCE",
    "TENANT",
    2,
    tiAllowance(105),
    { status: "AGREED" }
  );

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [t1]),
    makeRound("LANDLORD", 1, 8, [l1]),
    makeRound("TENANT", 2, 15, [t2]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "TI_ALLOWANCE" });

  assert.equal(result.status, "AGREED");
  assert.ok(result.agreed, "agreed field must be present");
  if (result.agreed?.payload.termType === "TI_ALLOWANCE") {
    assert.equal(result.agreed.payload.amount.amount, 105);
  }
  assert.ok(result.agreed?.observationIds.includes(t2.id));
});

// ─── Q. Contradictory same-side/same-round rent creates CONFLICT ─────────────

test("Q. two contradictory BASE_RENT proposals in same round → CONFLICT", () => {
  // Same side, same round, same period, different amounts — n13-style
  const termA = makeTerm("BASE_RENT", "TENANT", 1, simpleRent(65), { id: "term-n13-A" });
  const termB = makeTerm("BASE_RENT", "TENANT", 1, simpleRent(67), { id: "term-n13-B" });

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [termA, termB]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  assert.equal(result.status, "UNRESOLVED");
  assert.ok(result.tenant, "Tenant position must be present");
  assert.ok(isSideConflict(result.tenant!), "Tenant must be a CONFLICT");

  if (isSideConflict(result.tenant!)) {
    assert.equal(result.tenant!.candidates.length, 2, "Both candidates must be surfaced");
    const amounts = result.tenant!.candidates.map((c) => {
      if (c.payload.termType === "BASE_RENT" && c.payload.rent.kind === "simple") {
        return c.payload.rent.amountPerRSFYear;
      }
      return null;
    });
    assert.ok(amounts.includes(65), "Candidate 1: $65");
    assert.ok(amounts.includes(67), "Candidate 2: $67");
  }
});

// ─── R. Provenance uses real NegotiationTerm IDs ─────────────────────────────

test("R. all provenance IDs in the resolved state are real term IDs", () => {
  const tenantId = "real-term-tenant-001";
  const landlordId = "real-term-landlord-001";

  const tTerm = makeTerm("TI_ALLOWANCE", "TENANT", 1, tiAllowance(115), { id: tenantId });
  const lTerm = makeTerm("TI_ALLOWANCE", "LANDLORD", 1, tiAllowance(95), { id: landlordId });

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tTerm]),
    makeRound("LANDLORD", 1, 8, [lTerm]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "TI_ALLOWANCE" });

  // All IDs in the resolved state must be the real term IDs
  const allIds = [
    ...result.sourceObservationIds,
    ...(result.tenant && !isSideConflict(result.tenant) ? result.tenant.observationIds : []),
    ...(result.landlord && !isSideConflict(result.landlord) ? result.landlord.observationIds : []),
  ];

  for (const id of allIds) {
    assert.ok(
      id === tenantId || id === landlordId,
      `ID "${id}" must be one of the real term IDs`
    );
    assert.notEqual(id, "pending", 'Provenance must never contain "pending"');
  }
});

// ─── S. Legacy null structuredPayload is ignored safely ──────────────────────

test("S. legacy null structuredPayload — resolver handles gracefully, no crash", () => {
  // Terms with no structuredPayload (legacy rows)
  const tTerm = makeTerm("BASE_RENT", "TENANT", 1, null, { normalizedNumeric: 65 });
  const lTerm = makeTerm("BASE_RENT", "LANDLORD", 1, null, { normalizedNumeric: 70 });

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tTerm]),
    makeRound("LANDLORD", 1, 8, [lTerm]),
  ];

  // Must not throw
  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  // Graceful degradation: no structured positions (payloads are null)
  // but resolver still returns a valid result with status information
  assert.ok(result, "Result must be non-null");
  assert.equal(result.canonicalType, "BASE_RENT");
  // With null payloads, tenant and landlord structured positions are undefined
  assert.equal(result.tenant, undefined, "No structured tenant position when payload is null");
  assert.equal(result.landlord, undefined, "No structured landlord position when payload is null");
  // Source IDs still tracked from the observations
  assert.ok(result.sourceObservationIds.includes(tTerm.id));
  assert.ok(result.sourceObservationIds.includes(lTerm.id));
});

// ─── T. Malformed payload is ignored safely ───────────────────────────────────

test("T. malformed structuredPayload — resolver parses defensively, no crash", () => {
  // Inject a malformed payload (Zod validation will reject it)
  const malformedTerm: TermWithPayload = {
    id: "term-malformed",
    canonicalType: "BASE_RENT",
    normalizedValue: "$65",
    normalizedNumeric: 65,
    normalizedUnit: "USD_PER_RSF_YEAR",
    rawValue: "raw",
    status: "PROPOSED",
    side: "TENANT",
    roundNumber: 1,
    confidence: 0.95,
    evidenceQuote: "quote",
    sourceLocation: null,
    // Invalid: steps must be an array with ≥2 entries; "invalid" is not an array
    structuredPayload: {
      termType: "BASE_RENT",
      rent: { kind: "stepped", steps: "not-an-array" },
    } as unknown as CREStructuredPayload,
  };

  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [malformedTerm])];

  // Must not throw
  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  assert.ok(result, "Result must be non-null even with malformed payload");
  // Malformed payload degrades to no structured position
  assert.equal(result.tenant, undefined, "Malformed payload must be ignored");
  // Source ID still tracked
  assert.ok(result.sourceObservationIds.includes("term-malformed"));
});

// ─── U. Legacy "pending" observationRef does not leak into resolved provenance ─

test("U. legacy pending observationRef in payload — real term ID used in output", () => {
  const realId = "term-real-id-xyz";

  // Payload with "pending" observationId in steps (as the model would have written)
  const payloadWithPending: CREStructuredPayload = {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: [
        {
          startMonth: 1,
          endMonth: 24,
          amountPerRSFYear: 65,
          observationRef: { observationId: "pending" },
        },
        {
          startMonth: 25,
          endMonth: 60,
          amountPerRSFYear: 68,
          observationRef: { observationId: "pending" },
        },
      ],
    },
  };

  const term = makeTerm("BASE_RENT", "TENANT", 1, payloadWithPending, { id: realId });
  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [term])];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  const pos = assertPosition(result.tenant, "Tenant");

  // The resolved observationIds must use the real term ID
  assert.ok(
    pos.observationIds.every((id) => id !== "pending"),
    'observationIds must not contain "pending"'
  );
  assert.ok(pos.observationIds.includes(realId), "Must reference the real term ID");

  // The steps' internal observationRefs must also use the real ID
  if (pos.payload.termType === "BASE_RENT" && pos.payload.rent.kind === "stepped") {
    for (const step of pos.payload.rent.steps) {
      assert.notEqual(
        step.observationRef?.observationId,
        "pending",
        `Step observationRef must not be "pending"`
      );
      assert.equal(
        step.observationRef?.observationId,
        realId,
        "Step observationRef must be the real term ID"
      );
    }
  }

  // sourceObservationIds must also not contain "pending"
  assert.ok(
    result.sourceObservationIds.every((id) => id !== "pending"),
    'sourceObservationIds must not contain "pending"'
  );
});

// ─── V. No input observation is mutated ───────────────────────────────────────

test("V. resolver does not mutate any input observation", () => {
  const payload: CREStructuredPayload = {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: [
        {
          startMonth: 1,
          endMonth: 24,
          amountPerRSFYear: 65,
          observationRef: { observationId: "pending" },
        },
        {
          startMonth: 25,
          endMonth: 60,
          amountPerRSFYear: 68,
          observationRef: { observationId: "pending" },
        },
      ],
    },
  };

  // Deep-clone the input before passing to the resolver
  const originalPayloadJson = JSON.stringify(payload);
  const term = makeTerm("BASE_RENT", "TENANT", 1, payload);

  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [term])];

  // Run the resolver
  resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  // Verify the input payload was not mutated
  assert.equal(
    JSON.stringify(payload),
    originalPayloadJson,
    "The input CREStructuredPayload must not be mutated"
  );

  // Verify the step observationRefs were not mutated
  if (payload.termType === "BASE_RENT" && payload.rent.kind === "stepped") {
    assert.equal(
      payload.rent.steps[0]!.observationRef?.observationId,
      "pending",
      'Input step.observationRef.observationId must still be "pending" (not mutated)'
    );
  }

  // Verify the term's structuredPayload reference is unchanged
  assert.strictEqual(
    term.structuredPayload,
    payload,
    "term.structuredPayload reference must not be replaced"
  );
});

// ─── REGRESSION: n07 — stepped rent ─────────────────────────────────────────

test("n07 regression — multiple step observations each carrying full schedule are deduplicated", () => {
  // The n07 scenario: document describes a 3-step rent schedule.
  // The extraction model emits 3 separate BASE_RENT observations (one per step),
  // each carrying the FULL schedule in its structuredPayload.
  const fullSchedule: CREStructuredPayload = steppedRent(
    [[1, 24, 55], [25, 48, 58], [49, 60, 62]],
    "NNN"
  );

  const obs1 = makeTerm("BASE_RENT", "TENANT", 1, fullSchedule, { id: "n07-step1" });
  const obs2 = makeTerm("BASE_RENT", "TENANT", 1, fullSchedule, { id: "n07-step2" });
  const obs3 = makeTerm("BASE_RENT", "TENANT", 1, fullSchedule, { id: "n07-step3" });

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [obs1, obs2, obs3]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  assert.equal(result.status, "PROPOSED");
  // Must not be a conflict — all 3 obs have the same schedule
  assert.ok(result.tenant, "Tenant position must be present");
  assert.ok(!isSideConflict(result.tenant!), "Must not be CONFLICT for identical schedules");

  const pos = result.tenant as ResolvedSidePosition;
  assert.equal(pos.payload.termType, "BASE_RENT");
  if (pos.payload.termType === "BASE_RENT") {
    assert.equal(pos.payload.rent.kind, "stepped", "Must resolve as stepped, not scalar");
    if (pos.payload.rent.kind === "stepped") {
      assert.equal(pos.payload.rent.steps.length, 3, "All 3 steps must be preserved");
      assert.equal(pos.payload.rent.steps[0]!.startMonth, 1);
      assert.equal(pos.payload.rent.steps[0]!.endMonth, 24);
      assert.equal(pos.payload.rent.steps[0]!.amountPerRSFYear, 55);
      assert.equal(pos.payload.rent.steps[1]!.startMonth, 25);
      assert.equal(pos.payload.rent.steps[1]!.endMonth, 48);
      assert.equal(pos.payload.rent.steps[1]!.amountPerRSFYear, 58);
      assert.equal(pos.payload.rent.steps[2]!.startMonth, 49);
      assert.equal(pos.payload.rent.steps[2]!.endMonth, 60);
      assert.equal(pos.payload.rent.steps[2]!.amountPerRSFYear, 62);
    }
  }

  // All 3 source observation IDs must appear in provenance
  assert.ok(pos.observationIds.includes("n07-step1"));
  assert.ok(pos.observationIds.includes("n07-step2"));
  assert.ok(pos.observationIds.includes("n07-step3"));
});

// Local alias to avoid TypeScript complaints about the imported interface name
type ResolvedSidePosition = Exclude<ReturnType<typeof resolveStructuredState>["tenant"], { status: "CONFLICT" } | undefined>;

test("n07 regression — stepped rent carries forward when landlord later counter with simple rent", () => {
  const tenantStepped: CREStructuredPayload = steppedRent(
    [[1, 24, 55], [25, 48, 58], [49, 60, 62]]
  );
  const landlordSimple: CREStructuredPayload = simpleRent(72);

  const tObs = makeTerm("BASE_RENT", "TENANT", 1, tenantStepped);
  const lObs = makeTerm("BASE_RENT", "LANDLORD", 1, landlordSimple);

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [tObs]),
    makeRound("LANDLORD", 1, 8, [lObs]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  assert.equal(result.status, "UNRESOLVED");

  // Tenant's stepped schedule must be preserved
  const tPos = assertPosition(result.tenant, "Tenant");
  if (tPos.payload.termType === "BASE_RENT") {
    assert.equal(tPos.payload.rent.kind, "stepped", "Tenant's stepped rent must be preserved");
  }

  // Landlord's simple rent must be separate
  const lPos = assertPosition(result.landlord, "Landlord");
  if (lPos.payload.termType === "BASE_RENT") {
    assert.equal(lPos.payload.rent.kind, "simple", "Landlord's simple rent must be preserved");
    if (lPos.payload.rent.kind === "simple") {
      assert.equal(lPos.payload.rent.amountPerRSFYear, 72);
    }
  }
});

// ─── REGRESSION: n09 — irregular free rent ───────────────────────────────────

test("n09 regression — non-contiguous abatement periods preserved as IrregularFreeRent", () => {
  // n09: Tenant gets free rent in months 1-3 AND months 7-9 (non-contiguous).
  // Old flat model would collapse this to normalizedNumeric = 6 (total months),
  // losing the non-contiguous structure.
  const payload = irregularFreeRent([[1, 3, "FULL"], [7, 9, "FULL"]]);
  const term = makeTerm("FREE_RENT", "TENANT", 1, payload, { id: "n09-term" });

  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [term])];

  const result = resolveStructuredState({ rounds, canonicalType: "FREE_RENT" });

  assert.equal(result.status, "PROPOSED");
  const pos = assertPosition(result.tenant, "Tenant");

  assert.equal(pos.payload.termType, "FREE_RENT");
  if (pos.payload.termType === "FREE_RENT") {
    const ab = pos.payload.abatement;
    // MUST be irregular — "6 months" is not acceptable
    assert.equal(ab.kind, "irregular", "n09: must be irregular, not contiguous");
    if (ab.kind === "irregular") {
      assert.equal(ab.periods.length, 2, "Both non-contiguous periods must be preserved");

      // Period 1: months 1–3
      assert.equal(ab.periods[0]!.startMonth, 1);
      assert.equal(ab.periods[0]!.endMonth, 3);
      assert.equal(ab.periods[0]!.abatementType, "FULL");

      // Period 2: months 7–9 (gap between 3 and 7 is NOT abated)
      assert.equal(ab.periods[1]!.startMonth, 7);
      assert.equal(ab.periods[1]!.endMonth, 9);
      assert.equal(ab.periods[1]!.abatementType, "FULL");

      // Derived summary (must not replace the actual periods)
      assert.equal(ab.equivalentFullMonths, 6);
    }
  }
});

test("n09 regression — irregular free rent carries forward when tenant later changes only rent", () => {
  const freeRentPayload = irregularFreeRent([[1, 3, "FULL"], [7, 9, "FULL"]]);
  const freeRentTerm = makeTerm("FREE_RENT", "TENANT", 1, freeRentPayload);
  const rentTerm = makeTerm("BASE_RENT", "TENANT", 2, simpleRent(67));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [freeRentTerm]),
    makeRound("TENANT", 2, 8, [rentTerm]), // Round 2 only changes BASE_RENT
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "FREE_RENT" });

  // Free rent must carry forward unchanged from Round 1
  const pos = assertPosition(result.tenant, "Tenant");
  if (pos.payload.termType === "FREE_RENT") {
    const ab = pos.payload.abatement;
    assert.equal(ab.kind, "irregular", "Irregular free rent must carry forward");
    if (ab.kind === "irregular") {
      assert.equal(ab.periods.length, 2);
    }
  }
});

// ─── REGRESSION: n13 — contradictory draft ───────────────────────────────────

test("n13 regression — contradictory rent alternatives in same document → CONFLICT with both candidates", () => {
  // n13: A single document contains two contradictory draft clauses.
  // The model emits two UNRESOLVED (or PROPOSED) BASE_RENT observations from
  // the same side and round, with different rates for the same period.
  const termA = makeTerm(
    "BASE_RENT",
    "LANDLORD",
    1,
    simpleRent(65),
    { id: "n13-alt-A", status: "UNRESOLVED" }
  );
  const termB = makeTerm(
    "BASE_RENT",
    "LANDLORD",
    1,
    simpleRent(68),
    { id: "n13-alt-B", status: "UNRESOLVED" }
  );

  const rounds: RoundWithPayload[] = [
    makeRound("LANDLORD", 1, 1, [termA, termB]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  // Overall status: UNRESOLVED (within-round conflict)
  assert.equal(result.status, "UNRESOLVED");

  // Landlord position must be a CONFLICT, not a single selected value
  assert.ok(result.landlord, "Landlord position must be present");
  assert.ok(
    isSideConflict(result.landlord!),
    "n13: Landlord must be a CONFLICT, not a single selected value"
  );

  if (isSideConflict(result.landlord!)) {
    const { candidates } = result.landlord!;
    assert.equal(candidates.length, 2, "Both contradictory candidates must be surfaced");

    // Verify both amounts are present
    const amounts = candidates.map((c) => {
      if (c.payload.termType === "BASE_RENT" && c.payload.rent.kind === "simple") {
        return c.payload.rent.amountPerRSFYear;
      }
      return null;
    });
    assert.ok(amounts.includes(65), "Candidate A ($65) must be present");
    assert.ok(amounts.includes(68), "Candidate B ($68) must be present");

    // Each candidate must reference its source observation
    const allCandidateIds = candidates.flatMap((c) => c.observationIds);
    assert.ok(allCandidateIds.includes("n13-alt-A"));
    assert.ok(allCandidateIds.includes("n13-alt-B"));
  }
});

test("n13 regression — contradictory stepped rent alternatives create CONFLICT", () => {
  // Two stepped schedules with different rates for overlapping periods
  const scheduleA: CREStructuredPayload = steppedRent([[1, 24, 65], [25, 60, 68]]);
  const scheduleB: CREStructuredPayload = steppedRent([[1, 24, 67], [25, 60, 70]]);

  const termA = makeTerm("BASE_RENT", "LANDLORD", 1, scheduleA, { id: "n13-step-A" });
  const termB = makeTerm("BASE_RENT", "LANDLORD", 1, scheduleB, { id: "n13-step-B" });

  const rounds: RoundWithPayload[] = [
    makeRound("LANDLORD", 1, 1, [termA, termB]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  assert.ok(isSideConflict(result.landlord!), "Contradictory stepped schedules must be CONFLICT");

  if (isSideConflict(result.landlord!)) {
    assert.equal(result.landlord!.candidates.length, 2);
  }
});

// ─── Additional edge cases ────────────────────────────────────────────────────

test("side-specific positions: tenant and landlord are independent", () => {
  // Spec example: tenant has stepped rent, landlord has simple rent
  // They do not affect each other's positions
  const t1 = makeTerm("BASE_RENT", "TENANT", 1, simpleRent(60));
  const l1 = makeTerm("BASE_RENT", "LANDLORD", 1, simpleRent(70));
  const t2 = makeTerm(
    "BASE_RENT",
    "TENANT",
    2,
    steppedRent([[1, 24, 64], [25, 60, 66]])
  );
  // Landlord does not update — their $70 carries forward

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [t1]),
    makeRound("LANDLORD", 1, 8, [l1]),
    makeRound("TENANT", 2, 15, [t2]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "BASE_RENT" });

  // Tenant: months 1-24=$64, months 25-60=$66
  const tPos = assertPosition(result.tenant, "Tenant");
  if (tPos.payload.termType === "BASE_RENT") {
    assert.equal(tPos.payload.rent.kind, "stepped");
    if (tPos.payload.rent.kind === "stepped") {
      assert.equal(tPos.payload.rent.steps[0]!.amountPerRSFYear, 64);
      assert.equal(tPos.payload.rent.steps[1]!.amountPerRSFYear, 66);
    }
  }

  // Landlord: $70 (carry-forward from Round 1 — they did not update)
  const lPos = assertPosition(result.landlord, "Landlord");
  if (lPos.payload.termType === "BASE_RENT") {
    assert.equal(lPos.payload.rent.kind, "simple");
    if (lPos.payload.rent.kind === "simple") {
      assert.equal(lPos.payload.rent.amountPerRSFYear, 70);
    }
  }
});

test("asOf cutoff excludes rounds after the specified date", () => {
  const t1 = makeTerm("TI_ALLOWANCE", "TENANT", 1, tiAllowance(110));
  const t2 = makeTerm("TI_ALLOWANCE", "TENANT", 2, tiAllowance(115));

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 5, [t1]),
    makeRound("TENANT", 2, 15, [t2]),
  ];

  // Cut off before Round 2
  const asOf = new Date("2026-09-10T00:00:00Z");
  const result = resolveStructuredState({
    rounds,
    canonicalType: "TI_ALLOWANCE",
    asOf,
  });

  const pos = assertPosition(result.tenant, "Tenant");
  if (pos.payload.termType === "TI_ALLOWANCE") {
    assert.equal(pos.payload.amount.amount, 110, "asOf must exclude Round 2; Round 1 carries forward");
  }
});

test("agreement is cleared when a later PROPOSED observation is added", () => {
  const t1 = makeTerm("TI_ALLOWANCE", "TENANT", 1, tiAllowance(105), { status: "AGREED" });
  const t2 = makeTerm("TI_ALLOWANCE", "TENANT", 2, tiAllowance(108)); // new PROPOSED reopens

  const rounds: RoundWithPayload[] = [
    makeRound("TENANT", 1, 1, [t1]),
    makeRound("TENANT", 2, 8, [t2]),
  ];

  const result = resolveStructuredState({ rounds, canonicalType: "TI_ALLOWANCE" });

  assert.notEqual(result.status, "AGREED", "Later PROPOSED must reopen the term");
  assert.equal(result.agreed, undefined, "No agreed field when later PROPOSED exists");
});

test("NOT_MENTIONED when no observations exist for the canonicalType", () => {
  const term = makeTerm("BASE_RENT", "TENANT", 1, simpleRent(65));
  const rounds: RoundWithPayload[] = [makeRound("TENANT", 1, 1, [term])];

  // Ask for EXPANSION_RIGHTS when only BASE_RENT exists
  const result = resolveStructuredState({ rounds, canonicalType: "EXPANSION_RIGHTS" });

  assert.equal(result.status, "NOT_MENTIONED");
  assert.equal(result.tenant, undefined);
  assert.equal(result.landlord, undefined);
  assert.deepEqual(result.sourceObservationIds, []);
});

test("one-sided PROPOSED stays PROPOSED", () => {
  const term = makeTerm("TI_ALLOWANCE", "LANDLORD", 1, tiAllowance(120), {
    id: "ti-proposed",
    status: "PROPOSED",
  });
  const result = resolveStructuredState({
    rounds: [makeRound("LANDLORD", 1, 1, [term])],
    canonicalType: "TI_ALLOWANCE",
  });
  assert.equal(result.status, "PROPOSED");
  assert.ok(result.landlord && !isSideConflict(result.landlord));
});

test("one-sided UNRESOLVED stays UNRESOLVED", () => {
  const term = makeTerm("TI_ALLOWANCE", "LANDLORD", 1, tiAllowance(120), {
    id: "ti-unresolved",
    status: "UNRESOLVED",
  });
  const result = resolveStructuredState({
    rounds: [makeRound("LANDLORD", 1, 1, [term])],
    canonicalType: "TI_ALLOWANCE",
  });
  assert.equal(result.status, "UNRESOLVED");
  const position = assertPosition(result.landlord, "Landlord");
  assert.deepEqual(position.observationIds, ["ti-unresolved"]);
});

test("two-sided unresolved negotiation stays UNRESOLVED", () => {
  const tenant = makeTerm("TI_ALLOWANCE", "TENANT", 1, tiAllowance(140), {
    id: "ti-tenant",
    status: "UNRESOLVED",
  });
  const landlord = makeTerm("TI_ALLOWANCE", "LANDLORD", 1, tiAllowance(100), {
    id: "ti-landlord",
    status: "UNRESOLVED",
  });
  const result = resolveStructuredState({
    rounds: [
      makeRound("TENANT", 1, 1, [tenant]),
      makeRound("LANDLORD", 1, 8, [landlord]),
    ],
    canonicalType: "TI_ALLOWANCE",
  });
  assert.equal(result.status, "UNRESOLVED");
  assert.equal(result.agreed, undefined);
  assert.ok(result.tenant && !isSideConflict(result.tenant));
  assert.ok(result.landlord && !isSideConflict(result.landlord));
});

test("later proposal supersedes an unresolved position", () => {
  const unresolved = makeTerm("TI_ALLOWANCE", "LANDLORD", 1, tiAllowance(120), {
    id: "ti-open",
    status: "UNRESOLVED",
  });
  const proposed = makeTerm("TI_ALLOWANCE", "LANDLORD", 2, tiAllowance(95), {
    id: "ti-later",
    status: "PROPOSED",
  });
  const result = resolveStructuredState({
    rounds: [
      makeRound("LANDLORD", 1, 1, [unresolved]),
      makeRound("LANDLORD", 2, 8, [proposed]),
    ],
    canonicalType: "TI_ALLOWANCE",
  });
  assert.equal(result.status, "PROPOSED");
  const position = assertPosition(result.landlord, "Landlord");
  assert.deepEqual(position.observationIds, ["ti-later"]);
  if (position.payload.termType === "TI_ALLOWANCE") {
    assert.equal(position.payload.amount.amount, 95);
  }
});

test("unresolved state carries forward when a later round omits the term", () => {
  const unresolved = makeTerm("TI_ALLOWANCE", "LANDLORD", 1, tiAllowance(120), {
    id: "ti-carry",
    status: "UNRESOLVED",
  });
  const rentOnly = makeTerm("BASE_RENT", "LANDLORD", 2, simpleRent(70), {
    id: "rent-later",
  });
  const result = resolveStructuredState({
    rounds: [
      makeRound("LANDLORD", 1, 1, [unresolved]),
      makeRound("LANDLORD", 2, 8, [rentOnly]),
    ],
    canonicalType: "TI_ALLOWANCE",
  });
  assert.equal(result.status, "UNRESOLVED");
  const position = assertPosition(result.landlord, "Landlord");
  assert.deepEqual(position.observationIds, ["ti-carry"]);
  if (position.payload.termType === "TI_ALLOWANCE") {
    assert.equal(position.payload.amount.amount, 120);
  }
});
