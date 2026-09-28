import type { NegotiationExtraction } from "@/lib/ai/negotiation/schemas";
import type {
  CountMetric,
  DocumentEvaluation,
  EvaluationDocument,
  ExpectedTerm,
  ExtractionMetrics,
  MetricBundle,
  TermSnapshot,
} from "./types";

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function countMetric(correct: number, total: number): CountMetric {
  return { correct, total, accuracy: ratio(correct, total) };
}

export function extractionMetric(
  truePositives: number,
  falsePositives: number,
  falseNegatives: number
): ExtractionMetrics {
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1,
    falsePositiveRate: ratio(
      falsePositives,
      truePositives + falsePositives
    ),
  };
}

export function emptyMetricBundle(): MetricBundle {
  return {
    extraction: extractionMetric(0, 0, 0),
    numeric: countMetric(0, 0),
    normalizedValue: countMetric(0, 0),
    evidenceValidity: countMetric(0, 0),
    evidenceSupport: countMetric(0, 0),
    assertionStatus: countMetric(0, 0),
    currentState: countMetric(0, 0),
    finalStatus: countMetric(0, 0),
    agreement: countMetric(0, 0),
    unexpectedCurrentStates: 0,
  };
}

function numericCorrect(expected: ExpectedTerm, predicted: TermSnapshot) {
  if (expected.normalizedNumeric === undefined) return undefined;
  const tolerance =
    expected.numericTolerance ??
    Math.max(0.000001, Math.abs(expected.normalizedNumeric) * 0.000001);
  return (
    predicted.normalizedNumeric !== undefined &&
    predicted.normalizedUnit === expected.normalizedUnit &&
    Math.abs(predicted.normalizedNumeric - expected.normalizedNumeric) <=
      tolerance
  );
}

function normalizedValueCorrect(
  expected: ExpectedTerm,
  predicted: TermSnapshot
) {
  if (expected.normalizedValue === undefined) return undefined;
  const normalize = (value: string) =>
    value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return (
    predicted.normalizedValue !== undefined &&
    normalize(predicted.normalizedValue) === normalize(expected.normalizedValue)
  );
}

function evidenceOverlaps(expected: string, predicted: string) {
  const expectedTrimmed = expected.trim();
  const predictedTrimmed = predicted.trim();
  return (
    expectedTrimmed.length > 0 &&
    predictedTrimmed.length > 0 &&
    (expectedTrimmed.includes(predictedTrimmed) ||
      predictedTrimmed.includes(expectedTrimmed))
  );
}

function pairWeight(expected: ExpectedTerm, predicted: TermSnapshot) {
  if (expected.canonicalType !== predicted.canonicalType) {
    return Number.NEGATIVE_INFINITY;
  }
  let weight = 1;
  if (evidenceOverlaps(expected.evidence, predicted.evidenceQuote)) weight += 100;
  if (numericCorrect(expected, predicted)) weight += 30;
  if (normalizedValueCorrect(expected, predicted)) weight += 10;
  if (expected.status === predicted.status) weight += 5;
  return weight;
}

/**
 * Deterministic weighted one-to-one matching for duplicate-heavy term groups.
 * A type match determines extraction; value, status, and evidence only select
 * the best pairing among candidates of that type.
 */
export function matchTerms(
  expectedTerms: ExpectedTerm[],
  predictedTerms: TermSnapshot[]
) {
  const candidates = expectedTerms.flatMap((expected, expectedIndex) =>
    predictedTerms.map((predicted, predictedIndex) => ({
      expectedIndex,
      predictedIndex,
      weight: pairWeight(expected, predicted),
    }))
  );
  candidates.sort(
    (a, b) =>
      b.weight - a.weight ||
      a.expectedIndex - b.expectedIndex ||
      a.predictedIndex - b.predictedIndex
  );

  const expectedUsed = new Set<number>();
  const predictedUsed = new Set<number>();
  const matches: Array<{ expectedIndex: number; predictedIndex: number }> = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.weight)) continue;
    if (
      expectedUsed.has(candidate.expectedIndex) ||
      predictedUsed.has(candidate.predictedIndex)
    ) {
      continue;
    }
    expectedUsed.add(candidate.expectedIndex);
    predictedUsed.add(candidate.predictedIndex);
    matches.push({
      expectedIndex: candidate.expectedIndex,
      predictedIndex: candidate.predictedIndex,
    });
  }
  return {
    matches,
    falsePositiveIndexes: predictedTerms
      .map((_, index) => index)
      .filter((index) => !predictedUsed.has(index)),
    missedExpectedIndexes: expectedTerms
      .map((_, index) => index)
      .filter((index) => !expectedUsed.has(index)),
  };
}

export function scoreDocument({
  document,
  rawTerms,
  validatedTerms,
  latencyMs,
  validationFailures,
  model,
  error,
}: {
  document: EvaluationDocument;
  rawTerms: NegotiationExtraction["terms"];
  validatedTerms: TermSnapshot[];
  latencyMs: number;
  validationFailures: number;
  model?: string;
  error?: string;
}): DocumentEvaluation {
  const matching = matchTerms(document.expectedTerms, validatedTerms);
  let numericCorrectCount = 0;
  const numericTotal = document.expectedTerms.filter(
    (term) => term.normalizedNumeric !== undefined
  ).length;
  let valueCorrectCount = 0;
  const valueTotal = document.expectedTerms.filter(
    (term) => term.normalizedValue !== undefined
  ).length;
  let statusCorrectCount = 0;
  let evidenceSupportCount = 0;

  const matches = matching.matches.map(
    ({ expectedIndex, predictedIndex }) => {
      const expected = document.expectedTerms[expectedIndex]!;
      const predicted = validatedTerms[predictedIndex]!;
      const numeric = numericCorrect(expected, predicted);
      const normalized = normalizedValueCorrect(expected, predicted);
      const supported = evidenceOverlaps(
        expected.evidence,
        predicted.evidenceQuote
      );
      const statusCorrect = expected.status === predicted.status;
      if (numeric !== undefined) {
        if (numeric) numericCorrectCount += 1;
      }
      if (normalized !== undefined) {
        if (normalized) valueCorrectCount += 1;
      }
      if (statusCorrect) statusCorrectCount += 1;
      if (supported) evidenceSupportCount += 1;
      return {
        expectedTermId: expected.id,
        predictedIndex,
        ...(numeric === undefined ? {} : { numericCorrect: numeric }),
        ...(normalized === undefined
          ? {}
          : { normalizedValueCorrect: normalized }),
        statusCorrect,
        evidenceSupported: supported,
      };
    }
  );

  const groundedEvidence = rawTerms.filter((candidate) => {
    const quote = candidate.evidenceQuote.trim();
    return quote.length > 0 && document.text.includes(quote);
  }).length;
  const truePositives = matches.length;
  return {
    id: document.id,
    name: document.name,
    expectedTerms: document.expectedTerms,
    ...(error ? { error } : {}),
    ...(model ? { model } : {}),
    latencyMs,
    validationFailures,
    metrics: {
      extraction: extractionMetric(
        truePositives,
        matching.falsePositiveIndexes.length,
        matching.missedExpectedIndexes.length
      ),
      numeric: countMetric(numericCorrectCount, numericTotal),
      normalizedValue: countMetric(valueCorrectCount, valueTotal),
      evidenceValidity: countMetric(groundedEvidence, rawTerms.length),
      evidenceSupport: countMetric(
        evidenceSupportCount,
        document.expectedTerms.length
      ),
      assertionStatus: countMetric(
        statusCorrectCount,
        document.expectedTerms.length
      ),
    },
    matches,
    falsePositiveIndexes: matching.falsePositiveIndexes,
    missedExpectedTermIds: matching.missedExpectedIndexes.map(
      (index) => document.expectedTerms[index]!.id
    ),
    rawTerms,
    validatedTerms,
  };
}

export function aggregateMetrics(
  bundles: MetricBundle[],
  documentEvaluations: DocumentEvaluation[] = []
): MetricBundle {
  const sumCount = (key: keyof MetricBundle) => {
    const values = bundles.map((bundle) => bundle[key] as CountMetric);
    return countMetric(
      values.reduce((sum, item) => sum + item.correct, 0),
      values.reduce((sum, item) => sum + item.total, 0)
    );
  };
  const extraction = bundles.reduce(
    (sum, bundle) => ({
      tp: sum.tp + bundle.extraction.truePositives,
      fp: sum.fp + bundle.extraction.falsePositives,
      fn: sum.fn + bundle.extraction.falseNegatives,
    }),
    { tp: 0, fp: 0, fn: 0 }
  );
  const evidenceValidity = documentEvaluations.length
    ? countMetric(
        documentEvaluations.reduce(
          (sum, doc) => sum + doc.metrics.evidenceValidity.correct,
          0
        ),
        documentEvaluations.reduce(
          (sum, doc) => sum + doc.metrics.evidenceValidity.total,
          0
        )
      )
    : sumCount("evidenceValidity");

  return {
    extraction: extractionMetric(extraction.tp, extraction.fp, extraction.fn),
    numeric: sumCount("numeric"),
    normalizedValue: sumCount("normalizedValue"),
    evidenceValidity,
    evidenceSupport: sumCount("evidenceSupport"),
    assertionStatus: sumCount("assertionStatus"),
    currentState: sumCount("currentState"),
    finalStatus: sumCount("finalStatus"),
    agreement: sumCount("agreement"),
    unexpectedCurrentStates: bundles.reduce(
      (sum, bundle) => sum + bundle.unexpectedCurrentStates,
      0
    ),
  };
}
