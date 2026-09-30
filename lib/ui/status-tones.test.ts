import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  toneForComparisonOutcome,
  toneForNegotiationStatus,
  toneForObligationStatus,
} from "./status-tones";

describe("status tone map", () => {
  test("formal negotiation states keep distinct identities", () => {
    const statuses = ["AGREED", "OPEN", "UNRESOLVED", "PROPOSED", "CONFLICT", "REJECTED", "WITHDRAWN", "NOT_MENTIONED", "UNKNOWN", "STALE"];
    const tones = Object.fromEntries(statuses.map((status) => [status, toneForNegotiationStatus(status)]));

    assert.equal(tones.AGREED, "success");
    assert.equal(tones.OPEN, "warning");
    assert.equal(tones.UNRESOLVED, "warning");
    assert.equal(tones.STALE, "warning");
    assert.equal(tones.PROPOSED, "info");
    assert.equal(tones.CONFLICT, "danger");
    assert.equal(tones.REJECTED, "danger");
    assert.equal(tones.WITHDRAWN, "neutral");
    assert.equal(tones.NOT_MENTIONED, "neutral");
    assert.equal(tones.UNKNOWN, "quiet");

    assert.notEqual(tones.REJECTED, tones.WITHDRAWN);
    assert.notEqual(tones.CONFLICT, tones.OPEN);
    assert.notEqual(tones.AGREED, tones.PROPOSED);
    assert.notEqual(tones.UNKNOWN, tones.OPEN);
    assert.equal(tones.CONFLICT, tones.REJECTED);
    assert.notEqual("CONFLICT", "REJECTED");
    assert.equal(tones.OPEN, tones.UNRESOLVED);
    assert.notEqual("OPEN", "UNRESOLVED");
  });

  test("unknown negotiation statuses fail closed instead of looking open", () => {
    assert.equal(toneForNegotiationStatus("MAYBE"), "quiet");
    assert.notEqual(toneForNegotiationStatus("MAYBE"), toneForNegotiationStatus("OPEN"));
    assert.notEqual(toneForNegotiationStatus("MAYBE"), toneForNegotiationStatus("UNRESOLVED"));
  });

  test("obligation Open stays distinct from Waiting and from formal Open", () => {
    assert.equal(toneForObligationStatus("OPEN"), "info");
    assert.equal(toneForObligationStatus("WAITING"), "warning");
    assert.equal(toneForObligationStatus("OVERDUE"), "danger");
    assert.equal(toneForObligationStatus("COMPLETED"), "success");
    assert.notEqual(toneForObligationStatus("OPEN"), toneForObligationStatus("WAITING"));
    assert.notEqual(toneForObligationStatus("OPEN"), toneForNegotiationStatus("OPEN"));
  });

  test("paper and email comparison outcomes stay distinct", () => {
    assert.equal(toneForComparisonOutcome("DIFFERS"), "warning");
    assert.equal(toneForComparisonOutcome("MATCH"), "success");
    assert.equal(toneForComparisonOutcome("NOT_COMPARABLE"), "quiet");
    assert.notEqual(toneForComparisonOutcome("DIFFERS"), toneForComparisonOutcome("MATCH"));
    assert.notEqual(toneForComparisonOutcome("MATCH"), toneForComparisonOutcome("NOT_COMPARABLE"));
  });
});
