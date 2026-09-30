import assert from "node:assert/strict";
import { test } from "node:test";
import { mainCommitAlreadyVerified, REQUIRED_JOB_NAMES } from "./ci-main-already-verified.mjs";

const passedGate = REQUIRED_JOB_NAMES.map((name) => ({ name, conclusion: "success" }));

test("an exact SHA verified on the pull request skips the main push", () => {
  const verified = mainCommitAlreadyVerified({
    runAttempt: 1,
    currentRunId: 99,
    runs: [{ id: 10, event: "pull_request", conclusion: "success" }],
    jobsForRun: () => passedGate,
  });
  assert.equal(verified, true);
});

test("a merge queue commit that already passed the CI job skips the main push", () => {
  const verified = mainCommitAlreadyVerified({
    runAttempt: 1,
    currentRunId: 99,
    runs: [{ id: 11, event: "merge_group", conclusion: "success" }],
    jobsForRun: () => passedGate,
  });
  assert.equal(verified, true);
});

test("a previous push run does not prove the commit was verified before landing", () => {
  const verified = mainCommitAlreadyVerified({
    runAttempt: 1,
    currentRunId: 99,
    runs: [{ id: 12, event: "push", conclusion: "success" }],
    jobsForRun: () => passedGate,
  });
  assert.equal(verified, false);
});

test("a missing or failed CI job still runs on main", () => {
  const runs = [{ id: 13, event: "pull_request", conclusion: "success" }];
  assert.equal(
    mainCommitAlreadyVerified({
      runAttempt: 1,
      currentRunId: 99,
      runs,
      jobsForRun: () => [],
    }),
    false,
  );
  assert.equal(
    mainCommitAlreadyVerified({
      runAttempt: 1,
      currentRunId: 99,
      runs,
      jobsForRun: () => [{ name: REQUIRED_JOB_NAMES[0], conclusion: "failure" }],
    }),
    false,
  );
});

test("a rerun of this workflow always executes the suite", () => {
  const verified = mainCommitAlreadyVerified({
    runAttempt: 2,
    currentRunId: 99,
    runs: [{ id: 14, event: "merge_group", conclusion: "success" }],
    jobsForRun: () => passedGate,
  });
  assert.equal(verified, false);
});

test("the current run cannot verify itself", () => {
  const verified = mainCommitAlreadyVerified({
    runAttempt: 1,
    currentRunId: 15,
    runs: [{ id: 15, event: "pull_request", conclusion: "success" }],
    jobsForRun: () => passedGate,
  });
  assert.equal(verified, false);
});
