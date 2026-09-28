import {
  extractNegotiationWithGemini,
  type NegotiationExtractor,
} from "@/lib/ai/negotiation/extractTerms";
import { validateExtractedTerms } from "@/lib/ai/negotiation/validateTerms";
import { resolveCurrentState } from "@/lib/negotiation/resolveCurrentState";
import { TERM_CATALOG } from "@/lib/negotiation/termCatalog";
import type {
  NegotiationRoundRecord,
  NegotiationTermRecord,
} from "@/lib/negotiation/types";
import { FIXTURE_VERSION, NEGOTIATION_FIXTURES } from "./fixtures";
import {
  aggregateMetrics,
  countMetric,
  emptyMetricBundle,
  scoreDocument,
} from "./scoring";
import type {
  DocumentEvaluation,
  EvaluationDocument,
  EvaluationReport,
  MetricBundle,
  NegotiationFixture,
  ScenarioEvaluation,
  TermSnapshot,
} from "./types";

interface ExtractedDocument {
  fixtureId: string;
  document: EvaluationDocument;
  evaluation: DocumentEvaluation;
}

export interface RunEvaluationOptions {
  extractor?: NegotiationExtractor;
  fixtures?: readonly NegotiationFixture[];
  concurrency?: number;
  now?: () => Date;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index]!);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, values.length)) },
      worker
    )
  );
  return results;
}

async function extractDocument(
  fixtureId: string,
  document: EvaluationDocument,
  extractor: NegotiationExtractor,
  now: () => Date
): Promise<ExtractedDocument> {
  const startedAt = Date.now();
  try {
    const result = await extractor({
      documentText: document.text,
      documentName: document.name,
      side: document.side,
      roundNumber: document.roundNumber,
      documentDate: new Date(document.date),
    });
    const latencyMs = Date.now() - startedAt;
    const validated = validateExtractedTerms({
      documentText: document.text,
      extraction: result.extraction,
      model: result.model,
      extractedAt: now(),
      latencyMs,
    });
    const validatedTerms: TermSnapshot[] = validated.terms;
    return {
      fixtureId,
      document,
      evaluation: scoreDocument({
        document,
        rawTerms: result.extraction.terms,
        validatedTerms,
        latencyMs,
        validationFailures: validated.metadata.validationFailures,
        model: result.model,
      }),
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      fixtureId,
      document,
      evaluation: scoreDocument({
        document,
        rawTerms: [],
        validatedTerms: [],
        latencyMs,
        validationFailures: 0,
        error: errorMessage(error),
      }),
    };
  }
}

function recordFor(
  fixtureId: string,
  document: EvaluationDocument,
  evaluation: DocumentEvaluation
): NegotiationRoundRecord {
  const expectedIdByPrediction = new Map(
    evaluation.matches
      .filter(
        (match) =>
          match.evidenceSupported &&
          match.numericCorrect !== false
      )
      .map((match) => [match.predictedIndex, match.expectedTermId])
  );
  const terms: NegotiationTermRecord[] = evaluation.validatedTerms.map(
    (term, predictedIndex) => ({
      id:
        expectedIdByPrediction.get(predictedIndex) ??
        fixtureId + ":" + document.id + ":prediction-" + predictedIndex,
      canonicalType: term.canonicalType,
      normalizedValue: term.normalizedValue ?? null,
      normalizedNumeric: term.normalizedNumeric ?? null,
      normalizedUnit: term.normalizedUnit ?? null,
      rawValue: term.rawValue,
      status: term.status,
      side: document.side,
      roundNumber: document.roundNumber,
      confidence: term.confidence,
      evidenceQuote: term.evidenceQuote,
      sourceLocation: term.sourceLocation ?? null,
    })
  );
  const date = new Date(document.date);
  return {
    id: fixtureId + ":" + document.id,
    side: document.side,
    roundNumber: document.roundNumber,
    documentName: document.name,
    documentText: document.text,
    documentDate: date,
    createdAt: date,
    terms,
  };
}

function scoreScenario(
  fixture: NegotiationFixture,
  documents: ExtractedDocument[]
): ScenarioEvaluation {
  const rounds = documents.map((item) =>
    recordFor(fixture.id, item.document, item.evaluation)
  );
  const expectedByType = new Map(
    fixture.expectedState.map((item) => [item.canonicalType, item])
  );
  const stateMismatches: string[] = [];
  let currentCorrect = 0;
  let currentTotal = 0;
  let statusCorrect = 0;
  let agreementCorrect = 0;
  let unexpectedCurrentStates = 0;

  const actualState = TERM_CATALOG.flatMap(({ type }) => {
    const actual = resolveCurrentState(rounds, type);
    const expected = expectedByType.get(type);
    if (!expected) {
      if (actual.status !== "NOT_MENTIONED") {
        unexpectedCurrentStates += 1;
        stateMismatches.push(
          type + ": expected NOT_MENTIONED, got " + actual.status
        );
      }
      return actual.status === "NOT_MENTIONED"
        ? []
        : [
            {
              canonicalType: type,
              status: actual.status,
              contradictory: actual.contradictory,
              ...(actual.currentTenantTerm
                ? { currentTenantTermId: actual.currentTenantTerm.id }
                : {}),
              ...(actual.currentLandlordTerm
                ? { currentLandlordTermId: actual.currentLandlordTerm.id }
                : {}),
              ...(actual.agreedTerm
                ? { agreedTermId: actual.agreedTerm.id }
                : {}),
            },
          ];
    }

    currentTotal += 1;
    let currentStateCorrect = true;
    const fields = [
      [
        "currentTenantTermId",
        expected.currentTenantTermId,
        actual.currentTenantTerm?.id,
      ],
      [
        "currentLandlordTermId",
        expected.currentLandlordTermId,
        actual.currentLandlordTerm?.id,
      ],
      ["agreedTermId", expected.agreedTermId, actual.agreedTerm?.id],
      ["contradictory", expected.contradictory, actual.contradictory],
    ] as const;
    for (const [field, expectedValue, actualValue] of fields) {
      if (expectedValue !== actualValue) {
        currentStateCorrect = false;
        stateMismatches.push(
          type +
            "." +
            field +
            ": expected " +
            String(expectedValue) +
            ", got " +
            String(actualValue)
        );
      }
    }
    if (currentStateCorrect) currentCorrect += 1;
    if (expected.status === actual.status) {
      statusCorrect += 1;
    } else {
      stateMismatches.push(
        type + ".status: expected " + expected.status + ", got " + actual.status
      );
    }
    if (
      (expected.status === "AGREED") ===
      (actual.status === "AGREED")
    ) {
      agreementCorrect += 1;
    }
    return [
      {
        canonicalType: type,
        status: actual.status,
        contradictory: actual.contradictory,
        ...(actual.currentTenantTerm
          ? { currentTenantTermId: actual.currentTenantTerm.id }
          : {}),
        ...(actual.currentLandlordTerm
          ? { currentLandlordTermId: actual.currentLandlordTerm.id }
          : {}),
        ...(actual.agreedTerm ? { agreedTermId: actual.agreedTerm.id } : {}),
      },
    ];
  });

  const documentMetrics: MetricBundle[] = documents.map(({ evaluation }) => ({
    ...emptyMetricBundle(),
    extraction: evaluation.metrics.extraction,
    numeric: evaluation.metrics.numeric,
    normalizedValue: evaluation.metrics.normalizedValue,
    evidenceValidity: evaluation.metrics.evidenceValidity,
    evidenceSupport: evaluation.metrics.evidenceSupport,
    assertionStatus: evaluation.metrics.assertionStatus,
  }));
  const metrics = aggregateMetrics(
    documentMetrics,
    documents.map((item) => item.evaluation)
  );
  metrics.currentState = countMetric(currentCorrect, currentTotal);
  metrics.finalStatus = countMetric(statusCorrect, fixture.expectedState.length);
  metrics.agreement = countMetric(
    agreementCorrect,
    fixture.expectedState.length
  );
  metrics.unexpectedCurrentStates = unexpectedCurrentStates;

  return {
    id: fixture.id,
    title: fixture.title,
    description: fixture.description,
    difficulty: fixture.difficulty,
    tags: fixture.tags,
    expectedState: fixture.expectedState,
    metrics,
    documents: documents.map((item) => item.evaluation),
    actualState,
    stateMismatches,
  };
}

export async function runNegotiationEvaluation(
  options: RunEvaluationOptions = {}
): Promise<EvaluationReport> {
  const fixtures = [...(options.fixtures ?? NEGOTIATION_FIXTURES)];
  const extractor = options.extractor ?? extractNegotiationWithGemini;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const now = options.now ?? (() => new Date());
  const started = now();
  const documents = fixtures.flatMap((fixture) =>
    fixture.documents.map((document) => ({ fixtureId: fixture.id, document }))
  );
  const extracted = await mapConcurrent(
    documents,
    concurrency,
    ({ fixtureId, document }) =>
      extractDocument(fixtureId, document, extractor, now)
  );

  const scenarios = fixtures.map((fixture) =>
    scoreScenario(
      fixture,
      extracted.filter((item) => item.fixtureId === fixture.id)
    )
  );
  const completed = now();
  const models = new Set(
    extracted.flatMap((item) =>
      item.evaluation.model ? [item.evaluation.model] : []
    )
  );
  return {
    schemaVersion: "1.0",
    suite: {
      name: "dealwatch-negotiation-intelligence",
      fixtureVersion: FIXTURE_VERSION,
      scenarioCount: fixtures.length,
      documentCount: documents.length,
    },
    run: {
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      model:
        models.size === 0
          ? "unknown"
          : models.size === 1
            ? [...models][0]!
            : [...models].sort().join(", "),
      concurrency,
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      failedDocuments: extracted.filter((item) => item.evaluation.error).length,
    },
    metrics: aggregateMetrics(scenarios.map((scenario) => scenario.metrics)),
    scenarios,
  };
}
