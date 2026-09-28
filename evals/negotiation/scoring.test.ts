import assert from "node:assert/strict";
import test from "node:test";
import type { NegotiationExtraction } from "@/lib/ai/negotiation/schemas";
import { NEGOTIATION_FIXTURES } from "./fixtures";
import { runNegotiationEvaluation } from "./runEvaluation";
import { scoreDocument } from "./scoring";

test("suite has 20 increasingly difficult, source-grounded negotiations", () => {
  assert.equal(NEGOTIATION_FIXTURES.length, 20);
  assert.deepEqual(
    NEGOTIATION_FIXTURES.map((fixture) => fixture.difficulty),
    Array.from({ length: 20 }, (_, index) => index + 1)
  );
  for (const fixture of NEGOTIATION_FIXTURES) {
    for (const document of fixture.documents) {
      for (const expected of document.expectedTerms) {
        assert.ok(document.text.includes(expected.evidence));
      }
    }
  }
  const tags = new Set(NEGOTIATION_FIXTURES.flatMap((fixture) => fixture.tags));
  for (const required of [
    "stepped-rent",
    "conditional-terms",
    "implicit-acceptance",
    "missing-terms",
    "contradiction",
    "amendment",
    "free-rent",
    "renewal-rights",
    "termination-rights",
    "adversarial",
  ]) {
    assert.ok(tags.has(required), "missing coverage tag " + required);
  }
});

test("oracle extraction produces perfect scores on a simple historical fixture", async () => {
  const fixture = NEGOTIATION_FIXTURES.find(
    (item) => item.id === "n05-explicit-acceptance"
  )!;
  const report = await runNegotiationEvaluation({
    fixtures: [fixture],
    concurrency: 2,
    now: () => new Date("2026-09-28T12:00:00.000Z"),
    extractor: async (input) => {
      const document = fixture.documents.find(
        (item) => item.name === input.documentName
      )!;
      const terms: NegotiationExtraction["terms"] =
        document.expectedTerms.map((expected) => ({
          canonicalType: expected.canonicalType,
          normalizedValue: expected.normalizedValue ?? null,
          normalizedNumeric: expected.normalizedNumeric ?? null,
          normalizedUnit: expected.normalizedUnit ?? null,
          rawValue: expected.evidence,
          status: expected.status,
          confidence: 0.99,
          evidenceQuote: expected.evidence,
          sourceLocation: null,
        }));
      return {
        model: "oracle",
        extraction: { terms, overallConfidence: 0.99 },
      };
    },
  });

  assert.equal(report.metrics.extraction.f1, 1);
  assert.equal(report.metrics.numeric.accuracy, 1);
  assert.equal(report.metrics.evidenceValidity.accuracy, 1);
  assert.equal(report.metrics.evidenceSupport.accuracy, 1);
  assert.equal(report.metrics.assertionStatus.accuracy, 1);
  assert.equal(report.metrics.currentState.accuracy, 1);
  assert.equal(report.metrics.finalStatus.accuracy, 1);
  assert.equal(report.metrics.agreement.accuracy, 1);
});

test("scoring separates false positives, numeric errors, and invalid evidence", () => {
  const document = NEGOTIATION_FIXTURES[0]!.documents[0]!;
  const predicted = {
    canonicalType: "BASE_RENT" as const,
    normalizedValue: "$99/RSF/year",
    normalizedNumeric: 99,
    normalizedUnit: "USD_PER_RSF_YEAR" as const,
    rawValue: "$99",
    status: "AGREED" as const,
    confidence: 0.99,
    evidenceQuote: "fabricated quote",
    sourceLocation: null,
  };
  const falsePositive = {
    ...predicted,
    canonicalType: "TI_ALLOWANCE" as const,
  };
  const evaluation = scoreDocument({
    document,
    rawTerms: [predicted, falsePositive],
    validatedTerms: [
      { ...predicted, sourceLocation: undefined },
      { ...falsePositive, sourceLocation: undefined },
    ],
    latencyMs: 1,
    validationFailures: 0,
    model: "broken",
  });

  assert.equal(evaluation.metrics.extraction.truePositives, 1);
  assert.equal(evaluation.metrics.extraction.falsePositives, 1);
  assert.equal(evaluation.metrics.numeric.accuracy, 0);
  assert.equal(evaluation.metrics.evidenceValidity.accuracy, 0);
  assert.equal(evaluation.metrics.evidenceSupport.accuracy, 0);
  assert.equal(evaluation.metrics.assertionStatus.accuracy, 0);
});
