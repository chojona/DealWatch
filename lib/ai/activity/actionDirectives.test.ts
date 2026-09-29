import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractActivityFacts, extractActivityFactsWithModel } from "./extractActivityFacts";
import { readActionDirective } from "./actionDirectives";

function directive(body: string, speakerSide?: "OUR_SIDE" | "COUNTERPARTY" | null) {
  const facts = extractActivityFacts({ bodyText: body, speakerSide });
  return facts.filter((fact) => fact.action);
}

describe("Phase 12A deterministic action directives", () => {
  test("A explicit document request preserves due text and invents no timestamp", () => {
    const [fact] = directive("Please send us the revised proposal by Friday.");
    assert.equal(fact?.action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(fact?.factType, "OTHER");
    assert.equal(fact?.canonicalType, null);
    assert.equal(fact?.negotiation, null);
    assert.equal(fact?.action?.dueText, "by Friday");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
    assert.equal(fact?.action?.fulfillsFactId, null);
    assert.equal(fact?.evidenceQuote, "Please send us the revised proposal by Friday.");
    assert.equal(fact?.provenanceStatus, "EXACT");
  });

  test("B explicit information request is not collapsed into a bare response", () => {
    const [whether] = directive("Can you confirm whether the landlord approved this?");
    assert.equal(whether?.action?.kind, "INFORMATION_REQUESTED");
    const [financials] = directive("Please send the latest financials.");
    assert.equal(financials?.action?.kind, "DOCUMENT_REQUESTED");
    const [reply] = directive("Please confirm receipt.");
    assert.equal(reply?.action?.kind, "RESPONSE_REQUESTED");
  });

  test("C explicit call request", () => {
    const [fact] = directive("Can we schedule a call?");
    assert.equal(fact?.action?.kind, "CALL_REQUESTED");
    assert.equal(fact?.factType, "OTHER");
  });

  test("D explicit meeting request keeps the weekday as text", () => {
    const [fact] = directive("Let's meet Tuesday.");
    assert.equal(fact?.action?.kind, "MEETING_REQUESTED");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
    assert.equal(fact?.action?.dueText, null);
  });

  test("E explicit commitment", () => {
    const [send] = directive("We'll send you the revised proposal.");
    assert.equal(send?.action?.kind, "COMMITMENT");
    const [follow] = directive("I'll follow up with ownership.");
    assert.equal(follow?.action?.kind, "COMMITMENT");
    const [asked] = directive("Please follow up with ownership.");
    assert.equal(asked?.action?.kind, "FOLLOW_UP_REQUESTED");
  });

  test("F responsible side is our side only from explicit speaker direction", () => {
    const [fact] = directive("Please send us the revised proposal.", "COUNTERPARTY");
    assert.equal(fact?.action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(fact?.action?.responsibleSide, "OUR_SIDE");
  });

  test("G responsible side is the counterparty when the speaker on our side asks them to act", () => {
    const [asked] = directive("Please send us the revised proposal.", "OUR_SIDE");
    assert.equal(asked?.action?.responsibleSide, "COUNTERPARTY");
    const [committed] = directive("We'll send you the revised proposal.", "COUNTERPARTY");
    assert.equal(committed?.action?.kind, "COMMITMENT");
    assert.equal(committed?.action?.responsibleSide, "COUNTERPARTY");
  });

  test("H uncertain side stays unknown without speaker direction", () => {
    for (const body of [
      "Please send us the revised proposal.",
      "We'll send you the revised proposal.",
      "Can we schedule a call?",
      "Let's meet Tuesday.",
    ]) {
      const [fact] = directive(body);
      assert.equal(fact?.action?.responsibleSide, "UNKNOWN", body);
      assert.equal(fact?.action?.responsibleLabel, null);
      assert.equal(fact?.action?.counterpartyLabel, null);
    }
  });

  test("I-N and nearby adversarial wording creates no current directive", () => {
    const silent = [
      "We discussed sending a proposal.",
      "Maybe they will send something.",
      "Jonathan asked about the proposal last month.",
      "The proposal wasn't requested.",
      "No need to send another proposal.",
      "They might want updated financials.",
      "We talked about scheduling a call.",
      "If they ask, we'll send it.",
      "We'll send the proposal if they ask.",
      "Please send the proposal if you can.",
      "They could send the financials.",
      "He wrote \"Please send the revised proposal.\"",
      "The proposal was not requested.",
      "Do not send another proposal.",
      "We should send the revised proposal.",
      "They will send the revised proposal.",
      "Happy to schedule a call this week.",
      "Please let me know if you need any additional information.",
      "We need a lease execution by November 15, 2026.",
      "> Please send the revised proposal.",
    ];
    for (const body of silent) {
      assert.deepEqual(directive(body, "OUR_SIDE"), [], body);
      assert.equal(readActionDirective(body, { speakerSide: "OUR_SIDE" }), null, body);
    }
  });

  test("O an absolute due phrase stays text", () => {
    const [fact] = directive("Please send the rent roll by November 15, 2026.");
    assert.equal(fact?.action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(fact?.action?.dueText, "by November 15, 2026");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.factType, "OTHER");
  });

  test("model output still cannot smuggle an action object", async () => {
    const facts = await extractActivityFactsWithModel(
      { bodyText: "Please send the revised proposal.", speakerSide: "COUNTERPARTY" },
      async () => JSON.stringify({
        facts: [{
          factType: "OTHER",
          canonicalType: null,
          side: "UNKNOWN",
          assertionStatus: "PROPOSED",
          evidenceQuote: "Please send the revised proposal.",
          display: "Request",
          numeric: null,
          unit: null,
          negotiation: null,
          action: {
            kind: "DOCUMENT_REQUESTED",
            responsibleSide: "OUR_SIDE",
            responsibleLabel: null,
            counterpartyLabel: null,
            dueAt: null,
            dueText: null,
            occursAt: null,
            fulfillsFactId: null,
          },
        }],
      }),
    );
    assert.equal(facts.length, 1);
    assert.equal("action" in facts[0]!, false);
  });

  test("a later message that sounds fulfilled does not close the request", () => {
    const [request] = directive("Please send the revised proposal.");
    const later = directive("Attached is the revised proposal.");
    assert.equal(request?.action?.fulfillsFactId, null);
    assert.deepEqual(later, []);
  });
});
