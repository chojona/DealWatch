/**
 * evals/negotiation/v2/summary.ts
 *
 * Human-readable V2 report. V1 and V2 are never combined into one score.
 */

import type { CountMetric, EvaluationReport } from "../types";
import { formatEvaluationSummary } from "../summary";
import type {
  V2CountMetric,
  V2ExtractionMetrics,
  V2LiveReport,
  V2OracleReport,
  V2Report,
  V2StateMetrics,
  V2WeakestScenario,
} from "./types";

function percent(value: number | null) {
  return value === null ? "n/a" : (value * 100).toFixed(1) + "%";
}

function count(value: V2CountMetric | CountMetric) {
  return percent(value.accuracy) + " (" + value.correct + "/" + value.total + ")";
}

function avg(metric: { avgAccuracy: number | null; count: number }) {
  return percent(metric.avgAccuracy) + " (n=" + metric.count + ")";
}

function extractionBlock(metrics: V2ExtractionMetrics): string[] {
  return [
    "Structured Extraction",
    "  Payload coverage:     " + count(metrics.payloadCoverage),
    "  Payload validity:     " + count(metrics.payloadValidity),
    "  Semantic accuracy:    " + avg(metrics.semanticPayloadAccuracy),
    "  Schedule accuracy:    " + avg(metrics.scheduleAccuracy),
    "  Period accuracy:      " + avg(metrics.periodAccuracy),
    "  Rights accuracy:      " + avg(metrics.rightsAccuracy),
    "  Conditions accuracy:  " + avg(metrics.conditionsAccuracy),
  ];
}

function stateBlock(metrics: V2StateMetrics): string[] {
  return [
    "Structured State",
    "  Tenant position:      " + count(metrics.tenantPositionAccuracy),
    "  Landlord position:    " + count(metrics.landlordPositionAccuracy),
    "  Agreement:            " + count(metrics.agreementAccuracy),
    "  Conflict detection:   " + count(metrics.conflictDetectionAccuracy),
    "  Carry-forward:        " + count(metrics.carryForwardAccuracy),
    "  Provenance validity:  " + count(metrics.provenanceValidity),
  ];
}

function weakestBlock(items: V2WeakestScenario[]): string[] {
  const lines = ["Weakest structured scenarios"];
  if (items.length === 0) {
    lines.push("  (none)");
    return lines;
  }
  for (const item of items) {
    lines.push(
      "  " +
        item.scenarioId.padEnd(40) +
        " semantic " +
        percent(item.semanticAccuracy).padStart(6) +
        "  tenant " +
        percent(item.tenantPositionAccuracy).padStart(6) +
        "  " +
        item.failureCount +
        " failure(s)"
    );
  }
  return lines;
}

function failureBlock(report: V2Report): string[] {
  if (report.failures.length === 0) return [];
  const lines = ["", "Failures (attributed)"];
  const shown = report.failures.slice(0, 20);
  for (const failure of shown) {
    lines.push(
      "  [" +
        failure.phase +
        "] " +
        failure.scenarioId +
        " / " +
        failure.canonicalType +
        ": " +
        failure.description
    );
  }
  if (report.failures.length > shown.length) {
    lines.push("  … " + (report.failures.length - shown.length) + " more");
  }
  return lines;
}

export function formatV2Summary(report: V2Report): string {
  const header =
    report.mode === "oracle"
      ? [
          "V2 CRE ONTOLOGY  —  OFFLINE RESOLVER ORACLE",
          "Mode:       oracle (no model; perfect structured observations)",
          "Generated:  " + report.generatedAt,
          "Scenarios:  " + report.scenarios.length,
          "All passed: " + ((report as V2OracleReport).allPassed ? "yes" : "NO"),
        ]
      : [
          "V2 CRE ONTOLOGY  —  LIVE MODEL",
          "Mode:       live",
          "Provider:   " + (report as V2LiveReport).provider,
          "Model:      " + (report as V2LiveReport).model,
          "Generated:  " + report.generatedAt,
          "Scenarios:  " + report.scenarios.length,
        ];

  const lines = [
    ...header,
    "",
    ...extractionBlock(report.extractionMetrics),
    "",
    ...stateBlock(report.stateMetrics),
    "",
    ...weakestBlock(report.weakestScenarios),
    ...failureBlock(report),
  ];

  if (report.mode === "oracle") {
    const oracle = report as V2OracleReport;
    if (oracle.resolverBugs.length) {
      lines.push("", "Resolver bugs (perfect observations, wrong state)");
      for (const bug of oracle.resolverBugs) {
        lines.push("  - " + bug);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Combined human-readable report. V1 and V2 are printed as separate
 * sections; no aggregate score is computed across them.
 */
export function formatCombinedSummary(
  v1: EvaluationReport,
  v2: V2Report
): string {
  return [
    "DealWatch Negotiation Intelligence",
    "",
    "V1 FLAT BENCHMARK",
    formatEvaluationSummary(v1),
    "",
    "────────────────────────────────────────",
    "",
    formatV2Summary(v2),
  ].join("\n");
}
