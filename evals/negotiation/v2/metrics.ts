/**
 * evals/negotiation/v2/metrics.ts
 *
 * Accumulators for V2 extraction and state metrics.
 * V1 MetricBundle / scoring.ts is not imported or modified.
 */

import type {
  V2CountMetric,
  V2ExtractionMetrics,
  V2StateMetrics,
  V2WeakestScenario,
} from "./types";

export function countMetric(correct: number, total: number): V2CountMetric {
  return {
    correct,
    total,
    accuracy: total === 0 ? null : correct / total,
  };
}

export function emptyCount(): V2CountMetric {
  return countMetric(0, 0);
}

function emptyAvg() {
  return { totalScore: 0, count: 0, avgAccuracy: null as number | null };
}

export function emptyExtractionMetrics(): V2ExtractionMetrics {
  return {
    payloadCoverage: emptyCount(),
    payloadValidity: emptyCount(),
    semanticPayloadAccuracy: emptyAvg(),
    scheduleAccuracy: emptyAvg(),
    periodAccuracy: emptyAvg(),
    rightsAccuracy: emptyAvg(),
    conditionsAccuracy: emptyAvg(),
  };
}

export function emptyStateMetrics(): V2StateMetrics {
  return {
    tenantPositionAccuracy: emptyCount(),
    landlordPositionAccuracy: emptyCount(),
    agreementAccuracy: emptyCount(),
    conflictDetectionAccuracy: emptyCount(),
    carryForwardAccuracy: emptyCount(),
    provenanceValidity: emptyCount(),
  };
}

export function addCount(metric: V2CountMetric, correct: boolean): void {
  metric.total += 1;
  if (correct) metric.correct += 1;
  metric.accuracy = metric.total === 0 ? null : metric.correct / metric.total;
}

export function addAvg(
  metric: { totalScore: number; count: number; avgAccuracy: number | null },
  score: number | null
): void {
  if (score === null) return;
  metric.totalScore += score;
  metric.count += 1;
  metric.avgAccuracy =
    metric.count === 0 ? null : metric.totalScore / metric.count;
}

export function mergeCount(into: V2CountMetric, from: V2CountMetric): void {
  into.correct += from.correct;
  into.total += from.total;
  into.accuracy = into.total === 0 ? null : into.correct / into.total;
}

export function mergeAvg(
  into: { totalScore: number; count: number; avgAccuracy: number | null },
  from: { totalScore: number; count: number; avgAccuracy: number | null }
): void {
  into.totalScore += from.totalScore;
  into.count += from.count;
  into.avgAccuracy = into.count === 0 ? null : into.totalScore / into.count;
}

export function mergeExtraction(
  into: V2ExtractionMetrics,
  from: V2ExtractionMetrics
): void {
  mergeCount(into.payloadCoverage, from.payloadCoverage);
  mergeCount(into.payloadValidity, from.payloadValidity);
  mergeAvg(into.semanticPayloadAccuracy, from.semanticPayloadAccuracy);
  mergeAvg(into.scheduleAccuracy, from.scheduleAccuracy);
  mergeAvg(into.periodAccuracy, from.periodAccuracy);
  mergeAvg(into.rightsAccuracy, from.rightsAccuracy);
  mergeAvg(into.conditionsAccuracy, from.conditionsAccuracy);
}

export function mergeState(into: V2StateMetrics, from: V2StateMetrics): void {
  mergeCount(into.tenantPositionAccuracy, from.tenantPositionAccuracy);
  mergeCount(into.landlordPositionAccuracy, from.landlordPositionAccuracy);
  mergeCount(into.agreementAccuracy, from.agreementAccuracy);
  mergeCount(into.conflictDetectionAccuracy, from.conflictDetectionAccuracy);
  mergeCount(into.carryForwardAccuracy, from.carryForwardAccuracy);
  mergeCount(into.provenanceValidity, from.provenanceValidity);
}

/**
 * Rank scenarios by the weakest of their scored state dimensions.
 * Used for the "Weakest structured scenarios" report section.
 */
export function rankWeakest(
  items: V2WeakestScenario[],
  limit = 5
): V2WeakestScenario[] {
  const rank = (item: V2WeakestScenario) => {
    const scores = [
      item.semanticAccuracy,
      item.tenantPositionAccuracy,
      item.landlordPositionAccuracy,
      item.conflictDetectionAccuracy,
      item.carryForwardAccuracy,
    ].filter((v): v is number => v !== null);
    if (scores.length === 0) return 1;
    return Math.min(...scores);
  };
  return [...items]
    .sort(
      (a, b) =>
        rank(a) - rank(b) || b.failureCount - a.failureCount
    )
    .slice(0, limit);
}
