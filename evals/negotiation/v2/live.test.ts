/**
 * evals/negotiation/v2/live.test.ts
 *
 * V2 live-scoring wiring tests using a mock extractor that emits perfect
 * structured payloads. No paid model calls.
 *
 * Confirms V1 metrics remain independently perfect and V2 state scoring
 * consumes structuredPayload from the same extraction pass.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { NegotiationExtraction } from "@/lib/ai/negotiation/schemas";
import { NEGOTIATION_FIXTURES } from "../fixtures";
import { runNegotiationEvaluation } from "../runEvaluation";
import { formatEvaluationSummary } from "../summary";
import { v2ExpectationFor } from "./expectations";
import { runV2LiveEvaluation } from "./runLive";
import { formatCombinedSummary } from "./summary";

test("mock live V2 on n01: V1 F1 stays 1.0 and V2 structured state is perfect", async () => {
  const fixture = NEGOTIATION_FIXTURES.find((f) => f.id === "n01-simple-rent")!;
  const expectation = v2ExpectationFor("n01-simple-rent")!;
  const v1 = await runNegotiationEvaluation({
    fixtures: [fixture],
    cacheDir: false,
    now: () => new Date("2026-09-28T16:00:00.000Z"),
    extractor: async (input) => {
      const document = fixture.documents.find((d) => d.name === input.documentName)!;
      const docExp = expectation.documents?.find((d) => d.documentId === document.id);
      const terms: NegotiationExtraction["terms"] = document.expectedTerms.map(
        (expected) => ({
          canonicalType: expected.canonicalType,
          normalizedValue: expected.normalizedValue ?? null,
          normalizedNumeric: expected.normalizedNumeric ?? null,
          normalizedUnit: expected.normalizedUnit ?? null,
          rawValue: expected.evidence,
          status: expected.status,
          confidence: 0.99,
          evidenceQuote: expected.evidence,
          sourceLocation: null,
          structuredPayload:
            docExp?.expectedPayloads.find((p) => p.expectedTermId === expected.id)
              ?.payload ?? null,
        })
      );
      return { model: "oracle-v2", extraction: { terms, overallConfidence: 0.99 } };
    },
  });

  assert.equal(v1.schemaVersion, "1.0");
  assert.equal(v1.metrics.extraction.f1, 1);
  assert.equal(v1.metrics.currentState.accuracy, 1);

  const v2 = runV2LiveEvaluation({ v1Report: v1, fixtures: [fixture] });
  assert.equal(v2.schemaVersion, "2.0");
  assert.equal(v2.mode, "live");
  assert.equal(v2.scenarios.length, 1);
  assert.equal(v2.stateMetrics.tenantPositionAccuracy.accuracy, 1);
  assert.equal(v2.stateMetrics.provenanceValidity.accuracy, 1);
  assert.equal(v2.extractionMetrics.payloadCoverage.accuracy, 1);
  assert.equal(v2.failures.length, 0);

  const v1Summary = formatEvaluationSummary(v1);
  assert.match(v1Summary, /Precision:/);
  assert.doesNotMatch(v1Summary, /V2 CRE ONTOLOGY/);

  const combined = formatCombinedSummary(v1, v2);
  assert.match(combined, /V1 FLAT BENCHMARK/);
  assert.match(combined, /V2 CRE ONTOLOGY/);
});

test("mock live V2 on n13: conflict detection is scored separately from V1", async () => {
  const fixture = NEGOTIATION_FIXTURES.find((f) => f.id === "n13-contradictory-draft")!;
  const expectation = v2ExpectationFor("n13-contradictory-draft")!;
  const v1 = await runNegotiationEvaluation({
    fixtures: [fixture],
    cacheDir: false,
    now: () => new Date("2026-09-28T16:00:00.000Z"),
    extractor: async (input) => {
      const document = fixture.documents.find((d) => d.name === input.documentName)!;
      const docExp = expectation.documents?.find((d) => d.documentId === document.id);
      const terms: NegotiationExtraction["terms"] = document.expectedTerms.map(
        (expected) => ({
          canonicalType: expected.canonicalType,
          normalizedValue: expected.normalizedValue ?? null,
          normalizedNumeric: expected.normalizedNumeric ?? null,
          normalizedUnit: expected.normalizedUnit ?? null,
          rawValue: expected.evidence,
          status: expected.status,
          confidence: 0.99,
          evidenceQuote: expected.evidence,
          sourceLocation: null,
          structuredPayload:
            docExp?.expectedPayloads.find((p) => p.expectedTermId === expected.id)
              ?.payload ?? null,
        })
      );
      return { model: "oracle-v2", extraction: { terms, overallConfidence: 0.99 } };
    },
  });

  assert.equal(v1.metrics.extraction.f1, 1);
  const v2 = runV2LiveEvaluation({ v1Report: v1, fixtures: [fixture] });
  assert.equal(v2.stateMetrics.conflictDetectionAccuracy.accuracy, 1);
  assert.equal(v2.failures.length, 0);
});

test("live validity accepts model-facing nulls on optional fields", async () => {
  const fixture = NEGOTIATION_FIXTURES.find((f) => f.id === "n01-simple-rent")!;
  const expectation = v2ExpectationFor("n01-simple-rent")!;
  const v1 = await runNegotiationEvaluation({
    fixtures: [fixture],
    cacheDir: false,
    now: () => new Date("2026-09-28T16:00:00.000Z"),
    extractor: async (input) => {
      const document = fixture.documents.find((d) => d.name === input.documentName)!;
      const docExp = expectation.documents?.find((d) => d.documentId === document.id);
      const terms: NegotiationExtraction["terms"] = document.expectedTerms.map(
        (expected) => {
          const gold =
            docExp?.expectedPayloads.find((p) => p.expectedTermId === expected.id)
              ?.payload ?? null;
          const structuredPayload =
            gold?.termType === "BASE_RENT"
              ? {
                  termType: "BASE_RENT" as const,
                  rent: { ...gold.rent, rentStructure: null },
                  inlineEscalation: null,
                }
              : gold;
          return {
            canonicalType: expected.canonicalType,
            normalizedValue: expected.normalizedValue ?? null,
            normalizedNumeric: expected.normalizedNumeric ?? null,
            normalizedUnit: expected.normalizedUnit ?? null,
            rawValue: expected.evidence,
            status: expected.status,
            confidence: 0.99,
            evidenceQuote: expected.evidence,
            sourceLocation: null,
            structuredPayload,
          };
        }
      );
      return { model: "boundary-nulls", extraction: { terms, overallConfidence: 0.99 } };
    },
  });

  const v2 = runV2LiveEvaluation({ v1Report: v1, fixtures: [fixture] });
  assert.equal(v2.extractionMetrics.payloadValidity.accuracy, 1);
  assert.equal(v2.extractionMetrics.payloadCoverage.accuracy, 1);
  assert.equal(
    v2.failures.filter((failure) => failure.phase === "VALIDATION").length,
    0
  );
});

test("live validation failures record the Zod path", async () => {
  const fixture = NEGOTIATION_FIXTURES.find((f) => f.id === "n01-simple-rent")!;
  const expectation = v2ExpectationFor("n01-simple-rent")!;
  const v1 = await runNegotiationEvaluation({
    fixtures: [fixture],
    cacheDir: false,
    now: () => new Date("2026-09-28T16:00:00.000Z"),
    extractor: async (input) => {
      const document = fixture.documents.find((d) => d.name === input.documentName)!;
      const docExp = expectation.documents?.find((d) => d.documentId === document.id);
      const terms: NegotiationExtraction["terms"] = document.expectedTerms.map(
        (expected) => ({
          canonicalType: expected.canonicalType,
          normalizedValue: expected.normalizedValue ?? null,
          normalizedNumeric: expected.normalizedNumeric ?? null,
          normalizedUnit: expected.normalizedUnit ?? null,
          rawValue: expected.evidence,
          status: expected.status,
          confidence: 0.99,
          evidenceQuote: expected.evidence,
          sourceLocation: null,
          structuredPayload:
            docExp?.expectedPayloads.find((p) => p.expectedTermId === expected.id)
              ?.payload.termType === "BASE_RENT"
              ? {
                  termType: "BASE_RENT" as const,
                  rent: {
                    kind: "simple" as const,
                    amountPerRSFYear: 42,
                    rentStructure: "NOT_A_STRUCTURE" as "NNN",
                  },
                }
              : null,
        })
      );
      return { model: "bad-enum", extraction: { terms, overallConfidence: 0.99 } };
    },
  });

  const v2 = runV2LiveEvaluation({ v1Report: v1, fixtures: [fixture] });
  const validation = v2.failures.find((failure) => failure.phase === "VALIDATION");
  assert.ok(validation);
  assert.match(
    validation.description,
    /BASE_RENT\.rent\.rentStructure: Invalid enum value\. Expected 'NNN' \| 'GROSS' \| 'MODIFIED_GROSS' \| 'BASE_YEAR' \| 'OTHER', received 'NOT_A_STRUCTURE'/
  );
  assert.equal(JSON.stringify(validation).includes(fixture.documents[0]!.text), false);
});
