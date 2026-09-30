import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REQUIRED_JOB_NAMES = [
  "Lint, typecheck, test, and build",
  "Playwright",
];

// A push to main can be skipped only when this exact commit was already
// tested by pull_request (fast-forward of that SHA) or merge_group (the
// queue commit that lands on main). A previous push run does not count.
export const PRIOR_VERIFYING_EVENTS = new Set(["pull_request", "merge_group"]);

export function mainCommitAlreadyVerified({ runAttempt, currentRunId, runs, jobsForRun }) {
  if (Number(runAttempt) !== 1) return false;

  for (const run of runs) {
    if (Number(run.id) === Number(currentRunId)) continue;
    if (run.conclusion !== "success") continue;
    if (!PRIOR_VERIFYING_EVENTS.has(run.event)) continue;

    const jobs = jobsForRun(run.id);
    const verified = REQUIRED_JOB_NAMES.every((name) =>
      jobs.some((job) => job.name === name && job.conclusion === "success"),
    );
    if (verified) return true;
  }

  return false;
}

function ghApiLines(apiPath) {
  const stdout = execFileSync("gh", ["api", "--paginate", "--jq", "(.workflow_runs[]?, .jobs[]?) | {id,event,conclusion,name}", apiPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function listSuccessfulRuns(repository, sha) {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`Refusing to query CI history for an unexpected SHA: ${sha}`);
  }
  const encodedRepo = repository.split("/").map(encodeURIComponent).join("/");
  return ghApiLines(
    `repos/${encodedRepo}/actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&per_page=100`,
  ).filter((run) => run.event);
}

function listJobs(repository, runId) {
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error(`Refusing to query jobs for an unexpected run id: ${runId}`);
  }
  const encodedRepo = repository.split("/").map(encodeURIComponent).join("/");
  return ghApiLines(`repos/${encodedRepo}/actions/runs/${runId}/jobs?per_page=100`).filter((job) => job.name);
}

function writeOutput(verified) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `verified=${verified ? "true" : "false"}\n`);
}

function main() {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const sha = process.env.TARGET_SHA ?? "";
  const runAttempt = process.env.RUN_ATTEMPT ?? "1";
  const currentRunId = Number(process.env.RUN_ID ?? "0");

  if (!repository || !sha) {
    throw new Error("GITHUB_REPOSITORY and TARGET_SHA are required");
  }

  let verified = false;
  try {
    const runs = listSuccessfulRuns(repository, sha);
    verified = mainCommitAlreadyVerified({
      runAttempt,
      currentRunId,
      runs,
      jobsForRun: (runId) => listJobs(repository, Number(runId)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.log("Could not confirm prior verification. Running the full suite.");
    writeOutput(false);
    return;
  }

  if (verified) {
    console.log(
      `Commit ${sha} already passed lint, typecheck, unit tests, production build, and Playwright. Skipping the duplicate main run.`,
    );
  } else {
    console.log(
      `Commit ${sha} has no successful pull_request or merge_group run of both CI jobs. Running the full suite.`,
    );
  }

  writeOutput(verified);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
