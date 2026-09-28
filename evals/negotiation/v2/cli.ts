/**
 * evals/negotiation/v2/cli.ts
 *
 * V2 CRE Ontology evaluation CLI.
 *
 * Default: offline resolver oracle (no model, no API cost).
 *
 *   npm run eval:negotiation:v2
 *   npm run eval:negotiation:v2 -- --oracle
 *   npm run eval:negotiation:v2 -- --oracle --fixture n07-stepped-rent
 *
 * Live model V2 (also runs frozen V1, prints both, never mixes scores):
 *
 *   DEALWATCH_AI_PROVIDER=openai DEALWATCH_NEGOTIATION_MODEL=gpt-5.4-mini \
 *     npm run eval:negotiation:v2 -- --live
 *
 * V1 remains independently runnable:
 *
 *   npm run eval:negotiation
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NEGOTIATION_FIXTURES } from "../fixtures";
import { runNegotiationEvaluation } from "../runEvaluation";
import { ORACLE_FIXTURES } from "./oracleFixtures";
import { runOracleEvaluation } from "./runOracle";
import { runV2LiveEvaluation } from "./runLive";
import { formatCombinedSummary, formatV2Summary } from "./summary";

interface CliOptions {
  mode: "oracle" | "live";
  output: string;
  v1Output: string;
  concurrency: number;
  fixtureIds: string[];
  jsonStdout: boolean;
}

function usage() {
  return [
    "Usage: npm run eval:negotiation:v2 -- [options]",
    "",
    "V2 CRE Ontology evaluation. V1 remains independently runnable via",
    "npm run eval:negotiation. This CLI never mixes V1 and V2 into one score.",
    "",
    "Options:",
    "  --oracle                 Offline resolver oracle (default; no model)",
    "  --live                   Live-model V2 (also runs frozen V1)",
    "  --output <path>          V2 JSON report path",
    "  --v1-output <path>       V1 JSON report path (live mode only)",
    "  --concurrency <number>   Parallel model calls (live mode; default 1)",
    "  --fixture <id>           Run one fixture; repeat to select multiple",
    "  --json-stdout            Write only JSON to stdout; summary to stderr",
    "  --help                   Show this message",
  ].join("\n");
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    mode: "oracle",
    output: "artifacts/negotiation-eval-v2-oracle.json",
    v1Output: "artifacts/negotiation-eval.json",
    concurrency: 1,
    fixtureIds: [],
    jsonStdout: false,
  };
  let outputOverridden = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const value = args[index + 1];
    if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "--oracle") {
      options.mode = "oracle";
      if (!outputOverridden) {
        options.output = "artifacts/negotiation-eval-v2-oracle.json";
      }
    } else if (argument === "--live") {
      options.mode = "live";
      if (!outputOverridden) {
        options.output = "artifacts/negotiation-eval-v2.json";
      }
    } else if (argument === "--json-stdout") {
      options.jsonStdout = true;
    } else if (argument === "--output" && value) {
      options.output = value;
      outputOverridden = true;
      index += 1;
    } else if (argument === "--v1-output" && value) {
      options.v1Output = value;
      index += 1;
    } else if (argument === "--concurrency" && value) {
      options.concurrency = Number(value);
      index += 1;
    } else if (argument === "--fixture" && value) {
      options.fixtureIds.push(value);
      index += 1;
    } else {
      throw new Error("Unknown or incomplete argument: " + argument);
    }
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  return options;
}

function loadLocalEnvironment() {
  for (const filename of [".env.local", ".env"]) {
    const path = resolve(filename);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

function writeJson(path: string, value: unknown) {
  const outputPath = resolve(path);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  return outputPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadLocalEnvironment();
  const requested = new Set(options.fixtureIds);

  if (options.mode === "oracle") {
    const fixtures = requested.size
      ? ORACLE_FIXTURES.filter((f) => requested.has(f.id))
      : ORACLE_FIXTURES;
    const missing = [...requested].filter(
      (id) => !ORACLE_FIXTURES.some((f) => f.id === id)
    );
    if (missing.length) {
      throw new Error("Unknown oracle fixture(s): " + missing.join(", "));
    }
    const report = runOracleEvaluation({ fixtures });
    const outputPath = writeJson(options.output, report);
    const summary = formatV2Summary(report);
    if (options.jsonStdout) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
      process.stderr.write(summary + "\nReport: " + outputPath + "\n");
    } else {
      process.stdout.write(summary + "\n\nJSON report: " + outputPath + "\n");
    }
    if (!report.allPassed) process.exitCode = 1;
    return;
  }

  const v1Fixtures = requested.size
    ? NEGOTIATION_FIXTURES.filter((f) => requested.has(f.id))
    : NEGOTIATION_FIXTURES;
  const missingV1 = [...requested].filter(
    (id) => !NEGOTIATION_FIXTURES.some((f) => f.id === id)
  );
  if (missingV1.length) {
    throw new Error("Unknown V1 fixture(s): " + missingV1.join(", "));
  }

  const v1Report = await runNegotiationEvaluation({
    fixtures: v1Fixtures,
    concurrency: options.concurrency,
    onProgress: (line) => {
      const stream = options.jsonStdout ? process.stderr : process.stdout;
      stream.write(line + "\n");
    },
  });
  const v1Path = writeJson(options.v1Output, v1Report);

  if (!v1Report.run.complete) {
    const incomplete =
      "V1 live extraction did not complete; V2 live scoring requires a complete V1 run.\n" +
      "V1 report: " +
      v1Path;
    if (options.jsonStdout) {
      process.stderr.write(incomplete + "\n");
    } else {
      process.stdout.write(incomplete + "\n");
    }
    process.exitCode = 1;
    return;
  }

  const v2Report = runV2LiveEvaluation({
    v1Report,
    fixtures: v1Fixtures,
  });
  const v2Path = writeJson(options.output, v2Report);
  const summary = formatCombinedSummary(v1Report, v2Report);

  if (options.jsonStdout) {
    process.stdout.write(JSON.stringify({ v1: v1Report, v2: v2Report }, null, 2) + "\n");
    process.stderr.write(
      summary + "\nV1 report: " + v1Path + "\nV2 report: " + v2Path + "\n"
    );
  } else {
    process.stdout.write(
      summary +
        "\n\nV1 JSON report: " +
        v1Path +
        "\nV2 JSON report: " +
        v2Path +
        "\n"
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
