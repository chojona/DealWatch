import assert from "node:assert/strict";
import test from "node:test";
import { formatCalendarDate } from "./formatters";

test("a date-only instant keeps its UTC calendar day", () => {
  assert.equal(formatCalendarDate("2026-09-15T00:00:00.000Z"), "Sep 15, 2026");
  assert.equal(formatCalendarDate(new Date("2026-09-15T00:00:00.000Z")), "Sep 15, 2026");
});

test("a missing calendar date has no label", () => {
  assert.equal(formatCalendarDate(null), "—");
  assert.equal(formatCalendarDate(undefined), "—");
});
