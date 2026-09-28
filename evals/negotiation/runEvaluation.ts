import {
  extractNegotiationWithGeminiOnce,
  extractNegotiationWithOpenAIOnce,
  getNegotiationModel,
  NegotiationExtractionConfigurationError,
  type NegotiationExtractor,
  type NegotiationExtractorResult,
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
  createCacheIdentity,
  DEFAULT_EVALUATION_CACHE_DIR,
  EvaluationCache,
  getExtractionContractHash,
  getHttpStatus,
  getRetryAfterMs,
  isAuthenticationError,
  isDailyQuotaError,
  isRetryableError,
  parseRequestInterval,
} from "./reliability";
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
  cacheDir?: string | false;
  provider?: string;
  model?: string;
  extractionContractHash?: string;
  requestIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  clock?: () => number;
  random?: () => number;
  onProgress?: (line: string) => void;
}

function configuredEvaluationProvider() {
  const provider =
    process.env.DEALWATCH_AI_PROVIDER?.trim().toLowerCase() || "gemini";
  if (provider !== "gemini" && provider !== "openai") {
    throw new Error(
      "DEALWATCH_AI_PROVIDER must be either \"gemini\" or \"openai\""
    );
  }
  return provider;
}

function builtInEvaluationProvider(provider: string) {
  if (provider !== "gemini" && provider !== "openai") {
    throw new Error('Evaluation provider must be either "gemini" or "openai"');
  }
  return provider;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const outer = error as Record<string, unknown>;
    if (typeof outer.message === "string") return outer.message;
    const inner = outer.error;
    if (
      inner &&
      typeof inner === "object" &&
      typeof (inner as Record<string, unknown>).message === "string"
    ) {
      return (inner as Record<string, unknown>).message as string;
    }
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through for cyclic non-Error values.
    }
  }
  return String(error);
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function progressPrefix(index: number, total: number) {
  const width = Math.max(2, String(total).length);
  return "[" + String(index + 1).padStart(width, "0") + "/" + total + "]";
}

function progressIdentity(fixtureId: string, document: EvaluationDocument) {
  return fixtureId + " / " + document.id;
}

function seconds(milliseconds: number) {
  const value = Math.ceil(milliseconds / 100) / 10;
  return (Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)) + "s";
}

function backoffDelay(
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number
) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** retryIndex);
  return exponential * (0.5 + Math.max(0, Math.min(1, random())) * 0.5);
}

function scoreExtraction(
  fixtureId: string,
  document: EvaluationDocument,
  result: NegotiationExtractorResult,
  latencyMs: number,
  now: () => Date
): ExtractedDocument {
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
  const provider =
    options.provider ??
    (options.extractor ? "custom" : configuredEvaluationProvider());
  const builtInProvider = options.extractor
    ? undefined
    : builtInEvaluationProvider(provider);
  const extractor =
    options.extractor ??
    (builtInProvider === "openai"
      ? extractNegotiationWithOpenAIOnce
      : extractNegotiationWithGeminiOnce);
  const requestedConcurrency = Math.max(
    1,
    Math.floor(options.concurrency ?? 1)
  );
  const requestIntervalMs =
    options.requestIntervalMs ??
    parseRequestInterval(process.env.DEALWATCH_EVAL_REQUEST_INTERVAL_MS);
  if (!Number.isFinite(requestIntervalMs) || requestIntervalMs < 0) {
    throw new Error("requestIntervalMs must be a non-negative number");
  }
  const concurrency = requestIntervalMs > 0 ? 1 : requestedConcurrency;
  const maxRetries = options.maxRetries ?? 5;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("maxRetries must be a non-negative integer");
  }
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 60_000;
  if (
    !Number.isFinite(retryBaseDelayMs) ||
    retryBaseDelayMs < 0 ||
    !Number.isFinite(retryMaxDelayMs) ||
    retryMaxDelayMs < 0
  ) {
    throw new Error("retry delays must be non-negative numbers");
  }
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const progress = options.onProgress ?? (() => undefined);
  const model = options.model ?? getNegotiationModel();
  const cacheEnabled =
    options.cacheDir !== false &&
    (options.extractor === undefined || options.cacheDir !== undefined);
  const cache = cacheEnabled
    ? new EvaluationCache(
        typeof options.cacheDir === "string"
          ? options.cacheDir
          : DEFAULT_EVALUATION_CACHE_DIR
      )
    : null;
  const extractionContractHash =
    options.extractionContractHash ?? getExtractionContractHash();
  const started = now();
  const documents = fixtures.flatMap((fixture) =>
    fixture.documents.map((document) => ({ fixtureId: fixture.id, document }))
  );
  const extracted = new Array<ExtractedDocument | undefined>(documents.length);
  const errors: EvaluationReport["run"]["errors"] = [];
  let processedThisRun = 0;
  let loadedFromCache = 0;
  let stopReason: EvaluationReport["run"]["stopReason"];
  let nextIndex = 0;
  let lastRequestStartedAt: number | undefined;

  async function waitForRateLimit(index: number) {
    if (lastRequestStartedAt !== undefined) {
      const waitMs = Math.max(
        0,
        requestIntervalMs - (clock() - lastRequestStartedAt)
      );
      if (waitMs > 0) {
        progress(progressPrefix(index, documents.length) + " WAIT  rate limit");
        await sleep(waitMs);
      }
    }
    lastRequestStartedAt = clock();
  }

  async function extractWithRetries(
    index: number,
    document: EvaluationDocument
  ) {
    let retryIndex = 0;
    let latencyMs = 0;
    while (true) {
      await waitForRateLimit(index);
      const requestStartedAt = clock();
      try {
        const result = await extractor({
          documentText: document.text,
          documentName: document.name,
          side: document.side,
          roundNumber: document.roundNumber,
          documentDate: new Date(document.date),
        });
        latencyMs += Math.max(0, clock() - requestStartedAt);
        return { result, latencyMs };
      } catch (error) {
        latencyMs += Math.max(0, clock() - requestStartedAt);
        if (isDailyQuotaError(error)) throw error;
        if (!isRetryableError(error) || retryIndex >= maxRetries) throw error;
        const retryDelay = backoffDelay(
          retryIndex,
          retryBaseDelayMs,
          retryMaxDelayMs,
          random
        );
        const delayMs = Math.max(
          retryDelay,
          getRetryAfterMs(error, clock()) ?? 0
        );
        progress(
          progressPrefix(index, documents.length) +
            " RETRY " +
            getHttpStatus(error) +
            " in " +
            seconds(delayMs)
        );
        retryIndex += 1;
        await sleep(delayMs);
      }
    }
  }

  async function processDocument(index: number) {
    const item = documents[index]!;
    const prefix = progressPrefix(index, documents.length);
    const identity = progressIdentity(item.fixtureId, item.document);
    const cacheIdentity = createCacheIdentity({
      fixtureId: item.fixtureId,
      document: item.document,
      provider,
      model,
      extractionContractHash,
    });
    const cached = await cache?.load(cacheIdentity);
    if (cached) {
      extracted[index] = scoreExtraction(
        item.fixtureId,
        item.document,
        cached,
        0,
        now
      );
      loadedFromCache += 1;
      progress(prefix + " CACHE " + identity);
      return;
    }
    if (stopReason) return;

    try {
      const { result, latencyMs } = await extractWithRetries(
        index,
        item.document
      );
      const scored = scoreExtraction(
        item.fixtureId,
        item.document,
        result,
        latencyMs,
        now
      );
      await cache?.save(cacheIdentity, result);
      extracted[index] = scored;
      processedThisRun += 1;
      progress(prefix + " OK    " + identity + "  " + seconds(latencyMs));
    } catch (error) {
      errors.push({
        fixtureId: item.fixtureId,
        documentId: item.document.id,
        message: errorMessage(error),
      });
      if (isDailyQuotaError(error)) {
        stopReason = "daily-quota";
        progress(prefix + " STOP  daily quota");
      } else if (
        isAuthenticationError(error) ||
        error instanceof NegotiationExtractionConfigurationError
      ) {
        stopReason = "authentication";
        progress(prefix + " ERROR authentication");
      } else {
        progress(prefix + " ERROR " + errorMessage(error));
      }
    }
  }

  async function worker() {
    while (nextIndex < documents.length) {
      const index = nextIndex;
      nextIndex += 1;
      await processDocument(index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(1, documents.length)) },
      worker
    )
  );

  const successful = extracted.filter(
    (item): item is ExtractedDocument => item !== undefined
  );
  const complete = successful.length === documents.length;
  const fullSuiteDocuments = NEGOTIATION_FIXTURES.flatMap((fixture) =>
    fixture.documents.map((document) => fixture.id + "/" + document.id)
  );
  const selectedDocumentIds = new Set(
    documents.map(({ fixtureId, document }) => fixtureId + "/" + document.id)
  );
  const officialBenchmark =
    complete &&
    documents.length === fullSuiteDocuments.length &&
    selectedDocumentIds.size === fullSuiteDocuments.length &&
    fullSuiteDocuments.every((identity) => selectedDocumentIds.has(identity));

  const scenarios = complete
    ? fixtures.map((fixture) =>
        scoreScenario(
          fixture,
          successful.filter((item) => item.fixtureId === fixture.id)
        )
      )
    : [];
  const completed = now();
  const models = new Set(
    successful.flatMap((item) =>
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
          ? model
          : models.size === 1
            ? [...models][0]!
            : [...models].sort().join(", "),
      provider,
      concurrency,
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      failedDocuments: errors.length,
      complete,
      officialBenchmark,
      processedThisRun,
      loadedFromCache,
      remainingDocuments: documents.length - successful.length,
      ...(stopReason ? { stopReason } : {}),
      errors,
    },
    metrics: complete
      ? aggregateMetrics(scenarios.map((scenario) => scenario.metrics))
      : emptyMetricBundle(),
    scenarios,
  };
}
