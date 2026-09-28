import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  NegotiationExtractor,
  NegotiationExtractorResult,
} from "@/lib/ai/negotiation/extractTerms";
import type { NegotiationExtraction } from "@/lib/ai/negotiation/schemas";
import { NEGOTIATION_FIXTURES } from "./fixtures";
import {
  getRetryAfterMs,
  isDailyQuotaError,
  parseRequestInterval,
} from "./reliability";
import { runNegotiationEvaluation } from "./runEvaluation";
import { formatEvaluationSummary } from "./summary";
import type { EvaluationDocument, NegotiationFixture } from "./types";

function oracleResult(document: EvaluationDocument): NegotiationExtractorResult {
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
    })
  );
  return { model: "oracle", extraction: { terms, overallConfidence: 0.99 } };
}

function oracleFor(fixture: NegotiationFixture): NegotiationExtractor {
  return async (input) => {
    const document = fixture.documents.find(
      (candidate) => candidate.name === input.documentName
    );
    assert.ok(document);
    return oracleResult(document);
  };
}

test("checkpoints raw extraction and reuses only a matching cache entry", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "dealwatch-eval-cache-"));
  const fixture = NEGOTIATION_FIXTURES[0]!;
  let calls = 0;
  const extractor: NegotiationExtractor = async (input) => {
    calls += 1;
    return oracleFor(fixture)(input);
  };

  try {
    const first = await runNegotiationEvaluation({
      fixtures: [fixture],
      extractor,
      cacheDir,
      provider: "test",
      model: "oracle",
      extractionContractHash: "contract-v1",
    });
    assert.equal(first.run.complete, true);
    assert.equal(first.run.officialBenchmark, false);
    assert.equal(first.run.processedThisRun, 1);
    assert.equal(first.run.loadedFromCache, 0);
    assert.equal(calls, 1);
    assert.equal((await readdir(cacheDir)).length, 1);

    const progress: string[] = [];
    const second = await runNegotiationEvaluation({
      fixtures: [fixture],
      extractor: async () => {
        throw new Error("cache miss");
      },
      cacheDir,
      provider: "test",
      model: "oracle",
      extractionContractHash: "contract-v1",
      onProgress: (line) => progress.push(line),
    });
    assert.equal(second.run.complete, true);
    assert.equal(second.run.processedThisRun, 0);
    assert.equal(second.run.loadedFromCache, 1);
    assert.match(progress[0]!, /^\[01\/1\] CACHE /);

    await runNegotiationEvaluation({
      fixtures: [fixture],
      extractor,
      cacheDir,
      provider: "test",
      model: "oracle",
      extractionContractHash: "contract-v2",
    });
    assert.equal(calls, 2, "a changed extraction contract invalidates cache");

    const changedDocumentFixture: NegotiationFixture = {
      ...fixture,
      documents: fixture.documents.map((document) => ({
        ...document,
        text: document.text + "\n",
      })),
    };
    await runNegotiationEvaluation({
      fixtures: [changedDocumentFixture],
      extractor,
      cacheDir,
      provider: "test",
      model: "oracle",
      extractionContractHash: "contract-v1",
    });
    assert.equal(calls, 3, "changed document content invalidates cache");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("paces calls and retries 429 using the provider retryDelay", async () => {
  const fixture = NEGOTIATION_FIXTURES[3]!;
  let elapsed = 0;
  let calls = 0;
  const callTimes: number[] = [];
  const waits: number[] = [];
  const progress: string[] = [];
  const extractor: NegotiationExtractor = async (input) => {
    calls += 1;
    callTimes.push(elapsed);
    if (calls === 1) {
      throw {
        status: 429,
        error: {
          status: "RESOURCE_EXHAUSTED",
          details: [{ retryDelay: "3s" }],
        },
      };
    }
    const document = fixture.documents.find(
      (candidate) => candidate.name === input.documentName
    );
    assert.ok(document);
    return oracleResult(document);
  };

  const report = await runNegotiationEvaluation({
    fixtures: [fixture],
    extractor,
    cacheDir: false,
    requestIntervalMs: 1_000,
    retryBaseDelayMs: 100,
    clock: () => elapsed,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      elapsed += milliseconds;
    },
    random: () => 0,
    onProgress: (line) => progress.push(line),
  });

  assert.equal(report.run.complete, true);
  assert.deepEqual(callTimes, [0, 3_000, 4_000]);
  assert.deepEqual(waits, [3_000, 1_000]);
  assert.ok(progress.some((line) => line.includes("RETRY 429 in 3s")));
  assert.ok(progress.some((line) => line.includes("WAIT  rate limit")));
});

test("daily quota stops gracefully and suppresses partial aggregate output", async () => {
  const fixture = NEGOTIATION_FIXTURES[3]!;
  let calls = 0;
  const error = {
    status: 429,
    error: {
      message: "Quota exceeded",
      details: [
        {
          quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
          retryDelay: "12h",
        },
      ],
    },
  };
  const report = await runNegotiationEvaluation({
    fixtures: [fixture],
    extractor: async () => {
      calls += 1;
      throw error;
    },
    cacheDir: false,
    maxRetries: 5,
    sleep: async () => {
      throw new Error("daily quota must not be retried");
    },
  });

  assert.equal(isDailyQuotaError(error), true);
  assert.equal(calls, 1);
  assert.equal(report.run.complete, false);
  assert.equal(report.run.stopReason, "daily-quota");
  assert.equal(report.run.remainingDocuments, 2);
  assert.equal(report.scenarios.length, 0);
  assert.equal(report.metrics.extraction.truePositives, 0);
  assert.equal(report.metrics.extraction.falsePositives, 0);
  assert.equal(report.metrics.extraction.falseNegatives, 0);
  const summary = formatEvaluationSummary(report);
  assert.match(summary, /^EVALUATION INCOMPLETE/m);
  assert.match(summary, /0\/2 documents evaluated/);
  assert.match(summary, /Processed this run: 0/);
  assert.match(summary, /Loaded from cache: 0/);
  assert.match(summary, /Remaining: 2/);
  assert.doesNotMatch(summary, /Precision|Weakest scenarios/);
});

test("authentication and deterministic errors are never retried", async () => {
  const fixture = NEGOTIATION_FIXTURES[0]!;
  for (const thrown of [
    { status: 401, message: "bad key" },
    new Error("schema validation failed"),
  ]) {
    let calls = 0;
    const report = await runNegotiationEvaluation({
      fixtures: [fixture],
      extractor: async () => {
        calls += 1;
        throw thrown;
      },
      cacheDir: false,
      maxRetries: 5,
      sleep: async () => {
        throw new Error("non-retryable errors must not sleep");
      },
    });
    assert.equal(calls, 1);
    assert.equal(report.run.complete, false);
  }
});

test("retries a transient HTTP 503 with exponential backoff", async () => {
  const fixture = NEGOTIATION_FIXTURES[0]!;
  let calls = 0;
  const waits: number[] = [];
  const report = await runNegotiationEvaluation({
    fixtures: [fixture],
    extractor: async () => {
      calls += 1;
      if (calls === 1) throw { status: 503, message: "temporarily unavailable" };
      return oracleResult(fixture.documents[0]!);
    },
    cacheDir: false,
    retryBaseDelayMs: 2_000,
    random: () => 0,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  assert.equal(report.run.complete, true);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1_000]);
});

test("parses Retry-After variants and validates the pacing environment", () => {
  assert.equal(
    getRetryAfterMs({ status: 503, headers: { "retry-after": "31" } }),
    31_000
  );
  assert.equal(
    getRetryAfterMs({ status: 503, error: { retryDelay: "1.5s" } }),
    1_500
  );
  assert.equal(parseRequestInterval("13000"), 13_000);
  assert.throws(() => parseRequestInterval("not-a-number"));
});
