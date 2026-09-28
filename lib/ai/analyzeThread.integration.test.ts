import assert from "node:assert/strict";
import test from "node:test";
import { analyzeThread } from "./analyzeThread";

const shouldRun =
  Boolean(process.env.OPENAI_API_KEY) &&
  process.env.RUN_DEALWATCH_INTEGRATION_TESTS === "1";

test(
  "real model returns source-grounded structured analysis",
  { skip: !shouldRun, timeout: 90_000 },
  async () => {
    const threadText = `From: Sarah Chen <sarah@broker.example>
Date: Monday, September 21, 2026 at 10:00 AM EDT
Subject: 500 Atlantic LOI

Derek,

I'll send the revised LOI tomorrow.

Sarah`;

    const result = await analyzeThread({
      threadText,
      analyzedAt: new Date("2026-09-21T18:00:00Z"),
    });

    assert.equal(result.metadata.detectedObligations, 1);
    assert.equal(result.obligations[0]?.status, "OPEN");
    assert.ok(threadText.includes(result.obligations[0]?.evidenceQuote ?? "\0"));
    assert.equal(result.obligations[0]?.dueAt, "2026-09-23T03:59:59.000Z");
  }
);

