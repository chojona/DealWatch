/**
 * evals/negotiation/v2/oracle.test.ts
 *
 * Offline resolver oracle tests. No live model.
 *
 * Perfect structured observations are fed into resolveStructuredState.
 * Expected state accuracy is 100% for n07, n09, n13, rights cases, and
 * the explicit carry-forward scenario. A miss is a resolver bug (documented,
 * not fixed in Phase 4).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { isSideConflict, resolveStructuredState } from "@/lib/negotiation/resolveStructuredState";
import { ORACLE_FIXTURES, oracleFixtureFor } from "./oracleFixtures";
import { roundsFromOracle, runOracleEvaluation, runOracleScenario } from "./runOracle";
import { formatV2Summary } from "./summary";
import { V2_EXPECTATIONS } from "./expectations";
import { NEGOTIATION_FIXTURES } from "../fixtures";
import * as P from "./payloadLibrary";
import type { OracleFixtureInput } from "./types";

const REQUIRED_LIVE_FIXTURES = [
  "n07-stepped-rent",
  "n09-irregular-free-rent",
  "n10-renewal-right",
  "n11-termination-right",
  "n12-rights-package",
  "n13-contradictory-draft",
  "n16-implicit-acceptance",
  "n20-complex-adversarial-amendment",
];

test("V2 expectations cover the required high-value V1 fixtures", () => {
  const ids = new Set(V2_EXPECTATIONS.map((e) => e.fixtureId));
  for (const id of REQUIRED_LIVE_FIXTURES) {
    assert.ok(ids.has(id), "missing V2 expectation for " + id);
  }
  for (const expectation of V2_EXPECTATIONS) {
    const v1 = NEGOTIATION_FIXTURES.find((f) => f.id === expectation.fixtureId);
    assert.ok(v1, "V2 expectation " + expectation.fixtureId + " has no V1 fixture");
    for (const doc of expectation.documents ?? []) {
      assert.ok(
        v1.documents.some((d) => d.id === doc.documentId),
        expectation.fixtureId + " document " + doc.documentId + " is not a V1 document"
      );
      for (const payload of doc.expectedPayloads) {
        const term = v1.documents
          .flatMap((d) => d.expectedTerms)
          .find((t) => t.id === payload.expectedTermId);
        assert.ok(
          term,
          expectation.fixtureId + " payload " + payload.expectedTermId + " is not a V1 term id"
        );
      }
    }
  }
});

test("V1 fixture gold is untouched: 20 fixtures, original ids", () => {
  assert.equal(NEGOTIATION_FIXTURES.length, 20);
  assert.deepEqual(
    NEGOTIATION_FIXTURES.map((f) => f.id),
    [
      "n01-simple-rent",
      "n02-area-and-term",
      "n03-mixed-economics",
      "n04-counteroffer",
      "n05-explicit-acceptance",
      "n06-missing-carry-forward",
      "n07-stepped-rent",
      "n08-conditional-economics",
      "n09-irregular-free-rent",
      "n10-renewal-right",
      "n11-termination-right",
      "n12-rights-package",
      "n13-contradictory-draft",
      "n14-rejection-withdrawal",
      "n15-amendment-supersedes",
      "n16-implicit-acceptance",
      "n17-money-decoys",
      "n18-negated-and-historical",
      "n19-prompt-injection",
      "n20-complex-adversarial-amendment",
    ]
  );
});

test("oracle suite includes n07, n09, n13, rights, and carry-forward", () => {
  const ids = new Set(ORACLE_FIXTURES.map((f) => f.id));
  for (const id of [
    "n07-stepped-rent",
    "n09-irregular-free-rent",
    "n10-renewal-right",
    "n11-termination-right",
    "n12-rights-package",
    "n13-contradictory-draft",
    "oracle-carry-forward-rent-ti",
  ]) {
    assert.ok(ids.has(id), "missing oracle fixture " + id);
  }
});

function assertOraclePassed(id: string) {
  const fixture = oracleFixtureFor(id);
  assert.ok(fixture, "missing oracle fixture " + id);
  const result = runOracleScenario(fixture);
  if (!result.allPassed) {
    const details = result.typeResults
      .flatMap((t) => t.failures.map((f) => f.phase + ": " + f.description))
      .join("\n  ");
    assert.fail(id + " oracle failed:\n  " + details);
  }
}

test("n07 oracle: perfect stepped observations resolve to 100% state accuracy", () => {
  assertOraclePassed("n07-stepped-rent");
  const fixture = oracleFixtureFor("n07-stepped-rent")!;
  const result = runOracleScenario(fixture);
  const rent = result.typeResults.find((t) => t.canonicalType === "BASE_RENT")!;
  assert.ok(!isSideConflict(rent.actualState.landlord!));
  const payload = !isSideConflict(rent.actualState.landlord!)
    ? rent.actualState.landlord!.payload
    : undefined;
  assert.equal(payload?.termType, "BASE_RENT");
  if (payload?.termType === "BASE_RENT") {
    assert.equal(payload.rent.kind, "stepped");
    if (payload.rent.kind === "stepped") {
      assert.equal(payload.rent.steps.length, 3);
    }
  }
});

test("n09 oracle: perfect irregular free-rent observations resolve to 100%", () => {
  assertOraclePassed("n09-irregular-free-rent");
  const result = runOracleScenario(oracleFixtureFor("n09-irregular-free-rent")!);
  const free = result.typeResults.find((t) => t.canonicalType === "FREE_RENT")!;
  const payload = !isSideConflict(free.actualState.tenant!)
    ? free.actualState.tenant!.payload
    : undefined;
  assert.equal(payload?.termType, "FREE_RENT");
  if (payload?.termType === "FREE_RENT") {
    assert.equal(payload.abatement.kind, "irregular");
    if (payload.abatement.kind === "irregular") {
      assert.equal(payload.abatement.periods.length, 5);
    }
  }
});

test("n13 oracle: perfect contradictory observations surface CONFLICT with both candidates", () => {
  assertOraclePassed("n13-contradictory-draft");
  const result = runOracleScenario(oracleFixtureFor("n13-contradictory-draft")!);
  const rent = result.typeResults.find((t) => t.canonicalType === "BASE_RENT")!;
  assert.ok(isSideConflict(rent.actualState.landlord!));
  if (isSideConflict(rent.actualState.landlord!)) {
    assert.equal(rent.actualState.landlord!.candidates.length, 2);
  }
  assert.equal(rent.actualState.status, "UNRESOLVED");
  assert.equal(rent.actualState.agreed, undefined);
});

test("rights-case oracles (n10, n11, n12) resolve to 100%", () => {
  assertOraclePassed("n10-renewal-right");
  assertOraclePassed("n11-termination-right");
  assertOraclePassed("n12-rights-package");
});

test("explicit carry-forward oracle: Round 2 rent $67, TI $110 persists", () => {
  assertOraclePassed("oracle-carry-forward-rent-ti");
  const result = runOracleScenario(oracleFixtureFor("oracle-carry-forward-rent-ti")!);
  const ti = result.typeResults.find((t) => t.canonicalType === "TI_ALLOWANCE")!;
  const payload = !isSideConflict(ti.actualState.tenant!)
    ? ti.actualState.tenant!.payload
    : undefined;
  assert.equal(payload?.termType, "TI_ALLOWANCE");
  if (payload?.termType === "TI_ALLOWANCE") {
    assert.equal(payload.amount.amount, 110);
  }
  const rent = result.typeResults.find((t) => t.canonicalType === "BASE_RENT")!;
  const rentPayload = !isSideConflict(rent.actualState.tenant!)
    ? rent.actualState.tenant!.payload
    : undefined;
  if (rentPayload?.termType === "BASE_RENT" && rentPayload.rent.kind === "simple") {
    assert.equal(rentPayload.rent.amountPerRSFYear, 67);
  } else {
    assert.fail("expected simple $67 rent after round 2");
  }
});

test("full oracle suite: n16, n20, n15, n01, escalation also pass", () => {
  for (const id of [
    "n01-simple-rent",
    "n15-amendment-supersedes",
    "n16-implicit-acceptance",
    "n20-complex-adversarial-amendment",
    "oracle-annual-escalation",
  ]) {
    assertOraclePassed(id);
  }
});

test("oracle evaluation report separates V2 metrics and attributes resolver failures", () => {
  const report = runOracleEvaluation({
    now: () => new Date("2026-09-28T16:00:00.000Z"),
  });
  assert.equal(report.schemaVersion, "2.0");
  assert.equal(report.mode, "oracle");
  assert.equal(report.allPassed, true);
  assert.equal(report.resolverBugs.length, 0);
  assert.equal(report.stateMetrics.provenanceValidity.accuracy, 1);
  assert.equal(report.stateMetrics.conflictDetectionAccuracy.accuracy, 1);
  assert.equal(report.stateMetrics.carryForwardAccuracy.accuracy, 1);
  assert.equal(report.extractionMetrics.payloadCoverage.accuracy, 1);
  assert.equal(report.extractionMetrics.payloadValidity.accuracy, 1);

  const summary = formatV2Summary(report);
  assert.match(summary, /V2 CRE ONTOLOGY/);
  assert.match(summary, /Structured Extraction/);
  assert.match(summary, /Structured State/);
  assert.match(summary, /Conflict detection/);
  assert.match(summary, /Carry-forward/);
  assert.match(summary, /Provenance validity/);
  assert.doesNotMatch(summary, /Precision:/);
  assert.doesNotMatch(summary, /False positives:/);
});

test("oracle provenance never leaks pending ids", () => {
  const report = runOracleEvaluation();
  for (const scenario of report.scenarios) {
    for (const typeResult of scenario.typeResults) {
      const ids = typeResult.actualState.sourceObservationIds;
      assert.ok(!ids.includes("pending"), scenario.scenarioId + " leaked pending");
    }
  }
});

/**
 * A one-sided position keeps the contributing observation's UNRESOLVED
 * status. n08 conditional TI is the live case this guards.
 */
test("one-sided UNRESOLVED observation stays UNRESOLVED", () => {
  const fixture: OracleFixtureInput = {
    id: "n08-unresolved-status",
    description: "n08-style one-sided UNRESOLVED TI",
    tags: ["documented-limitation"],
    rounds: [
      {
        id: "n08-d1",
        side: "LANDLORD",
        roundNumber: 1,
        date: "2026-01-16T15:00:00.000Z",
        observations: [
          {
            id: "n08-ti",
            canonicalType: "TI_ALLOWANCE",
            side: "LANDLORD",
            roundNumber: 1,
            status: "UNRESOLVED",
            structuredPayload: P.n08TI,
            evidenceQuote:
              "Subject to investment committee approval, Landlord could provide $120.00/RSF as the TI Allowance.",
          },
        ],
      },
    ],
    expectedStructuredState: [
      {
        canonicalType: "TI_ALLOWANCE",
        status: "UNRESOLVED",
        conflictExpected: false,
        landlordPayload: P.n08TI,
      },
    ],
  };
  const actual = resolveStructuredState({
    rounds: roundsFromOracle(fixture),
    canonicalType: "TI_ALLOWANCE",
  });
  assert.equal(actual.status, "UNRESOLVED");
  const scored = runOracleScenario(fixture);
  assert.equal(scored.allPassed, true);
});
