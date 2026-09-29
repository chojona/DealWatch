import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isE2ETestMode } from "./mode";

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  DEALWATCH_E2E: process.env.DEALWATCH_E2E,
  DEALWATCH_E2E_CONFIRM: process.env.DEALWATCH_E2E_CONFIRM,
};

function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

afterEach(() => {
  setNodeEnv(ORIGINAL.NODE_ENV);
  if (ORIGINAL.DEALWATCH_E2E === undefined) delete process.env.DEALWATCH_E2E;
  else process.env.DEALWATCH_E2E = ORIGINAL.DEALWATCH_E2E;
  if (ORIGINAL.DEALWATCH_E2E_CONFIRM === undefined) delete process.env.DEALWATCH_E2E_CONFIRM;
  else process.env.DEALWATCH_E2E_CONFIRM = ORIGINAL.DEALWATCH_E2E_CONFIRM;
});

test("deterministic analysis stays off without both explicit flags", () => {
  setNodeEnv("development");
  delete process.env.DEALWATCH_E2E;
  delete process.env.DEALWATCH_E2E_CONFIRM;
  assert.equal(isE2ETestMode(), false);
  process.env.DEALWATCH_E2E = "1";
  assert.equal(isE2ETestMode(), false);
});

test("deterministic analysis cannot turn on in production", () => {
  setNodeEnv("production");
  process.env.DEALWATCH_E2E = "1";
  process.env.DEALWATCH_E2E_CONFIRM = "deterministic-analysis";
  assert.equal(isE2ETestMode(), false);
});

test("deterministic analysis turns on only for an explicit non-production opt-in", () => {
  setNodeEnv("test");
  process.env.DEALWATCH_E2E = "1";
  process.env.DEALWATCH_E2E_CONFIRM = "deterministic-analysis";
  assert.equal(isE2ETestMode(), true);
});
