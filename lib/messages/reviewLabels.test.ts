import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { extractionSourceLabel } from "./reviewLabels";

describe("extraction source label", () => {
  test("names the reader that produced the raw value", () => {
    assert.equal(extractionSourceLabel("DETERMINISTIC"), "Deterministic extraction");
    assert.equal(extractionSourceLabel("MODEL"), "Model extraction");
    assert.equal(extractionSourceLabel("OTHER"), "Extraction");
  });

  test("the message fact column uses the stored method", () => {
    const view = readFileSync(new URL("../../components/messages/message-source-view.tsx", import.meta.url), "utf8");
    assert.match(view, /extractionSourceLabel\(fact\.extractionMethod\)/);
    assert.equal(view.includes(">Model extraction<"), false);
  });
});
