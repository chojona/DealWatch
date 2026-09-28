import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalTermType,
  NegotiationSide,
  NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";
import { calculateNumericGap, compareRounds } from "./compareRounds";
import { calculateMovement } from "./calculateMovement";
import { resolveCurrentState } from "./resolveCurrentState";
import type { NegotiationRoundRecord, NegotiationTermRecord } from "./types";

let sequence = 0;

function term(
  type: CanonicalTermType,
  side: NegotiationSide,
  roundNumber: number,
  value: number | null,
  options: {
    status?: NegotiationTermStatus;
    unit?: string | null;
    raw?: string;
  } = {}
): NegotiationTermRecord {
  sequence += 1;
  const raw = options.raw ?? (value === null ? "clause text" : String(value));
  return {
    id: `term-${sequence}`,
    canonicalType: type,
    normalizedValue: raw,
    normalizedNumeric: value,
    normalizedUnit:
      options.unit === undefined ? "USD_PER_RSF_YEAR" : options.unit,
    rawValue: raw,
    status: options.status ?? "PROPOSED",
    side,
    roundNumber,
    confidence: 0.98,
    evidenceQuote: raw,
    sourceLocation: null,
  };
}

function round(
  side: NegotiationSide,
  roundNumber: number,
  day: number,
  terms: NegotiationTermRecord[]
): NegotiationRoundRecord {
  return {
    id: `${side}-${roundNumber}-${day}`,
    side,
    roundNumber,
    documentName: `${side} R${roundNumber}`,
    documentText: terms.map((item) => item.evidenceQuote).join("\n"),
    documentDate: new Date(`2026-09-${String(day).padStart(2, "0")}T12:00:00Z`),
    createdAt: new Date(`2026-09-${String(day).padStart(2, "0")}T13:00:00Z`),
    terms,
  };
}

function economicRounds(type: CanonicalTermType, values: number[]) {
  return [
    round("TENANT", 1, 1, [term(type, "TENANT", 1, values[0])]),
    round("LANDLORD", 1, 8, [term(type, "LANDLORD", 1, values[1])]),
    round("TENANT", 2, 15, [term(type, "TENANT", 2, values[2])]),
    round("LANDLORD", 2, 22, [term(type, "LANDLORD", 2, values[3])]),
  ];
}

test("rent gap closes from $11/SF to $3/SF (72.7%)", () => {
  const rounds = economicRounds("BASE_RENT", [61, 72, 64, 67]);
  const row = compareRounds(rounds).rows.find((item) => item.type === "BASE_RENT");
  assert.deepEqual(row?.gap, {
    initialGap: 11,
    currentGap: 3,
    gapClosed: 8,
    gapClosurePercent: 72.72727272727273,
    unit: "USD_PER_RSF_YEAR",
  });
});

test("TI gap closes from $45/SF to $10/SF (77.8%)", () => {
  const rounds = economicRounds("TI_ALLOWANCE", [125, 80, 115, 105]);
  const gap = compareRounds(rounds).rows.find(
    (item) => item.type === "TI_ALLOWANCE"
  )?.gap;
  assert.equal(gap?.initialGap, 45);
  assert.equal(gap?.currentGap, 10);
  assert.equal(gap?.gapClosed, 35);
  assert.equal(Number(gap?.gapClosurePercent.toFixed(1)), 77.8);
});

test("tenant and landlord movement preserve their signs", () => {
  const movement = calculateMovement(
    economicRounds("BASE_RENT", [61, 72, 64, 67]),
    "BASE_RENT"
  );
  assert.equal(movement.tenant?.change, 3);
  assert.equal(movement.landlord?.change, -5);
});

test("unchanged positions produce zero movement", () => {
  const movement = calculateMovement(
    economicRounds("BASE_RENT", [61, 72, 61, 72]),
    "BASE_RENT"
  );
  assert.equal(movement.tenant?.change, 0);
  assert.equal(movement.landlord?.change, 0);
});

test("a missing term in a later round does not overwrite either known position", () => {
  const rounds = economicRounds("BASE_RENT", [61, 72, 64, 67]);
  rounds.push(round("TENANT", 3, 25, []));
  const state = resolveCurrentState(rounds, "BASE_RENT");
  assert.equal(state.currentTenantTerm?.normalizedNumeric, 64);
  assert.equal(state.currentLandlordTerm?.normalizedNumeric, 67);
  assert.equal(state.status, "UNRESOLVED");
});

test("an explicitly accepted term becomes agreed", () => {
  const rounds = [
    round("TENANT", 1, 1, [term("LEASE_TERM", "TENANT", 1, 120, { unit: "MONTHS" })]),
    round("LANDLORD", 1, 8, [term("LEASE_TERM", "LANDLORD", 1, 84, { unit: "MONTHS" })]),
    round("TENANT", 2, 15, [term("LEASE_TERM", "TENANT", 2, 84, { unit: "MONTHS", status: "AGREED" })]),
  ];
  assert.equal(resolveCurrentState(rounds, "LEASE_TERM").status, "AGREED");
});

test("explicit rejection remains visible and unresolved", () => {
  const rounds = [
    round("TENANT", 1, 1, [term("TERMINATION_RIGHTS", "TENANT", 1, null, { unit: null, raw: "Option after year 5" })]),
    round("LANDLORD", 1, 8, [term("TERMINATION_RIGHTS", "LANDLORD", 1, null, { unit: null, raw: "Early termination is rejected", status: "REJECTED" })]),
  ];
  const analysis = compareRounds(rounds);
  assert.equal(resolveCurrentState(rounds, "TERMINATION_RIGHTS").status, "REJECTED");
  assert.ok(analysis.openIssues.some((item) => item.type === "TERMINATION_RIGHTS"));
});

test("withdrawal clears that side's active position without deleting history", () => {
  const rounds = [
    round("TENANT", 1, 1, [term("EXPANSION_RIGHTS", "TENANT", 1, null, { unit: null, raw: "Right of first offer" })]),
    round("TENANT", 2, 8, [term("EXPANSION_RIGHTS", "TENANT", 2, null, { unit: null, raw: "Tenant withdraws the ROFO", status: "WITHDRAWN" })]),
  ];
  const state = resolveCurrentState(rounds, "EXPANSION_RIGHTS");
  assert.equal(state.status, "WITHDRAWN");
  assert.equal(state.currentTenantTerm, undefined);
  assert.equal(rounds[0].terms.length, 1);
});

test("contradictory values in one document are flagged instead of selected", () => {
  const rounds = [round("TENANT", 1, 1, [
    term("BASE_RENT", "TENANT", 1, 61),
    term("BASE_RENT", "TENANT", 1, 63),
  ])];
  const state = resolveCurrentState(rounds, "BASE_RENT");
  assert.equal(state.contradictory, true);
  assert.equal(state.status, "UNRESOLVED");
});

test("non-economic clauses resolve without manufacturing a numeric gap", () => {
  const rounds = [
    round("TENANT", 1, 1, [term("ASSIGNMENT_SUBLETTING", "TENANT", 1, null, { unit: null, raw: "Consent not unreasonably withheld" })]),
    round("LANDLORD", 1, 8, [term("ASSIGNMENT_SUBLETTING", "LANDLORD", 1, null, { unit: null, raw: "Landlord agrees to reasonable consent", status: "AGREED" })]),
  ];
  const row = compareRounds(rounds).rows.find(
    (item) => item.type === "ASSIGNMENT_SUBLETTING"
  );
  assert.equal(row?.state.status, "AGREED");
  assert.equal(row?.gap, undefined);
});

test("zero initial gap does not divide by zero", () => {
  assert.deepEqual(calculateNumericGap(61, 61, 61, 61, "USD_PER_RSF_YEAR"), {
    initialGap: 0,
    currentGap: 0,
    gapClosed: 0,
    gapClosurePercent: 0,
    unit: "USD_PER_RSF_YEAR",
  });
});
