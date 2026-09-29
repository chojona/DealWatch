import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearE2EFailOnceState } from "./failOnce";
import { e2eNegotiationExtractor } from "./negotiationExtractor";

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  DEALWATCH_E2E: process.env.DEALWATCH_E2E,
  DEALWATCH_E2E_CONFIRM: process.env.DEALWATCH_E2E_CONFIRM,
};

function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function enable() {
  setNodeEnv("test");
  process.env.DEALWATCH_E2E = "1";
  process.env.DEALWATCH_E2E_CONFIRM = "deterministic-analysis";
}

afterEach(() => {
  setNodeEnv(ORIGINAL.NODE_ENV);
  if (ORIGINAL.DEALWATCH_E2E === undefined) delete process.env.DEALWATCH_E2E;
  else process.env.DEALWATCH_E2E = ORIGINAL.DEALWATCH_E2E;
  if (ORIGINAL.DEALWATCH_E2E_CONFIRM === undefined) delete process.env.DEALWATCH_E2E_CONFIRM;
  else process.env.DEALWATCH_E2E_CONFIRM = ORIGINAL.DEALWATCH_E2E_CONFIRM;
  clearE2EFailOnceState();
});

const input = {
  documentName: "loi.pdf",
  documentDate: new Date("2026-09-15T00:00:00Z"),
  side: "LANDLORD" as const,
  roundNumber: 1,
};

test("the E2E extractor misreads a marked rent line and keeps the paper quote", async () => {
  enable();
  const documentText = [
    "--- PAGE 1 ---",
    "Base Rent: $45.00 per rentable square foot per year",
    "E2E_EXTRACT_BASE_RENT:54",
  ].join("\n");
  const result = await e2eNegotiationExtractor({ ...input, documentText });
  assert.equal(result.terms[0]?.rawValue, "$54");
  assert.equal(result.terms[0]?.normalizedNumeric, 54);
  assert.equal(result.terms[0]?.evidenceQuote, "Base Rent: $45.00 per rentable square foot per year");
});

test("the E2E extractor fails once and then reads the rent line", async () => {
  enable();
  const documentText = "E2E_FAIL_ONCE\nBase Rent: $67.00 per rentable square foot per year";
  await assert.rejects(() => e2eNegotiationExtractor({ ...input, documentText }), /failed once/);
  const result = await e2eNegotiationExtractor({ ...input, documentText });
  assert.equal(result.terms[0]?.normalizedNumeric, 67);
});
