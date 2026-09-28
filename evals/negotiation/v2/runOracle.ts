/**
 * evals/negotiation/v2/runOracle.ts
 *
 * Offline resolver oracle: feeds hand-authored perfect structured
 * observations into resolveStructuredState and scores the derived state.
 *
 * No model calls. Failures are attributed to RESOLUTION (the input is
 * definitionally correct). A score below 100% is a resolver bug, not a
 * model problem.
 */

import {
  resolveStructuredState,
  type RoundWithPayload,
  type TermWithPayload,
} from "@/lib/negotiation/resolveStructuredState";
import { ORACLE_FIXTURES } from "./oracleFixtures";
import {
  accumulateExtractionFromStateScore,
  accumulateStateMetrics,
  provenanceFromRounds,
  scoreStructuredState,
} from "./stateScoring";
import {
  emptyExtractionMetrics,
  emptyStateMetrics,
  rankWeakest,
} from "./metrics";
import type {
  OracleFixtureInput,
  OracleScenarioResult,
  OracleTestResult,
  V2OracleReport,
  V2WeakestScenario,
} from "./types";

export function roundsFromOracle(input: OracleFixtureInput): RoundWithPayload[] {
  return input.rounds.map((r) => ({
    id: r.id,
    side: r.side,
    roundNumber: r.roundNumber,
    documentName: r.id,
    documentText: r.observations.map((o) => o.evidenceQuote).join("\n"),
    documentDate: new Date(r.date),
    createdAt: new Date(r.date),
    terms: r.observations.map(
      (o): TermWithPayload => ({
        id: o.id,
        canonicalType: o.canonicalType,
        normalizedValue: null,
        normalizedNumeric: null,
        normalizedUnit: null,
        rawValue: o.evidenceQuote,
        status: o.status,
        side: o.side,
        roundNumber: o.roundNumber,
        confidence: 1,
        evidenceQuote: o.evidenceQuote,
        sourceLocation: null,
        structuredPayload: o.structuredPayload,
      })
    ),
  }));
}

export function runOracleScenario(input: OracleFixtureInput): OracleScenarioResult {
  const rounds = roundsFromOracle(input);
  const provenance = provenanceFromRounds(rounds);
  const typeResults: OracleTestResult[] = input.expectedStructuredState.map(
    (expected) => {
      const actual = resolveStructuredState({
        rounds,
        canonicalType: expected.canonicalType,
      });
      const scored = scoreStructuredState({
        scenarioId: input.id,
        expected,
        actual,
        provenance,
        phase: "RESOLUTION",
      });
      const passed = scored.failures.length === 0;
      return {
        scenarioId: input.id,
        canonicalType: expected.canonicalType,
        passed,
        semanticScore: scored.semanticScore ?? {
          score: passed ? 1 : 0,
          rawScore: passed ? 1 : 0,
          maxRawScore: 1,
          components: {},
        },
        actualState: actual,
        expectedState: expected,
        failures: scored.failures,
      };
    }
  );
  return {
    scenarioId: input.id,
    description: input.description,
    tags: input.tags,
    typeResults,
    allPassed: typeResults.every((r) => r.passed),
  };
}

export function runOracleEvaluation(params?: {
  fixtures?: readonly OracleFixtureInput[];
  now?: () => Date;
}): V2OracleReport {
  const fixtures = [...(params?.fixtures ?? ORACLE_FIXTURES)];
  const generatedAt = (params?.now ?? (() => new Date()))().toISOString();

  const stateMetrics = emptyStateMetrics();
  const extractionMetrics = emptyExtractionMetrics();
  const scenarios: OracleScenarioResult[] = [];
  const weakestRaw: V2WeakestScenario[] = [];

  let observationCount = 0;
  for (const fixture of fixtures) {
    for (const round of fixture.rounds) {
      observationCount += round.observations.length;
    }
  }
  extractionMetrics.payloadCoverage = {
    correct: observationCount,
    total: observationCount,
    accuracy: observationCount === 0 ? null : 1,
  };
  extractionMetrics.payloadValidity = {
    correct: observationCount,
    total: observationCount,
    accuracy: observationCount === 0 ? null : 1,
  };

  for (const fixture of fixtures) {
    const rounds = roundsFromOracle(fixture);
    const provenance = provenanceFromRounds(rounds);
    const typeResults: OracleTestResult[] = [];
    let tenantCorrect = 0;
    let tenantTotal = 0;
    let landlordCorrect = 0;
    let landlordTotal = 0;
    let conflictCorrect = 0;
    let conflictTotal = 0;
    let carryCorrect = 0;
    let carryTotal = 0;

    for (const expected of fixture.expectedStructuredState) {
      const actual = resolveStructuredState({
        rounds,
        canonicalType: expected.canonicalType,
      });
      const scored = scoreStructuredState({
        scenarioId: fixture.id,
        expected,
        actual,
        provenance,
        phase: "RESOLUTION",
      });
      accumulateStateMetrics(stateMetrics, scored);
      accumulateExtractionFromStateScore(extractionMetrics, scored);
      if (scored.tenantCorrect !== null) {
        tenantTotal += 1;
        if (scored.tenantCorrect) tenantCorrect += 1;
      }
      if (scored.landlordCorrect !== null) {
        landlordTotal += 1;
        if (scored.landlordCorrect) landlordCorrect += 1;
      }
      if (scored.conflictCorrect !== null) {
        conflictTotal += 1;
        if (scored.conflictCorrect) conflictCorrect += 1;
      }
      if (scored.carryForwardCorrect !== null) {
        carryTotal += 1;
        if (scored.carryForwardCorrect) carryCorrect += 1;
      }
      const passed = scored.failures.length === 0;
      typeResults.push({
        scenarioId: fixture.id,
        canonicalType: expected.canonicalType,
        passed,
        semanticScore: scored.semanticScore ?? {
          score: passed ? 1 : 0,
          rawScore: passed ? 1 : 0,
          maxRawScore: 1,
          components: {},
        },
        actualState: actual,
        expectedState: expected,
        failures: scored.failures,
      });
    }

    const scenario: OracleScenarioResult = {
      scenarioId: fixture.id,
      description: fixture.description,
      tags: fixture.tags,
      typeResults,
      allPassed: typeResults.every((r) => r.passed),
    };
    scenarios.push(scenario);
    weakestRaw.push({
      scenarioId: fixture.id,
      description: fixture.description,
      semanticAccuracy:
        typeResults.reduce((sum, t) => sum + t.semanticScore.score, 0) /
        Math.max(1, typeResults.length),
      tenantPositionAccuracy: tenantTotal === 0 ? null : tenantCorrect / tenantTotal,
      landlordPositionAccuracy:
        landlordTotal === 0 ? null : landlordCorrect / landlordTotal,
      conflictDetectionAccuracy:
        conflictTotal === 0 ? null : conflictCorrect / conflictTotal,
      carryForwardAccuracy: carryTotal === 0 ? null : carryCorrect / carryTotal,
      failureCount: typeResults.filter((t) => !t.passed).length,
    });
  }

  const failures = scenarios.flatMap((s) =>
    s.typeResults.flatMap((t) => t.failures)
  );

  return {
    schemaVersion: "2.0",
    mode: "oracle",
    generatedAt,
    scenarios,
    extractionMetrics,
    stateMetrics,
    failures,
    resolverBugs: scenarios.some((s) => !s.allPassed)
      ? [...new Set(failures.map((f) => `${f.scenarioId}/${f.canonicalType}: ${f.description}`))]
      : [],
    weakestScenarios: rankWeakest(weakestRaw),
    allPassed: scenarios.every((s) => s.allPassed),
  };
}
