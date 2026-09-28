import type {
  CanonicalTermType,
  NegotiationExtraction,
  NegotiationSide,
  NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";

export type NormalizedUnit = NonNullable<
  NegotiationExtraction["terms"][number]["normalizedUnit"]
>;

export interface ExpectedTerm {
  /** Stable, human-authored identifier used by expected current-state pointers. */
  id: string;
  canonicalType: CanonicalTermType;
  status: Exclude<NegotiationTermStatus, "NOT_MENTIONED">;
  normalizedValue?: string;
  normalizedNumeric?: number;
  normalizedUnit?: NormalizedUnit;
  numericTolerance?: number;
  /** Exact source span that a valid model quote must overlap. */
  evidence: string;
}

export interface EvaluationDocument {
  id: string;
  name: string;
  side: NegotiationSide;
  roundNumber: number;
  date: string;
  text: string;
  expectedTerms: ExpectedTerm[];
}

export interface ExpectedCurrentState {
  canonicalType: CanonicalTermType;
  status: NegotiationTermStatus;
  contradictory: boolean;
  currentTenantTermId?: string;
  currentLandlordTermId?: string;
  agreedTermId?: string;
}

export interface NegotiationFixture {
  id: string;
  title: string;
  difficulty: number;
  tags: string[];
  description: string;
  documents: EvaluationDocument[];
  /**
   * Human-defined normalized end state. Every mentioned canonical type belongs
   * here; all omitted catalog types are expected to remain NOT_MENTIONED.
   */
  expectedState: ExpectedCurrentState[];
}

export interface CountMetric {
  correct: number;
  total: number;
  accuracy: number | null;
}

export interface ExtractionMetrics {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveRate: number | null;
}

export interface MetricBundle {
  extraction: ExtractionMetrics;
  numeric: CountMetric;
  normalizedValue: CountMetric;
  evidenceValidity: CountMetric;
  evidenceSupport: CountMetric;
  assertionStatus: CountMetric;
  currentState: CountMetric;
  finalStatus: CountMetric;
  agreement: CountMetric;
  unexpectedCurrentStates: number;
}

export interface TermSnapshot {
  canonicalType: CanonicalTermType;
  normalizedValue?: string;
  normalizedNumeric?: number;
  normalizedUnit?: NormalizedUnit;
  rawValue: string;
  status: Exclude<NegotiationTermStatus, "NOT_MENTIONED">;
  confidence: number;
  evidenceQuote: string;
  sourceLocation?: string;
}

export interface DocumentEvaluation {
  id: string;
  name: string;
  expectedTerms: ExpectedTerm[];
  error?: string;
  model?: string;
  latencyMs: number;
  validationFailures: number;
  metrics: Pick<
    MetricBundle,
    | "extraction"
    | "numeric"
    | "normalizedValue"
    | "evidenceValidity"
    | "evidenceSupport"
    | "assertionStatus"
  >;
  matches: Array<{
    expectedTermId: string;
    predictedIndex: number;
    numericCorrect?: boolean;
    normalizedValueCorrect?: boolean;
    statusCorrect: boolean;
    evidenceSupported: boolean;
  }>;
  falsePositiveIndexes: number[];
  missedExpectedTermIds: string[];
  rawTerms: NegotiationExtraction["terms"];
  validatedTerms: TermSnapshot[];
}

export interface ScenarioEvaluation {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  tags: string[];
  expectedState: ExpectedCurrentState[];
  metrics: MetricBundle;
  documents: DocumentEvaluation[];
  actualState: Array<{
    canonicalType: CanonicalTermType;
    status: NegotiationTermStatus;
    contradictory: boolean;
    currentTenantTermId?: string;
    currentLandlordTermId?: string;
    agreedTermId?: string;
  }>;
  stateMismatches: string[];
}

export interface EvaluationReport {
  schemaVersion: "1.0";
  suite: {
    name: "dealwatch-negotiation-intelligence";
    fixtureVersion: string;
    scenarioCount: number;
    documentCount: number;
  };
  run: {
    startedAt: string;
    completedAt: string;
    model: string;
    concurrency: number;
    durationMs: number;
    failedDocuments: number;
  };
  metrics: MetricBundle;
  scenarios: ScenarioEvaluation[];
}
