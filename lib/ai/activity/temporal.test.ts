import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractActivityFacts, extractActivityFactsWithModel } from "./extractActivityFacts";
import { readActionDirective } from "./actionDirectives";
import { normalizeTemporalEvidence } from "./temporal";

function directive(body: string, speakerSide?: "OUR_SIDE" | "COUNTERPARTY" | null) {
  return extractActivityFacts({ bodyText: body, speakerSide }).filter((fact) => fact.action);
}

describe("Phase 12B deterministic temporal normalization", () => {
  test("A explicit date, year, time, and timezone normalizes", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by November 15, 2026 at 5:00 PM ET.");
    assert.equal(result.status, "normalized");
    if (result.status !== "normalized") return;
    assert.equal(result.instant, "2026-11-15T17:00:00-05:00");
    assert.equal(result.role, "due");
    assert.equal(result.sourceText, "by November 15, 2026 at 5:00 PM ET");
  });

  test("B explicit named timezone normalizes", () => {
    const result = normalizeTemporalEvidence("Call scheduled for December 3, 2026 at 10:30 AM America/New_York.");
    assert.equal(result.status, "normalized");
    if (result.status !== "normalized") return;
    assert.equal(result.instant, "2026-12-03T10:30:00-05:00");
    assert.equal(result.role, "occurrence");
    assert.equal(result.sourceText, "December 3, 2026 at 10:30 AM America/New_York");
  });

  test("C normalized instant is ISO with an explicit offset and a summer ET offset is not EST", () => {
    const winter = normalizeTemporalEvidence("by November 15, 2026 at 5:00 PM ET");
    const summer = normalizeTemporalEvidence("by July 15, 2026 at 5:00 PM ET");
    const iso = normalizeTemporalEvidence("by 2026-11-15T22:00:00Z");
    assert.equal(winter.status, "normalized");
    assert.equal(summer.status, "normalized");
    assert.equal(iso.status, "normalized");
    if (winter.status !== "normalized" || summer.status !== "normalized" || iso.status !== "normalized") return;
    assert.match(winter.instant, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/);
    assert.equal(winter.instant, "2026-11-15T17:00:00-05:00");
    assert.equal(summer.instant, "2026-07-15T17:00:00-04:00");
    assert.equal(iso.instant, "2026-11-15T22:00:00Z");
    assert.equal(new Date(winter.instant).toISOString(), "2026-11-15T22:00:00.000Z");
    assert.equal(new Date(summer.instant).toISOString(), "2026-07-15T21:00:00.000Z");
  });

  test("D a date without a time does not invent a clock time", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by November 15, 2026.");
    assert.equal(result.status, "unresolved");
    if (result.status !== "unresolved") return;
    assert.equal(result.sourceText, "by November 15, 2026");
    assert.equal(result.role, "due");
    const [fact] = directive("Please send the rent roll by November 15, 2026.");
    assert.equal(fact?.action?.dueText, "by November 15, 2026");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
  });

  test("E a time without a date does not invent a date", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by 5:00 PM ET.");
    assert.equal(result.status, "unresolved");
    if (result.status !== "unresolved") return;
    assert.match(result.sourceText ?? "", /5:00 PM ET/);
    const [fact] = directive("Please send the rent roll by 5:00 PM ET.");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
  });

  test("F a date and time without a timezone does not invent one", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by November 15, 2026 at 5:00 PM.");
    assert.equal(result.status, "unresolved");
    if (result.status !== "unresolved") return;
    assert.match(result.sourceText ?? "", /November 15, 2026 at 5:00 PM/);
    const [fact] = directive("Please send the rent roll by November 15, 2026 at 5:00 PM.");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
    assert.match(fact?.action?.dueText ?? "", /November 15, 2026 at 5:00 PM/);
  });

  test("G Friday stays unresolved", () => {
    const result = normalizeTemporalEvidence("Please send us the revised proposal by Friday.");
    assert.equal(result.status, "unresolved");
    const [fact] = directive("Please send us the revised proposal by Friday.");
    assert.equal(fact?.action?.dueText, "by Friday");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
  });

  test("H tomorrow stays unresolved without a reference-date policy", () => {
    const result = normalizeTemporalEvidence("Please send the revised proposal by tomorrow.");
    assert.equal(result.status, "unresolved");
    const [fact] = directive("Please send the revised proposal by tomorrow.");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
  });

  test("I next week stays unresolved", () => {
    const result = normalizeTemporalEvidence("Please send the revised proposal by next week.");
    assert.equal(result.status, "unresolved");
    assert.equal(directive("Please send the revised proposal by next week.")[0]?.action?.dueAt, null);
  });

  test("J tomorrow morning does not invent a clock time", () => {
    const result = normalizeTemporalEvidence("Can we schedule a call tomorrow morning?");
    assert.equal(result.status, "unresolved");
    const [fact] = directive("Can we schedule a call tomorrow morning?");
    assert.equal(fact?.action?.kind, "CALL_REQUESTED");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
  });

  test("K approximate wording stays unresolved", () => {
    for (const text of ["around 3", "later Friday", "sometime next week", "before the end of the month", "ASAP"]) {
      const result = normalizeTemporalEvidence(text);
      assert.equal(result.status, "unresolved", text);
    }
    const decorated = normalizeTemporalEvidence("Please send the rent roll by around November 15, 2026 at 5:00 PM ET.");
    assert.equal(decorated.status, "unresolved");
  });

  test("L ambiguous numeric dates stay unresolved", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by 11/12/26 at 5:00 PM ET.");
    assert.equal(result.status, "unresolved");
    assert.equal(directive("Please send the rent roll by 11/12/2026 at 5:00 PM ET.")[0]?.action?.dueAt, null);
  });

  test("M an impossible date is rejected", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by November 31, 2026 at 5:00 PM ET.");
    assert.equal(result.status, "invalid");
    if (result.status !== "invalid") return;
    assert.equal(result.reason, "impossible_date");
    const [fact] = directive("Please send the rent roll by November 31, 2026 at 5:00 PM ET.");
    assert.equal(fact?.action?.dueAt, null);
    assert.match(fact?.action?.dueText ?? "", /November 31, 2026/);
  });

  test("N an invalid time is rejected", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by November 15, 2026 at 5:60 PM ET.");
    assert.equal(result.status, "invalid");
    if (result.status !== "invalid") return;
    assert.equal(result.reason, "invalid_time");
    assert.equal(directive("Please send the rent roll by November 15, 2026 at 25:00 ET.")[0]?.action?.dueAt, null);
  });

  test("O conflicting timezones do not normalize", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by November 15, 2026 at 5:00 PM ET PDT.");
    assert.equal(result.status, "invalid");
    if (result.status !== "invalid") return;
    assert.equal(result.reason, "conflicting_timezone");
    const agreeing = normalizeTemporalEvidence("Please send the rent roll by November 15, 2026 at 5:00 PM ET (UTC-05:00).");
    assert.equal(agreeing.status, "normalized");
    if (agreeing.status !== "normalized") return;
    assert.equal(agreeing.instant, "2026-11-15T17:00:00-05:00");
    const summerConflict = normalizeTemporalEvidence("Please send the rent roll by July 15, 2026 at 5:00 PM ET EST.");
    assert.equal(summerConflict.status, "invalid");
  });

  test("P source due text survives a successful normalization", () => {
    const [fact] = directive("Please send the rent roll by November 15, 2026 at 5:00 PM ET.");
    assert.equal(fact?.action?.dueAt, "2026-11-15T17:00:00-05:00");
    assert.equal(fact?.action?.dueText, "by November 15, 2026 at 5:00 PM ET");
    assert.equal(fact?.evidenceQuote, "Please send the rent roll by November 15, 2026 at 5:00 PM ET.");
    assert.equal(fact?.action?.occursAt, null);
    assert.equal(fact?.action?.fulfillsFactId, null);
    assert.equal(fact?.negotiation, null);
  });

  test("U a fully explicit meeting or call normalizes its occurrence", () => {
    const [meeting] = directive("Let's meet November 15, 2026 at 2:00 PM ET.");
    assert.equal(meeting?.action?.kind, "MEETING_REQUESTED");
    assert.equal(meeting?.action?.occursAt, "2026-11-15T14:00:00-05:00");
    assert.equal(meeting?.action?.dueAt, null);
    assert.equal(meeting?.evidenceQuote, "Let's meet November 15, 2026 at 2:00 PM ET.");
    const [call] = directive("Can we schedule a call for December 3, 2026 at 10:30 AM America/New_York.");
    assert.equal(call?.action?.kind, "CALL_REQUESTED");
    assert.equal(call?.action?.occursAt, "2026-12-03T10:30:00-05:00");
    assert.equal(call?.action?.dueAt, null);
  });

  test("V Tuesday and an unscheduled tour stay unresolved", () => {
    const [meeting] = directive("Let's meet Tuesday.");
    assert.equal(meeting?.action?.kind, "MEETING_REQUESTED");
    assert.equal(meeting?.action?.occursAt, null);
    assert.equal(meeting?.action?.dueAt, null);
    assert.equal(normalizeTemporalEvidence("Tour next week.").status, "unresolved");
    assert.equal(directive("Tour next week.").length, 0);
  });

  test("W named timezones follow daylight-saving transitions", () => {
    const before = normalizeTemporalEvidence("Let's meet March 8, 2026 at 1:30 AM America/New_York.");
    const after = normalizeTemporalEvidence("Let's meet March 8, 2026 at 3:30 AM America/New_York.");
    const gap = normalizeTemporalEvidence("Let's meet March 8, 2026 at 2:30 AM America/New_York.");
    const overlap = normalizeTemporalEvidence("Let's meet November 1, 2026 at 1:30 AM America/New_York.");
    assert.equal(before.status, "normalized");
    assert.equal(after.status, "normalized");
    if (before.status !== "normalized" || after.status !== "normalized") return;
    assert.equal(before.instant, "2026-03-08T01:30:00-05:00");
    assert.equal(after.instant, "2026-03-08T03:30:00-04:00");
    assert.equal(gap.status, "invalid");
    assert.equal(overlap.status, "invalid");
    if (overlap.status !== "invalid") return;
    assert.equal(overlap.reason, "ambiguous");
  });

  test("AA Phase 12A directive grammar and model stripping stay intact", async () => {
    assert.equal(directive("We discussed sending a proposal.").length, 0);
    assert.equal(directive("We need a lease execution by November 15, 2026.").length, 0);
    const unchanged = readActionDirective("Please send us the revised proposal by Friday.");
    assert.equal(unchanged?.action.dueAt, null);
    assert.equal(unchanged?.action.occursAt, null);
    const facts = await extractActivityFactsWithModel(
      { bodyText: "Please send the revised proposal by November 15, 2026 at 5:00 PM ET." },
      async () => JSON.stringify({
        facts: [{
          factType: "OTHER",
          canonicalType: null,
          side: "UNKNOWN",
          assertionStatus: "PROPOSED",
          evidenceQuote: "Please send the revised proposal by November 15, 2026 at 5:00 PM ET.",
          display: "Request",
          numeric: null,
          unit: null,
          negotiation: null,
          action: {
            kind: "DOCUMENT_REQUESTED",
            responsibleSide: "OUR_SIDE",
            responsibleLabel: null,
            counterpartyLabel: null,
            dueAt: "2026-11-15T17:00:00-05:00",
            dueText: "by November 15, 2026 at 5:00 PM ET",
            occursAt: null,
            fulfillsFactId: null,
          },
        }],
      }),
    );
    assert.equal(facts.length, 1);
    assert.equal("action" in facts[0]!, false);
  });

  test("a passive scheduled call normalizes in the temporal reader and does not become a new fact", () => {
    const result = normalizeTemporalEvidence("Call scheduled for December 3, 2026 at 10:30 AM America/New_York.");
    assert.equal(result.status, "normalized");
    assert.equal(directive("Call scheduled for December 3, 2026 at 10:30 AM America/New_York.").length, 0);
  });

  test("two different explicit instants do not collapse into one", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by November 15, 2026 at 5:00 PM ET or November 16, 2026 at 5:00 PM ET.");
    assert.equal(result.status, "invalid");
    if (result.status !== "invalid") return;
    assert.equal(result.reason, "ambiguous");
    assert.equal(directive("Please send the rent roll by November 15, 2026 at 5:00 PM ET or November 16, 2026 at 5:00 PM ET.")[0]?.action?.dueAt, null);
  });

  test("an explicit fixed abbreviation keeps its offset in summer", () => {
    const result = normalizeTemporalEvidence("Please send the rent roll by July 15, 2026 at 5:00 PM EST.");
    assert.equal(result.status, "normalized");
    if (result.status !== "normalized") return;
    assert.equal(result.instant, "2026-07-15T17:00:00-05:00");
  });
});
