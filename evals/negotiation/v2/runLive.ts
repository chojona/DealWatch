/**
 * evals/negotiation/v2/runLive.ts
 *
 * Live V2 scoring layer. Consumes a completed V1 EvaluationReport plus the
 * raw extraction terms (which carry structuredPayload) and scores V2
 * extraction and structured state independently of V1 metrics.
 *
 * V1 scoring is not called and V1 gold is not modified.
 */

import {
  coerceModelStructuredPayload,
  describeStructuredPayloadRejection,
  parseModelStructuredPayload,
  parseStructuredPayload,
  supportsStructuredPayload,
  type CRETermType,
} from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import {
  resolveStructuredState,
  type RoundWithPayload,
  type TermWithPayload,
} from "@/lib/negotiation/resolveStructuredState";
import type {
  DocumentEvaluation,
  EvaluationReport,
  NegotiationFixture,
} from "../types";
import { NEGOTIATION_FIXTURES } from "../fixtures";
import { v2ExpectationFor } from "./expectations";
import {
  accumulateStateMetrics,
  provenanceFromRounds,
  scoreStructuredState,
} from "./stateScoring";
import {
  addAvg,
  addCount,
  emptyExtractionMetrics,
  emptyStateMetrics,
  mergeExtraction,
  mergeState,
  rankWeakest,
} from "./metrics";
import {
  conditionsComponentScore,
  isPerfectSemanticScore,
  periodComponentScore,
  rightsScoreFor,
  scheduleComponentScore,
  scorePayload,
} from "./scoring";
import type {
  FailurePhase,
  V2Failure,
  V2FixtureExpectation,
  V2LiveReport,
  V2LiveScenarioResult,
  V2LiveTypeResult,
} from "./types";

function termIdFor(
  fixtureId: string,
  documentId: string,
  evaluation: DocumentEvaluation,
  predictedIndex: number
): string {
  const match = evaluation.matches.find(
    (m) =>
      m.predictedIndex === predictedIndex &&
      m.evidenceSupported &&
      m.numericCorrect !== false
  );
  return (
    match?.expectedTermId ??
    fixtureId + ":" + documentId + ":prediction-" + predictedIndex
  );
}

function roundsFromV1Scenario(
  fixture: NegotiationFixture,
  documents: DocumentEvaluation[]
): RoundWithPayload[] {
  return fixture.documents.map((doc) => {
    const evaluation = documents.find((d) => d.id === doc.id);
    const date = new Date(doc.date);
    const terms: TermWithPayload[] = (evaluation?.validatedTerms ?? []).map(
      (term, predictedIndex) => {
        const payload =
          supportsStructuredPayload(term.canonicalType) &&
          term.structuredPayload != null
            ? parseModelStructuredPayload(
                term.structuredPayload,
                term.canonicalType
              )
            : null;
        return {
          id: evaluation
            ? termIdFor(fixture.id, doc.id, evaluation, predictedIndex)
            : fixture.id + ":" + doc.id + ":prediction-" + predictedIndex,
          canonicalType: term.canonicalType,
          normalizedValue: term.normalizedValue ?? null,
          normalizedNumeric: term.normalizedNumeric ?? null,
          normalizedUnit: term.normalizedUnit ?? null,
          rawValue: term.rawValue,
          status: term.status,
          side: doc.side,
          roundNumber: doc.roundNumber,
          confidence: term.confidence,
          evidenceQuote: term.evidenceQuote,
          sourceLocation: term.sourceLocation ?? null,
          structuredPayload: payload,
        };
      }
    );
    return {
      id: fixture.id + ":" + doc.id,
      side: doc.side,
      roundNumber: doc.roundNumber,
      documentName: doc.name,
      documentText: doc.text,
      documentDate: date,
      createdAt: date,
      terms,
    };
  });
}

function scoreLiveExtraction(
  scenarioId: string,
  expectation: V2FixtureExpectation,
  fixture: NegotiationFixture,
  documents: DocumentEvaluation[],
  canonicalType: CRETermType
): {
  coverageCorrect: boolean;
  validityCorrect: boolean;
  semanticScores: number[];
  scheduleScores: number[];
  periodScores: number[];
  rightsScores: number[];
  conditionsScores: number[];
  extractionPerfect: boolean;
  failures: V2Failure[];
} {
  const failures: V2Failure[] = [];
  const semanticScores: number[] = [];
  const scheduleScores: number[] = [];
  const periodScores: number[] = [];
  const rightsScores: number[] = [];
  const conditionsScores: number[] = [];
  let coverageCorrect = 0;
  let coverageTotal = 0;
  let validityCorrect = 0;
  let validityTotal = 0;
  let extractionPerfect = true;

  const fail = (
    phase: FailurePhase,
    description: string,
    expected?: unknown,
    actual?: unknown
  ): V2Failure => ({
    scenarioId,
    canonicalType,
    phase,
    description,
    expected,
    actual,
  });

  for (const docExp of expectation.documents ?? []) {
    const v1Doc = fixture.documents.find((d) => d.id === docExp.documentId);
    const evaluation = documents.find((d) => d.id === docExp.documentId);
    if (!v1Doc || !evaluation) continue;

    for (const expectedPayload of docExp.expectedPayloads) {
      if (expectedPayload.payload.termType !== canonicalType) continue;
      coverageTotal += 1;
      const match = evaluation.matches.find(
        (m) => m.expectedTermId === expectedPayload.expectedTermId
      );
      if (!match) {
        extractionPerfect = false;
        failures.push(
          fail(
            "EXTRACTION",
            "expected structured payload was not extracted",
            expectedPayload.payload
          )
        );
        continue;
      }
      const predicted = evaluation.validatedTerms[match.predictedIndex];
      const raw = evaluation.rawTerms.find(
        (candidate) =>
          candidate.canonicalType === expectedPayload.payload.termType &&
          candidate.evidenceQuote === predicted?.evidenceQuote
      ) ?? evaluation.rawTerms[match.predictedIndex];

      const validatedPayload = predicted?.structuredPayload;
      const rawPayload = raw?.structuredPayload;

      if (validatedPayload == null && rawPayload == null) {
        extractionPerfect = false;
        failures.push(
          fail(
            "EXTRACTION",
            "matched term has no structuredPayload",
            expectedPayload.payload
          )
        );
        continue;
      }
      const boundaryRaw =
        rawPayload == null ? rawPayload : coerceModelStructuredPayload(rawPayload);
      if (rawPayload != null) {
        validityTotal += 1;
        const parsedRaw = parseModelStructuredPayload(
          rawPayload,
          canonicalType as CanonicalTermType
        );
        if (!parsedRaw) {
          extractionPerfect = false;
          const detail = describeStructuredPayloadRejection(
            boundaryRaw,
            canonicalType as CanonicalTermType
          );
          failures.push(
            fail(
              "VALIDATION",
              detail
                ? "structuredPayload failed Zod validation: " + detail
                : "structuredPayload failed Zod validation",
              expectedPayload.payload,
              boundaryRaw
            )
          );
          continue;
        }
        validityCorrect += 1;
      }
      const parsed =
        validatedPayload != null
          ? parseStructuredPayload(
              validatedPayload,
              canonicalType as CanonicalTermType
            )
          : parseModelStructuredPayload(
              rawPayload,
              canonicalType as CanonicalTermType
            );
      if (!parsed) {
        extractionPerfect = false;
        const rejected = validatedPayload ?? boundaryRaw;
        const detail = describeStructuredPayloadRejection(
          rejected,
          canonicalType as CanonicalTermType
        );
        failures.push(
          fail(
            "VALIDATION",
            detail
              ? "structuredPayload failed Zod validation: " + detail
              : "structuredPayload failed Zod validation",
            expectedPayload.payload,
            rejected
          )
        );
        continue;
      }
      coverageCorrect += 1;
      const score = scorePayload(parsed, expectedPayload.payload);
      semanticScores.push(score.score);
      const schedule = scheduleComponentScore(score);
      if (schedule !== null) scheduleScores.push(schedule);
      const period = periodComponentScore(score);
      if (period !== null) periodScores.push(period);
      const rights = rightsScoreFor(parsed, expectedPayload.payload, score);
      if (rights !== null) rightsScores.push(rights);
      const conditions = conditionsComponentScore(score);
      if (conditions !== null) conditionsScores.push(conditions);
      if (!isPerfectSemanticScore(score)) {
        extractionPerfect = false;
        failures.push(
          fail(
            "EXTRACTION",
            `payload semantic mismatch (score ${score.score.toFixed(3)})`,
            expectedPayload.payload,
            parsed
          )
        );
      }
    }
  }

  return {
    coverageCorrect: coverageTotal === 0 ? true : coverageCorrect === coverageTotal,
    validityCorrect: validityTotal === 0 ? true : validityCorrect === validityTotal,
    semanticScores,
    scheduleScores,
    periodScores,
    rightsScores,
    conditionsScores,
    extractionPerfect,
    failures,
  };
}

export function scoreV2LiveScenario(params: {
  expectation: V2FixtureExpectation;
  fixture: NegotiationFixture;
  documents: DocumentEvaluation[];
}): V2LiveScenarioResult {
  const { expectation, fixture, documents } = params;
  const rounds = roundsFromV1Scenario(fixture, documents);
  const provenance = provenanceFromRounds(rounds);
  const extractionMetrics = emptyExtractionMetrics();
  const stateMetrics = emptyStateMetrics();
  const allFailures: V2Failure[] = [];

  const typeResults: V2LiveTypeResult[] = expectation.expectedStructuredState.map(
    (expected) => {
      const extraction = scoreLiveExtraction(
        expectation.fixtureId,
        expectation,
        fixture,
        documents,
        expected.canonicalType
      );
      const actual = resolveStructuredState({
        rounds,
        canonicalType: expected.canonicalType,
      });
      const statePhase: FailurePhase = extraction.extractionPerfect
        ? "RESOLUTION"
        : "EXTRACTION";
      const scored = scoreStructuredState({
        scenarioId: expectation.fixtureId,
        expected,
        actual,
        provenance,
        phase: statePhase,
      });

      for (const score of extraction.semanticScores) {
        addAvg(extractionMetrics.semanticPayloadAccuracy, score);
      }
      for (const score of extraction.scheduleScores) {
        addAvg(extractionMetrics.scheduleAccuracy, score);
      }
      for (const score of extraction.periodScores) {
        addAvg(extractionMetrics.periodAccuracy, score);
      }
      for (const score of extraction.rightsScores) {
        addAvg(extractionMetrics.rightsAccuracy, score);
      }
      for (const score of extraction.conditionsScores) {
        addAvg(extractionMetrics.conditionsAccuracy, score);
      }
      addCount(extractionMetrics.payloadCoverage, extraction.coverageCorrect);
      addCount(extractionMetrics.payloadValidity, extraction.validityCorrect);

      accumulateStateMetrics(stateMetrics, scored);

      const failures = [...extraction.failures, ...scored.failures];
      allFailures.push(...failures);

      return {
        scenarioId: expectation.fixtureId,
        canonicalType: expected.canonicalType,
        extraction: {
          coverageCorrect: extraction.coverageCorrect,
          validityCorrect: extraction.validityCorrect,
          semanticScore:
            extraction.semanticScores.length > 0
              ? {
                  score:
                    extraction.semanticScores.reduce((a, b) => a + b, 0) /
                    extraction.semanticScores.length,
                  rawScore: extraction.semanticScores.reduce((a, b) => a + b, 0),
                  maxRawScore: extraction.semanticScores.length,
                  components: {},
                }
              : null,
          scheduleScore:
            extraction.scheduleScores.length > 0
              ? extraction.scheduleScores.reduce((a, b) => a + b, 0) /
                extraction.scheduleScores.length
              : null,
          periodScore:
            extraction.periodScores.length > 0
              ? extraction.periodScores.reduce((a, b) => a + b, 0) /
                extraction.periodScores.length
              : null,
          rightsScore:
            extraction.rightsScores.length > 0
              ? extraction.rightsScores.reduce((a, b) => a + b, 0) /
                extraction.rightsScores.length
              : null,
          conditionsScore:
            extraction.conditionsScores.length > 0
              ? extraction.conditionsScores.reduce((a, b) => a + b, 0) /
                extraction.conditionsScores.length
              : null,
        },
        state: {
          tenantCorrect: scored.tenantCorrect,
          landlordCorrect: scored.landlordCorrect,
          agreementCorrect: scored.agreementCorrect,
          conflictCorrect: scored.conflictCorrect,
          carryForwardCorrect: scored.carryForwardCorrect,
          provenanceCorrect: scored.provenanceCorrect,
          semanticScore: scored.semanticScore,
          actualState: actual,
        },
        failures,
      };
    }
  );

  return {
    scenarioId: expectation.fixtureId,
    description: expectation.description,
    tags: expectation.tags,
    typeResults,
    extractionMetrics,
    stateMetrics,
    failures: allFailures,
  };
}

export function runV2LiveEvaluation(params: {
  v1Report: EvaluationReport;
  fixtures?: readonly NegotiationFixture[];
  now?: () => Date;
}): V2LiveReport {
  const fixtures = params.fixtures ?? NEGOTIATION_FIXTURES;
  const generatedAt = (params.now ?? (() => new Date()))().toISOString();
  const scenarios: V2LiveScenarioResult[] = [];

  for (const v1Scenario of params.v1Report.scenarios) {
    const expectation = v2ExpectationFor(v1Scenario.id);
    if (!expectation) continue;
    const fixture = fixtures.find((f) => f.id === v1Scenario.id);
    if (!fixture) continue;
    scenarios.push(
      scoreV2LiveScenario({
        expectation,
        fixture,
        documents: v1Scenario.documents,
      })
    );
  }

  const extractionMetrics = emptyExtractionMetrics();
  const stateMetrics = emptyStateMetrics();
  for (const scenario of scenarios) {
    mergeExtraction(extractionMetrics, scenario.extractionMetrics);
    mergeState(stateMetrics, scenario.stateMetrics);
  }

  const weakestScenarios = rankWeakest(
    scenarios.map((s) => ({
      scenarioId: s.scenarioId,
      description: s.description,
      semanticAccuracy: s.extractionMetrics.semanticPayloadAccuracy.avgAccuracy,
      tenantPositionAccuracy: s.stateMetrics.tenantPositionAccuracy.accuracy,
      landlordPositionAccuracy: s.stateMetrics.landlordPositionAccuracy.accuracy,
      conflictDetectionAccuracy:
        s.stateMetrics.conflictDetectionAccuracy.accuracy,
      carryForwardAccuracy: s.stateMetrics.carryForwardAccuracy.accuracy,
      failureCount: s.failures.length,
    }))
  );

  return {
    schemaVersion: "2.0",
    mode: "live",
    generatedAt,
    provider: params.v1Report.run.provider,
    model: params.v1Report.run.model,
    scenarios,
    extractionMetrics,
    stateMetrics,
    failures: scenarios.flatMap((s) => s.failures),
    weakestScenarios,
  };
}
