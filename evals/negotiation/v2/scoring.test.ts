/**
 * evals/negotiation/v2/scoring.test.ts
 *
 * Unit tests for V2 semantic payload scoring.
 * Partial credit, no JSON-string comparison, derived-value isolation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { CREStructuredPayload } from "@/lib/ai/negotiation/payloads";
import {
  conditionsComponentScore,
  isPerfectSemanticScore,
  periodComponentScore,
  scheduleComponentScore,
  scorePayload,
} from "./scoring";
import * as P from "./payloadLibrary";

test("BASE_RENT simple: exact match is perfect", () => {
  const score = scorePayload(P.n01Rent, P.n01Rent);
  assert.equal(score.score, 1);
  assert.ok(isPerfectSemanticScore(score));
});

test("BASE_RENT simple vs stepped: classification fails, no credit for amount-only", () => {
  const actual: CREStructuredPayload = {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 48 },
  };
  const score = scorePayload(actual, P.n07SteppedRent);
  assert.ok(score.score < 1);
  assert.equal(score.components.classification?.score, 0);
  assert.equal(scheduleComponentScore(score), 0);
});

test("BASE_RENT stepped: partial credit per correctly matched step", () => {
  const twoOfThree: CREStructuredPayload = {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: [
        { startMonth: 1, endMonth: 24, amountPerRSFYear: 48 },
        { startMonth: 25, endMonth: 60, amountPerRSFYear: 51 },
        { startMonth: 61, endMonth: 120, amountPerRSFYear: 99 },
      ],
    },
  };
  const score = scorePayload(twoOfThree, P.n07SteppedRent);
  assert.ok(score.score > 0 && score.score < 1);
  const steps = score.components.steps;
  assert.ok(steps);
  // 2 fully correct steps (3 pts each) + 2/3 on the third (start+end, wrong amount)
  assert.equal(steps.score, 8);
  assert.equal(steps.maxScore, 9);
});

test("FREE_RENT: matching total months alone is not full credit", () => {
  const contiguousFourAndHalf: CREStructuredPayload = {
    termType: "FREE_RENT",
    abatement: {
      kind: "contiguous",
      months: 5,
      abatementType: "FULL",
    },
    scope: "BASE_RENT_ONLY",
  };
  const score = scorePayload(contiguousFourAndHalf, P.n09FreeRent);
  assert.ok(score.score < 1);
  assert.equal(score.components.abatementKind?.score, 0);
  assert.equal(periodComponentScore(score), 0);
});

test("FREE_RENT irregular: equivalentFullMonths is a low-weight derived metric", () => {
  const wrongPeriodsRightTotal: CREStructuredPayload = {
    termType: "FREE_RENT",
    abatement: {
      kind: "irregular",
      periods: [
        { startMonth: 1, endMonth: 4, abatementType: "FULL" },
        { startMonth: 10, endMonth: 10, abatementType: "PARTIAL", partialPct: 50 },
      ],
      equivalentFullMonths: 4.5,
    },
    scope: "BASE_RENT_ONLY",
  };
  const score = scorePayload(wrongPeriodsRightTotal, P.n09FreeRent);
  assert.ok(score.components.equivalentFullMonths);
  assert.equal(score.components.equivalentFullMonths.score, 0.5);
  assert.equal(score.components.equivalentFullMonths.maxScore, 0.5);
  assert.ok(score.score < 1, "correct total must not yield full semantic correctness");
  assert.ok((periodComponentScore(score) ?? 1) < 1);
});

test("FREE_RENT irregular: perfect period match is 1.0", () => {
  const score = scorePayload(P.n09FreeRent, P.n09FreeRent);
  assert.equal(score.score, 1);
  assert.equal(periodComponentScore(score), 1);
});

test("RENEWAL_OPTIONS: option count, duration, pricing, notice", () => {
  const score = scorePayload(P.n10Renewal, P.n10Renewal);
  assert.equal(score.score, 1);
  assert.ok(conditionsComponentScore(score) === 1);
});

test("TERMINATION_RIGHTS: eligibility, notice, fee kind", () => {
  const wrongMonth: CREStructuredPayload = {
    termType: "TERMINATION_RIGHTS",
    right: {
      eligibleAfterYear: null,
      eligibleAfterMonth: 60,
      noticeMonths: 15,
      terminationFee: {
        kind: "unamortized_costs",
        description:
          "unamortized TI allowance and commissions plus three months of then-current Base Rent",
      },
      conditions: [],
    },
  };
  const score = scorePayload(wrongMonth, P.n11Termination);
  assert.ok(score.score < 1);
  assert.equal(score.components.eligibleAfterMonth?.score, 0);
  assert.equal(score.components.noticeMonths?.score, 2);
});

test("PARKING: spaces, rate, rate type, reserved scored independently", () => {
  const score = scorePayload(P.n12Parking, P.n12Parking);
  assert.equal(score.score, 1);
  const wrongReserved: CREStructuredPayload = {
    termType: "PARKING",
    spacesCount: 42,
    spacesRatio: null,
    ratePerSpacePerMonth: null,
    rateType: "PREVAILING",
    reserved: true,
    conditions: [],
  };
  const reservedScore = scorePayload(wrongReserved, P.n12Parking);
  assert.ok(reservedScore.score < 1);
  assert.equal(reservedScore.components.spacesCount?.score, 2);
  assert.equal(reservedScore.components.rateType?.score, 1);
  assert.equal(reservedScore.components.reserved?.score, 0);
});

test("OPERATING_EXPENSES: structure, cap, taxes/insurance", () => {
  const score = scorePayload(P.n17OpEx, P.n17OpEx);
  assert.equal(score.score, 1);
  const wrongCap: CREStructuredPayload = {
    termType: "OPERATING_EXPENSES",
    structure: "OTHER",
    baseYear: null,
    controllableCapPct: 3,
    taxesInsuranceUncapped: null,
    exclusions: [],
    managementFeePct: null,
  };
  const capScore = scorePayload(wrongCap, P.n17OpEx);
  assert.equal(capScore.components.controllableCapPct?.score, 0);
  assert.equal(capScore.components.structure?.score, 2);
});

test("ANNUAL_ESCALATION: kind, percentage, frequency, timing", () => {
  const score = scorePayload(P.oracleAnnualEscalation, P.oracleAnnualEscalation);
  assert.equal(score.score, 1);
});

test("EXPANSION_RIGHTS: right kind and applicable space", () => {
  const score = scorePayload(P.n12Expansion, P.n12Expansion);
  assert.equal(score.score, 1);
  const rofr: CREStructuredPayload = {
    termType: "EXPANSION_RIGHTS",
    rightKind: "ROFR",
    applicableSpace: "adjacent fourth floor",
    trigger: null,
    noticeMonths: null,
    pricingMethod: null,
    conditions: [],
  };
  const kindScore = scorePayload(rofr, P.n12Expansion);
  assert.equal(kindScore.components.rightKind?.score, 0);
});

test("termType mismatch scores 0 and is not a JSON-string compare", () => {
  const score = scorePayload(P.n01Rent, P.n09FreeRent);
  assert.equal(score.score, 0);
  assert.ok(score.components.termType);
});
