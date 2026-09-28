/**
 * evals/negotiation/v2/stateScoring.ts
 *
 * Scores resolveStructuredState output against V2 expected structured state.
 *
 * Distinguishes:
 *   - tenant / landlord current-position accuracy
 *   - agreement accuracy
 *   - conflict-detection accuracy
 *   - carry-forward accuracy
 *   - provenance validity
 *
 * Does NOT compare JSON strings. Payload comparison uses scorePayload().
 */

import type { CREStructuredPayload } from "@/lib/ai/negotiation/payloads";
import {
  isSideConflict,
  type RoundWithPayload,
  type SideResult,
  type StructuredCurrentTermState,
} from "@/lib/negotiation/resolveStructuredState";
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
  SemanticScore,
  V2Failure,
  V2StateMetrics,
  V2TypeExpectation,
} from "./types";
import { addAvg, addCount, emptyExtractionMetrics, emptyStateMetrics } from "./metrics";
import type { V2ExtractionMetrics } from "./types";

const PENDING_ID = "pending";

export interface ProvenanceContext {
  /** All real observation IDs visible to this resolution (input term IDs). */
  inputTermIds: Set<string>;
  /** evidenceQuote by term id, for source-evidence availability. */
  evidenceById: Map<string, string>;
}

export interface StateScoreResult {
  tenantCorrect: boolean | null;
  landlordCorrect: boolean | null;
  agreementCorrect: boolean | null;
  conflictCorrect: boolean | null;
  carryForwardCorrect: boolean | null;
  provenanceCorrect: boolean;
  semanticScore: SemanticScore | null;
  scheduleScore: number | null;
  periodScore: number | null;
  rightsScore: number | null;
  conditionsScore: number | null;
  failures: V2Failure[];
}

function fail(
  scenarioId: string,
  canonicalType: V2TypeExpectation["canonicalType"],
  phase: FailurePhase,
  description: string,
  expected?: unknown,
  actual?: unknown
): V2Failure {
  return { scenarioId, canonicalType, phase, description, expected, actual };
}

function payloadOf(side: SideResult | undefined): CREStructuredPayload | undefined {
  if (!side || isSideConflict(side)) return undefined;
  return side.payload;
}

/**
 * Greedy one-to-one match of expected conflict candidates to actual candidates.
 * Each expected candidate must uniquely match an actual candidate at perfect
 * semantic score. Extra actual candidates are not a failure if all expected
 * are present (duplicates of the same payload can appear).
 */
function matchConflictCandidates(
  actual: CREStructuredPayload[],
  expected: CREStructuredPayload[]
): { allMatched: boolean; dropped: CREStructuredPayload[]; unmatchedActual: CREStructuredPayload[] } {
  const used = new Set<number>();
  const dropped: CREStructuredPayload[] = [];
  for (const exp of expected) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < actual.length; i++) {
      if (used.has(i)) continue;
      const score = scorePayload(actual[i]!, exp);
      if (isPerfectSemanticScore(score) && score.score > bestScore) {
        bestScore = score.score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) dropped.push(exp);
    else used.add(bestIdx);
  }
  const unmatchedActual = actual.filter((_, i) => !used.has(i));
  return { allMatched: dropped.length === 0, dropped, unmatchedActual };
}

function collectNestedObservationIds(payload: CREStructuredPayload): string[] {
  const ids: string[] = [];
  if (payload.termType === "BASE_RENT" && payload.rent.kind === "stepped") {
    for (const step of payload.rent.steps) {
      if (step.observationRef?.observationId) {
        ids.push(step.observationRef.observationId);
      }
    }
  }
  if (payload.termType === "FREE_RENT" && payload.abatement.kind === "irregular") {
    for (const period of payload.abatement.periods) {
      if (period.observationRef?.observationId) {
        ids.push(period.observationRef.observationId);
      }
    }
  }
  return ids;
}

function collectResolvedIds(state: StructuredCurrentTermState): string[] {
  const ids = [...state.sourceObservationIds];
  const pushSide = (side: SideResult | undefined) => {
    if (!side) return;
    if (isSideConflict(side)) {
      for (const c of side.candidates) {
        ids.push(...c.observationIds);
        ids.push(...collectNestedObservationIds(c.payload));
      }
    } else {
      ids.push(...side.observationIds);
      ids.push(...collectNestedObservationIds(side.payload));
    }
  };
  pushSide(state.tenant);
  pushSide(state.landlord);
  if (state.agreed) {
    ids.push(...state.agreed.observationIds);
    ids.push(...collectNestedObservationIds(state.agreed.payload));
  }
  return ids;
}

export function scoreProvenance(
  state: StructuredCurrentTermState,
  ctx: ProvenanceContext
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const ids = collectResolvedIds(state);
  for (const id of ids) {
    if (id === PENDING_ID) {
      reasons.push('resolved output contains observationId "pending"');
    }
    if (!ctx.inputTermIds.has(id)) {
      reasons.push("resolved observationId is not a real input term id: " + id);
    } else {
      const evidence = ctx.evidenceById.get(id);
      if (evidence === undefined || evidence.trim().length === 0) {
        reasons.push("source evidence missing for observationId " + id);
      }
    }
  }
  return { valid: reasons.length === 0, reasons };
}

function scoreOneSide(params: {
  scenarioId: string;
  expected: V2TypeExpectation;
  actual: SideResult | undefined;
  expectedPayload: CREStructuredPayload | undefined;
  sideLabel: "tenant" | "landlord";
  phase: FailurePhase;
}): { correct: boolean | null; score: SemanticScore | null; failures: V2Failure[] } {
  const { scenarioId, expected, actual, expectedPayload, sideLabel, phase } = params;
  if (expectedPayload === undefined) {
    return { correct: null, score: null, failures: [] };
  }
  const failures: V2Failure[] = [];
  if (!actual) {
    failures.push(
      fail(
        scenarioId,
        expected.canonicalType,
        phase,
        `missing ${sideLabel} position`,
        expectedPayload,
        undefined
      )
    );
    return { correct: false, score: null, failures };
  }
  if (isSideConflict(actual)) {
    failures.push(
      fail(
        scenarioId,
        expected.canonicalType,
        phase,
        `${sideLabel} position is CONFLICT; a single payload was expected`,
        expectedPayload,
        actual.candidates.map((c) => c.payload)
      )
    );
    return { correct: false, score: null, failures };
  }
  const score = scorePayload(actual.payload, expectedPayload);
  if (!isPerfectSemanticScore(score)) {
    failures.push(
      fail(
        scenarioId,
        expected.canonicalType,
        phase,
        `${sideLabel} payload semantic mismatch (score ${score.score.toFixed(3)})`,
        expectedPayload,
        actual.payload
      )
    );
    return { correct: false, score, failures };
  }
  return { correct: true, score, failures };
}

/**
 * Score one resolved StructuredCurrentTermState against one V2TypeExpectation.
 *
 * `phase` is RESOLUTION for oracle runs. Live scoring passes RESOLUTION when
 * extraction was perfect, otherwise EXTRACTION so the state miss is attributed
 * to bad model input rather than the resolver.
 */
export function scoreStructuredState(params: {
  scenarioId: string;
  expected: V2TypeExpectation;
  actual: StructuredCurrentTermState;
  provenance: ProvenanceContext;
  phase: FailurePhase;
}): StateScoreResult {
  const { scenarioId, expected, actual, provenance, phase } = params;
  const failures: V2Failure[] = [];
  let semanticScore: SemanticScore | null = null;
  let scheduleScore: number | null = null;
  let periodScore: number | null = null;
  let rightsScore: number | null = null;
  let conditionsScore: number | null = null;

  const recordScore = (
    score: SemanticScore | null,
    actualPayload: CREStructuredPayload | undefined,
    expectedPayload: CREStructuredPayload | undefined
  ) => {
    if (!score || !actualPayload || !expectedPayload) return;
    semanticScore = score;
    scheduleScore = scheduleComponentScore(score);
    periodScore = periodComponentScore(score);
    rightsScore = rightsScoreFor(actualPayload, expectedPayload, score);
    conditionsScore = conditionsComponentScore(score);
  };

  // ── Conflict detection ────────────────────────────────────────────────────
  let conflictCorrect: boolean | null = null;
  const tenantIsConflict = actual.tenant ? isSideConflict(actual.tenant) : false;
  const landlordIsConflict = actual.landlord
    ? isSideConflict(actual.landlord)
    : false;

  if (expected.conflictExpected) {
    const side = expected.conflictSide ?? "LANDLORD";
    const conflictSideResult = side === "TENANT" ? actual.tenant : actual.landlord;
    const isConflict = conflictSideResult
      ? isSideConflict(conflictSideResult)
      : false;
    if (!isConflict) {
      conflictCorrect = false;
      const selected = payloadOf(conflictSideResult);
      failures.push(
        fail(
          scenarioId,
          expected.canonicalType,
          phase,
          selected
            ? "CONFLICT expected but resolver selected a single candidate"
            : "CONFLICT expected but no position was produced",
          expected.conflictCandidates,
          selected ?? conflictSideResult
        )
      );
    } else if (isSideConflict(conflictSideResult!)) {
      const candidates = conflictSideResult.candidates.map((c) => c.payload);
      const expectedCandidates = expected.conflictCandidates ?? [];
      if (expectedCandidates.length === 0) {
        conflictCorrect = candidates.length >= 2;
        if (!conflictCorrect) {
          failures.push(
            fail(
              scenarioId,
              expected.canonicalType,
              phase,
              "CONFLICT must preserve at least two candidates",
              undefined,
              candidates
            )
          );
        }
      } else {
        const matched = matchConflictCandidates(candidates, expectedCandidates);
        conflictCorrect = matched.allMatched && candidates.length >= expectedCandidates.length;
        if (!conflictCorrect) {
          failures.push(
            fail(
              scenarioId,
              expected.canonicalType,
              phase,
              matched.dropped.length
                ? "CONFLICT dropped one or more candidates"
                : "CONFLICT candidate set does not match expected A/B",
              expectedCandidates,
              candidates
            )
          );
        }
      }
      if (actual.status === "AGREED" || actual.agreed) {
        conflictCorrect = false;
        failures.push(
          fail(
            scenarioId,
            expected.canonicalType,
            phase,
            "CONFLICT case must not be declared AGREED",
            "UNRESOLVED",
            actual.status
          )
        );
      }
    }
  } else {
    const unexpected = tenantIsConflict || landlordIsConflict;
    conflictCorrect = !unexpected;
    if (unexpected) {
      failures.push(
        fail(
          scenarioId,
          expected.canonicalType,
          phase,
          "unexpected CONFLICT (false positive)",
          "no conflict",
          {
            tenant: tenantIsConflict,
            landlord: landlordIsConflict,
          }
        )
      );
    }
  }

  // ── Tenant / landlord positions ───────────────────────────────────────────
  const conflictSide = expected.conflictExpected
    ? expected.conflictSide
    : undefined;

  const tenant = scoreOneSide({
    scenarioId,
    expected,
    actual: actual.tenant,
    expectedPayload:
      conflictSide === "TENANT" ? undefined : expected.tenantPayload,
    sideLabel: "tenant",
    phase,
  });
  const landlord = scoreOneSide({
    scenarioId,
    expected,
    actual: actual.landlord,
    expectedPayload:
      conflictSide === "LANDLORD" ? undefined : expected.landlordPayload,
    sideLabel: "landlord",
    phase,
  });
  failures.push(...tenant.failures, ...landlord.failures);
  recordScore(
    tenant.score ?? landlord.score,
    payloadOf(actual.tenant) ?? payloadOf(actual.landlord),
    expected.tenantPayload ?? expected.landlordPayload
  );

  // ── Agreement ─────────────────────────────────────────────────────────────
  let agreementCorrect: boolean | null = null;
  if (expected.status === "AGREED" || expected.agreedPayload) {
    agreementCorrect = actual.status === "AGREED" && actual.agreed !== undefined;
    if (expected.agreedPayload && actual.agreed) {
      const score = scorePayload(actual.agreed.payload, expected.agreedPayload);
      recordScore(score, actual.agreed.payload, expected.agreedPayload);
      if (!isPerfectSemanticScore(score)) {
        agreementCorrect = false;
        failures.push(
          fail(
            scenarioId,
            expected.canonicalType,
            phase,
            `agreed payload semantic mismatch (score ${score.score.toFixed(3)})`,
            expected.agreedPayload,
            actual.agreed.payload
          )
        );
      }
    } else if (expected.agreedPayload && !actual.agreed) {
      agreementCorrect = false;
      failures.push(
        fail(
          scenarioId,
          expected.canonicalType,
          phase,
          "expected AGREED payload was not produced",
          expected.agreedPayload,
          undefined
        )
      );
    }
    if (actual.status !== "AGREED") {
      agreementCorrect = false;
      failures.push(
        fail(
          scenarioId,
          expected.canonicalType,
          phase,
          `expected status AGREED, got ${actual.status}`,
          "AGREED",
          actual.status
        )
      );
    }
  } else {
    agreementCorrect = actual.status !== "AGREED" && actual.agreed === undefined;
    if (!agreementCorrect) {
      failures.push(
        fail(
          scenarioId,
          expected.canonicalType,
          phase,
          "unexpected AGREED state",
          expected.status,
          actual.status
        )
      );
    }
  }

  // Status (non-agreement) is part of position correctness when expected
  if (expected.status !== "AGREED" && actual.status !== expected.status) {
    failures.push(
      fail(
        scenarioId,
        expected.canonicalType,
        phase,
        `status mismatch: expected ${expected.status}, got ${actual.status}`,
        expected.status,
        actual.status
      )
    );
    if (tenant.correct === true && expected.tenantPayload) tenant.correct = false;
    if (landlord.correct === true && expected.landlordPayload) {
      landlord.correct = false;
    }
  }

  // ── Carry-forward ─────────────────────────────────────────────────────────
  let carryForwardCorrect: boolean | null = null;
  if (expected.isCarryForward) {
    const side = expected.carryForwardSide ?? "TENANT";
    const expectedPayload =
      side === "TENANT" ? expected.tenantPayload : expected.landlordPayload;
    const sideCorrect =
      side === "TENANT" ? tenant.correct : landlord.correct;
    carryForwardCorrect = sideCorrect === true;
    if (!carryForwardCorrect) {
      failures.push(
        fail(
          scenarioId,
          expected.canonicalType,
          phase,
          `carry-forward failed: omitted ${side.toLowerCase()} ${expected.canonicalType} must persist`,
          expectedPayload,
          side === "TENANT" ? payloadOf(actual.tenant) : payloadOf(actual.landlord)
        )
      );
    }
  }

  // ── Provenance ────────────────────────────────────────────────────────────
  const provenanceResult = scoreProvenance(actual, provenance);
  if (!provenanceResult.valid) {
    for (const reason of provenanceResult.reasons) {
      failures.push(
        fail(scenarioId, expected.canonicalType, phase, reason)
      );
    }
  }

  return {
    tenantCorrect: tenant.correct,
    landlordCorrect: landlord.correct,
    agreementCorrect,
    conflictCorrect,
    carryForwardCorrect,
    provenanceCorrect: provenanceResult.valid,
    semanticScore,
    scheduleScore,
    periodScore,
    rightsScore,
    conditionsScore,
    failures,
  };
}

export function accumulateStateMetrics(
  metrics: V2StateMetrics,
  result: StateScoreResult
): void {
  if (result.tenantCorrect !== null) addCount(metrics.tenantPositionAccuracy, result.tenantCorrect);
  if (result.landlordCorrect !== null) {
    addCount(metrics.landlordPositionAccuracy, result.landlordCorrect);
  }
  if (result.agreementCorrect !== null) {
    addCount(metrics.agreementAccuracy, result.agreementCorrect);
  }
  if (result.conflictCorrect !== null) {
    addCount(metrics.conflictDetectionAccuracy, result.conflictCorrect);
  }
  if (result.carryForwardCorrect !== null) {
    addCount(metrics.carryForwardAccuracy, result.carryForwardCorrect);
  }
  addCount(metrics.provenanceValidity, result.provenanceCorrect);
}

export function accumulateExtractionFromStateScore(
  metrics: V2ExtractionMetrics,
  result: StateScoreResult
): void {
  if (result.semanticScore) {
    addAvg(metrics.semanticPayloadAccuracy, result.semanticScore.score);
  }
  addAvg(metrics.scheduleAccuracy, result.scheduleScore);
  addAvg(metrics.periodAccuracy, result.periodScore);
  addAvg(metrics.rightsAccuracy, result.rightsScore);
  addAvg(metrics.conditionsAccuracy, result.conditionsScore);
}

export function provenanceFromRounds(rounds: RoundWithPayload[]): ProvenanceContext {
  const inputTermIds = new Set<string>();
  const evidenceById = new Map<string, string>();
  for (const round of rounds) {
    for (const term of round.terms) {
      inputTermIds.add(term.id);
      evidenceById.set(term.id, term.evidenceQuote);
    }
  }
  return { inputTermIds, evidenceById };
}

export { emptyExtractionMetrics, emptyStateMetrics };
