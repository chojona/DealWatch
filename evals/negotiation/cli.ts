import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NEGOTIATION_FIXTURES } from "./fixtures";
import { runNegotiationEvaluation } from "./runEvaluation";
import { formatEvaluationSummary } from "./summary";

interface CliOptions {
  output: string;
  concurrency: number;
  fixtureIds: string[];
  jsonStdout: boolean;
  failUnderF1?: number;
}

function usage() {
  return [
    "Usage: npm run eval:negotiation -- [options]",
    "",
    "Options:",
    "  --output <path>          JSON report path (default: artifacts/negotiation-eval.json)",
    "  --concurrency <number>   Parallel model calls (default: 1)",
    "  --fixture <id>           Run one fixture; repeat to select multiple",
    "  --json-stdout            Write only JSON to stdout; summary goes to stderr",
    "  --fail-under-f1 <0..1>   Exit nonzero when extraction F1 is below threshold",
    "  --help                    Show this message",
  ].join("\n");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    output: "artifacts/negotiation-eval.json",
    concurrency: 1,
    fixtureIds: [],
    jsonStdout: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const value = args[index + 1];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "--json-stdout") {
      options.jsonStdout = true;
    } else if (argument === "--output" && value) {
      options.output = value;
      index += 1;
    } else if (argument === "--concurrency" && value) {
      options.concurrency = Number(value);
      index += 1;
    } else if (argument === "--fixture" && value) {
      options.fixtureIds.push(value);
      index += 1;
    } else if (argument === "--fail-under-f1" && value) {
      options.failUnderF1 = Number(value);
      index += 1;
    } else {
      throw new Error("Unknown or incomplete argument: " + argument);
    }
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (
    options.failUnderF1 !== undefined &&
    (!Number.isFinite(options.failUnderF1) ||
      options.failUnderF1 < 0 ||
      options.failUnderF1 > 1)
  ) {
    throw new Error("--fail-under-f1 must be between 0 and 1");
  }
  return options;
}

function loadLocalEnvironment() {
  for (const filename of [".env.local", ".env"]) {
    const path = resolve(filename);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadLocalEnvironment();
  const requested = new Set(options.fixtureIds);
  const fixtures = requested.size
    ? NEGOTIATION_FIXTURES.filter((fixture) => requested.has(fixture.id))
    : NEGOTIATION_FIXTURES;
  const missing = [...requested].filter(
    (id) => !NEGOTIATION_FIXTURES.some((fixture) => fixture.id === id)
  );
  if (missing.length) {
    throw new Error("Unknown fixture(s): " + missing.join(", "));
  }

  const report = await runNegotiationEvaluation({
    fixtures,
    concurrency: options.concurrency,
    onProgress: (line) => {
      const stream = options.jsonStdout ? process.stderr : process.stdout;
      stream.write(line + "\n");
    },
  });
  const outputPath = resolve(options.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  const json = JSON.stringify(report, null, 2) + "\n";
  writeFileSync(outputPath, json, "utf8");
  const summary = formatEvaluationSummary(report);

  if (options.jsonStdout) {
    process.stdout.write(json);
    process.stderr.write(summary + "\nReport: " + outputPath + "\n");
  } else {
    process.stdout.write(summary + "\n\nJSON report: " + outputPath + "\n");
  }

  if (
    !report.run.complete &&
    report.run.stopReason !== "daily-quota"
  ) {
    process.exitCode = 1;
  }
  if (
    report.run.complete &&
    options.failUnderF1 !== undefined &&
    (report.metrics.extraction.f1 ?? 0) < options.failUnderF1
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
