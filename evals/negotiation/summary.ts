import type { CountMetric, EvaluationReport } from "./types";

function percent(value: number | null) {
  return value === null ? "n/a" : (value * 100).toFixed(1) + "%";
}

function count(value: CountMetric) {
  return percent(value.accuracy) + " (" + value.correct + "/" + value.total + ")";
}

export function formatEvaluationSummary(report: EvaluationReport) {
  if (!report.run.complete) {
    const evaluated =
      report.suite.documentCount - report.run.remainingDocuments;
    const lines = [
      "EVALUATION INCOMPLETE",
      evaluated + "/" + report.suite.documentCount + " documents evaluated",
      report.run.remainingDocuments + " remaining",
      "",
      "Processed this run: " + report.run.processedThisRun,
      "Loaded from cache: " + report.run.loadedFromCache,
      "Remaining: " + report.run.remainingDocuments,
    ];
    if (report.run.stopReason === "daily-quota") {
      lines.push("Reason: " + report.run.provider + " daily quota limit reached");
    } else if (report.run.stopReason === "authentication") {
      lines.push("Reason: Authentication or API configuration failure");
    }
    if (report.run.errors.length) {
      lines.push("", "Errors");
      for (const error of report.run.errors) {
        lines.push(
          "  " +
            error.fixtureId +
            " / " +
            error.documentId +
            ": " +
            error.message
        );
      }
    }
    return lines.join("\n");
  }

  const lines = [
    report.run.officialBenchmark
      ? "DealWatch negotiation intelligence evaluation — OFFICIAL AGGREGATE BENCHMARK"
      : "DealWatch negotiation intelligence evaluation — SELECTED SUBSET (not an official benchmark)",
    "",
    "Provider:   " + report.run.provider,
    "Model:      " + report.run.model,
    "Suite:      " +
      report.suite.scenarioCount +
      " negotiations / " +
      report.suite.documentCount +
      " documents",
    "Duration:   " + (report.run.durationMs / 1000).toFixed(1) + "s",
    "Failures:   " + report.run.failedDocuments + " document(s)",
    "Processed this run: " + report.run.processedThisRun,
    "Loaded from cache:  " + report.run.loadedFromCache,
    "",
    "Extraction",
    "  Precision:          " + percent(report.metrics.extraction.precision),
    "  Recall:             " + percent(report.metrics.extraction.recall),
    "  F1:                 " + percent(report.metrics.extraction.f1),
    "  False positives:    " +
      report.metrics.extraction.falsePositives +
      " (" +
      percent(report.metrics.extraction.falsePositiveRate) +
      " of extracted terms)",
    "",
    "Quality",
    "  Numeric accuracy:   " + count(report.metrics.numeric),
    "  Normalized values:  " + count(report.metrics.normalizedValue),
    "  Evidence validity:  " + count(report.metrics.evidenceValidity),
    "  Evidence support:   " + count(report.metrics.evidenceSupport),
    "  Assertion status:   " + count(report.metrics.assertionStatus),
    "  Current state:      " + count(report.metrics.currentState),
    "  Final status:       " + count(report.metrics.finalStatus),
    "  Agreement:          " + count(report.metrics.agreement),
    "  Unexpected states:  " + report.metrics.unexpectedCurrentStates,
  ];

  const weakest = [...report.scenarios]
    .sort(
      (a, b) =>
        (a.metrics.extraction.f1 ?? 0) - (b.metrics.extraction.f1 ?? 0) ||
        (a.metrics.currentState.accuracy ?? 0) -
          (b.metrics.currentState.accuracy ?? 0) ||
        b.difficulty - a.difficulty
    )
    .slice(0, 5);
  lines.push("", "Weakest scenarios");
  for (const scenario of weakest) {
    lines.push(
      "  " +
        scenario.id.padEnd(36) +
        " extraction " +
        percent(scenario.metrics.extraction.f1).padStart(6) +
        "  state " +
        percent(scenario.metrics.currentState.accuracy).padStart(6) +
        (scenario.stateMismatches.length
          ? "  " + scenario.stateMismatches.length + " state mismatch(es)"
          : "")
    );
  }
  return lines.join("\n");
}
