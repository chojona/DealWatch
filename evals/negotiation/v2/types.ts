/**
 * evals/negotiation/v2/types.ts
 *
 * Type definitions for CRE Ontology Evaluation V2.
 *
 * V2 asks: "Did we understand the actual CRE structure and resolve the
 * negotiation state correctly?"
 *
 * V1 types in ../types.ts are NOT modified. V2 types are additive.
 */

import type { CREStructuredPayload, CRETermType } from "@/lib/ai/negotiation/payloads";
import type { NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";
import type { StructuredCurrentTermState } from "@/lib/negotiation/resolveStructuredState";

// ─── V2 fixture expectations ──────────────────────────────────────────────────

/**
 * Expected structured state for one canonical type in a V2 scenario.
 *
 * Defines what the resolver must produce for correct structured understanding.
 * Does NOT replace V1 expectedState — sits alongside it.
 */
export interface V2TypeExpectation {
  canonicalType: CRETermType;
  /**
   * Expected overall negotiation status for this term type.
   */
  status: NegotiationTermStatus;
  /**
   * When true: resolver must surface a CONFLICT on conflictSide (or both),
   * with all candidates preserved. Arbitrary selection of A or B, declaring
   * agreement, or dropping a candidate = failure.
   * When false: resolver must NOT produce CONFLICT on either side.
   */
  conflictExpected?: boolean;
  /** Side that must carry the CONFLICT. Required when conflictExpected. */
  conflictSide?: "TENANT" | "LANDLORD";
  /**
   * Expected CONFLICT candidates. Both (all) must be present.
   * Used only when conflictExpected is true.
   */
  conflictCandidates?: CREStructuredPayload[];
  /**
   * Expected tenant structured payload.
   * If undefined, tenant position is not evaluated (not necessarily absent).
   * When conflictExpected and conflictSide === "TENANT", this is ignored.
   */
  tenantPayload?: CREStructuredPayload;
  /**
   * Expected landlord structured payload.
   */
  landlordPayload?: CREStructuredPayload;
  /**
   * Expected agreed payload. Only relevant when status === "AGREED".
   * When status !== "AGREED", agreed must be absent.
   */
  agreedPayload?: CREStructuredPayload;
  /**
   * When true, this case tests carry-forward:
   * a side's prior position must persist even though a later round omits it.
   * Omission must NOT be interpreted as withdrawal.
   */
  isCarryForward?: boolean;
  /** Side whose omitted term must carry forward. Required when isCarryForward. */
  carryForwardSide?: "TENANT" | "LANDLORD";
}

/**
 * Expected structured payload for one V1 expected term (live extraction scoring).
 * Keyed by V1 ExpectedTerm.id so V2 does not duplicate document text.
 */
export interface V2ExpectedObservationPayload {
  expectedTermId: string;
  payload: CREStructuredPayload;
}

/**
 * Per-document extraction expectations. documentId matches V1 EvaluationDocument.id.
 */
export interface V2DocumentExpectation {
  documentId: string;
  expectedPayloads: V2ExpectedObservationPayload[];
}

/**
 * V2 expectations for one negotiation scenario.
 * fixtureId matches a V1 NegotiationFixture.id.
 * Types not listed in expectedStructuredState are not V2-evaluated.
 * Document payloads are optional: oracle-only scenarios omit them.
 */
export interface V2FixtureExpectation {
  fixtureId: string;
  description: string;
  tags: string[];
  /** Live-extraction gold. Omitted for oracle-only scenarios. */
  documents?: V2DocumentExpectation[];
  expectedStructuredState: V2TypeExpectation[];
}

// ─── Oracle types ─────────────────────────────────────────────────────────────

/**
 * A single hand-authored observation for the offline resolver oracle.
 *
 * These represent "perfect model output" — what a correct extraction model
 * would produce for a given document passage. They bypass the live model
 * entirely so we can test the deterministic resolver in isolation.
 */
export interface OracleObservation {
  /** Stable, hand-authored term ID (never "pending"). */
  id: string;
  canonicalType: CRETermType;
  side: "TENANT" | "LANDLORD";
  roundNumber: number;
  status: NegotiationTermStatus;
  structuredPayload: CREStructuredPayload;
  evidenceQuote: string;
}

/**
 * One round of hand-authored oracle observations.
 */
export interface OracleRoundInput {
  id: string;
  side: "TENANT" | "LANDLORD";
  roundNumber: number;
  /** ISO 8601 date string used for chronological ordering. */
  date: string;
  observations: OracleObservation[];
}

/**
 * Complete oracle input for one test scenario.
 *
 * Multiple canonical types may be evaluated from the same set of rounds
 * (each call to resolveStructuredState filters by canonicalType).
 */
export interface OracleFixtureInput {
  /** Unique ID. May match a V1 fixtureId or be a standalone oracle scenario. */
  id: string;
  description: string;
  tags: string[];
  rounds: OracleRoundInput[];
  expectedStructuredState: V2TypeExpectation[];
}

// ─── Semantic scoring ─────────────────────────────────────────────────────────

/**
 * Score for one dimension of a structured payload comparison.
 * score and maxScore are raw points; normalized = score / maxScore.
 */
export interface SemanticComponentScore {
  score: number;
  maxScore: number;
  note?: string;
}

/**
 * Semantic similarity score for one payload comparison.
 * NOT a string comparison — each component tests a CRE-meaningful dimension.
 */
export interface SemanticScore {
  /** Normalized 0.0–1.0. 1.0 = fully correct, 0.0 = completely wrong. */
  score: number;
  rawScore: number;
  maxRawScore: number;
  /** Per-dimension breakdown for debugging and partial-credit accounting. */
  components: Record<string, SemanticComponentScore>;
}

// ─── V2 metrics ───────────────────────────────────────────────────────────────

export interface V2CountMetric {
  correct: number;
  total: number;
  accuracy: number | null;
}

/**
 * Structured Extraction metrics.
 * These measure how well the model (or oracle) extracted structured payloads.
 * For oracle runs, coverage/validity are 100% by construction.
 */
export interface V2ExtractionMetrics {
  /** % of expected structured payloads that were actually produced. */
  payloadCoverage: V2CountMetric;
  /** % of produced payloads that pass Zod validation. */
  payloadValidity: V2CountMetric;
  /** Average semantic accuracy across all payload comparisons. */
  semanticPayloadAccuracy: { totalScore: number; count: number; avgAccuracy: number | null };
  /** BASE_RENT stepped: average step-level accuracy. */
  scheduleAccuracy: { totalScore: number; count: number; avgAccuracy: number | null };
  /** FREE_RENT irregular: average period-level accuracy. */
  periodAccuracy: { totalScore: number; count: number; avgAccuracy: number | null };
  /** RENEWAL/TERMINATION/EXPANSION: average rights accuracy. */
  rightsAccuracy: { totalScore: number; count: number; avgAccuracy: number | null };
  /** Terms with conditions fields: average accuracy. */
  conditionsAccuracy: { totalScore: number; count: number; avgAccuracy: number | null };
}

/**
 * Structured State metrics.
 * These measure how well the RESOLVER derived the current state.
 * A failure here when oracle inputs are perfect indicates a resolver bug.
 */
export interface V2StateMetrics {
  /** Tenant current-position accuracy. */
  tenantPositionAccuracy: V2CountMetric;
  /** Landlord current-position accuracy. */
  landlordPositionAccuracy: V2CountMetric;
  /** Agreement accuracy (status === AGREED with correct payload). */
  agreementAccuracy: V2CountMetric;
  /**
   * Conflict detection accuracy.
   * When conflictExpected: resolver must produce CONFLICT.
   * When not conflictExpected: resolver must NOT produce CONFLICT.
   */
  conflictDetectionAccuracy: V2CountMetric;
  /**
   * Carry-forward accuracy.
   * Omission of a term in a later round must not be treated as withdrawal.
   */
  carryForwardAccuracy: V2CountMetric;
  /** Provenance validity: resolved IDs must be real term IDs (never "pending"). */
  provenanceValidity: V2CountMetric;
}

// ─── Failure attribution ──────────────────────────────────────────────────────

/**
 * Phase at which a V2 failure occurred.
 *
 * EXTRACTION — model emitted the wrong payload structure
 * VALIDATION  — payload failed Zod schema validation
 * RESOLUTION  — resolver received correct input but produced wrong state
 * SCORING     — internal scoring comparison logic issue
 *
 * For oracle tests (no model), failures are always RESOLUTION.
 */
export type FailurePhase = "EXTRACTION" | "VALIDATION" | "RESOLUTION" | "SCORING";

export interface V2Failure {
  scenarioId: string;
  canonicalType: CRETermType;
  phase: FailurePhase;
  description: string;
  expected?: unknown;
  actual?: unknown;
}

// ─── Oracle result types ──────────────────────────────────────────────────────

export interface OracleTestResult {
  scenarioId: string;
  canonicalType: CRETermType;
  /** true when all assertions passed — resolver ceiling = 100% for this case. */
  passed: boolean;
  semanticScore: SemanticScore;
  actualState: StructuredCurrentTermState;
  expectedState: V2TypeExpectation;
  failures: V2Failure[];
}

export interface OracleScenarioResult {
  scenarioId: string;
  description: string;
  tags: string[];
  /** One result per canonical type in expectedStructuredState. */
  typeResults: OracleTestResult[];
  allPassed: boolean;
}

// ─── V2 report ─────────────────────────────────────────────────────────────────

export interface V2OracleReport {
  schemaVersion: "2.0";
  mode: "oracle";
  generatedAt: string;
  /** One result per OracleFixtureInput. */
  scenarios: OracleScenarioResult[];
  /** Aggregated extraction metrics. Oracle runs are 100% by construction. */
  extractionMetrics: V2ExtractionMetrics;
  /** Aggregated state metrics across all oracle scenarios. */
  stateMetrics: V2StateMetrics;
  /** All failures across all scenarios with attribution. */
  failures: V2Failure[];
  /** Resolver bugs identified (failures where oracle input was correct). */
  resolverBugs: string[];
  /** Scenarios with the weakest structured-state accuracy. */
  weakestScenarios: V2WeakestScenario[];
  /** true when all oracle cases passed (resolver ceiling = 100%). */
  allPassed: boolean;
}

export interface V2WeakestScenario {
  scenarioId: string;
  description: string;
  semanticAccuracy: number | null;
  tenantPositionAccuracy: number | null;
  landlordPositionAccuracy: number | null;
  conflictDetectionAccuracy: number | null;
  carryForwardAccuracy: number | null;
  failureCount: number;
}

/**
 * Live (model) evaluation of one canonical type in one scenario.
 * Separates extraction scoring from resolved-state scoring.
 */
export interface V2LiveTypeResult {
  scenarioId: string;
  canonicalType: CRETermType;
  extraction: {
    coverageCorrect: boolean;
    validityCorrect: boolean;
    semanticScore: SemanticScore | null;
    scheduleScore: number | null;
    periodScore: number | null;
    rightsScore: number | null;
    conditionsScore: number | null;
  };
  state: {
    tenantCorrect: boolean | null;
    landlordCorrect: boolean | null;
    agreementCorrect: boolean | null;
    conflictCorrect: boolean | null;
    carryForwardCorrect: boolean | null;
    provenanceCorrect: boolean;
    semanticScore: SemanticScore | null;
    actualState: StructuredCurrentTermState;
  };
  failures: V2Failure[];
}

export interface V2LiveScenarioResult {
  scenarioId: string;
  description: string;
  tags: string[];
  typeResults: V2LiveTypeResult[];
  extractionMetrics: V2ExtractionMetrics;
  stateMetrics: V2StateMetrics;
  failures: V2Failure[];
}

export interface V2LiveReport {
  schemaVersion: "2.0";
  mode: "live";
  generatedAt: string;
  provider: string;
  model: string;
  scenarios: V2LiveScenarioResult[];
  extractionMetrics: V2ExtractionMetrics;
  stateMetrics: V2StateMetrics;
  failures: V2Failure[];
  weakestScenarios: V2WeakestScenario[];
}

/** Unified printable V2 report (oracle or live). Never mixed with V1 aggregates. */
export type V2Report = V2OracleReport | V2LiveReport;
