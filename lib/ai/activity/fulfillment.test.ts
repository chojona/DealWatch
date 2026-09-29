import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { extractActivityFacts, extractActivityFactsWithModel, activityExtractionPrompt } from "./extractActivityFacts";
import { readExplicitFulfillment, resolveFulfillmentTarget, type FulfillmentTarget } from "./fulfillment";

const scope = {
  workspaceId: "ws-1",
  dealId: "deal-1",
  timestamp: "2026-09-22T15:00:00.000Z",
};

function target(overrides: Partial<FulfillmentTarget> & Pick<FulfillmentTarget, "id" | "evidenceQuote">): FulfillmentTarget {
  return {
    workspaceId: "ws-1",
    dealId: "deal-1",
    timestamp: "2026-09-20T15:00:00.000Z",
    assertionStatus: "PROPOSED",
    provenanceStatus: "EXACT",
    reviewed: true,
    actionKind: "DOCUMENT_REQUESTED",
    ...overrides,
  };
}

function linked(body: string, targets: FulfillmentTarget[]) {
  const facts = extractActivityFacts({
    bodyText: body,
    fulfillment: { ...scope, targets },
  });
  return facts.filter((fact) => fact.action?.kind === "FULFILLMENT");
}

describe("Phase 12C explicit fulfillment linking", () => {
  test("A revised proposal you requested links to the one reviewed document request", () => {
    const proposal = target({ id: "fact-proposal", evidenceQuote: "Please send the revised proposal." });
    const [fact] = linked("Attached is the revised proposal you requested.", [proposal]);
    assert.equal(fact?.factType, "DOCUMENT_SENT");
    assert.equal(fact?.assertionStatus, "ACCEPTED");
    assert.equal(fact?.canonicalType, null);
    assert.equal(fact?.negotiation, null);
    assert.equal(fact?.action?.kind, "FULFILLMENT");
    assert.equal(fact?.action?.fulfillsFactId, "fact-proposal");
    assert.equal(fact?.action?.dueAt, null);
    assert.equal(fact?.action?.occursAt, null);
    assert.equal(fact?.evidenceQuote, "Attached is the revised proposal you requested.");
    assert.equal(fact?.provenanceStatus, "EXACT");
  });

  test("B financials you requested links only to the financials request", () => {
    const financials = target({ id: "fact-financials", evidenceQuote: "Please send the latest financials." });
    const proposal = target({ id: "fact-proposal", evidenceQuote: "Please send the revised proposal." });
    const [fact] = linked("Attached are the financials you requested.", [financials, proposal]);
    assert.equal(fact?.action?.fulfillsFactId, "fact-financials");
  });

  test("C attached financials without a request reference does not link", () => {
    const financials = target({ id: "fact-financials", evidenceQuote: "Please send the latest financials." });
    assert.equal(readExplicitFulfillment("Attached are the financials."), null);
    assert.equal(linked("Attached are the financials.", [financials]).length, 0);
  });

  test("D here is the proposal does not link", () => {
    const proposal = target({ id: "fact-proposal", evidenceQuote: "Please send the revised proposal." });
    assert.equal(readExplicitFulfillment("Here is the proposal."), null);
    assert.equal(linked("Here is the proposal.", [proposal]).length, 0);
  });

  test("E as requested links when one reviewed request is identifiable", () => {
    const proposal = target({ id: "fact-proposal", evidenceQuote: "Please send the revised proposal." });
    const [fact] = linked("Sending this as requested.", [proposal]);
    assert.equal(fact?.action?.fulfillsFactId, "fact-proposal");
    assert.equal(fact?.factType, "OTHER");
  });

  test("F two proposal requests stay unlinked", () => {
    const revised = target({ id: "fact-revised", evidenceQuote: "Please send the revised proposal." });
    const updated = target({ id: "fact-updated", evidenceQuote: "Please send the updated proposal." });
    const [fact] = linked("Attached is the proposal you requested.", [revised, updated]);
    assert.ok(fact);
    assert.equal(fact?.action?.fulfillsFactId, null);
  });

  test("G a rejected earlier fact cannot be the target", () => {
    const rejected = target({ id: "fact-rejected", evidenceQuote: "Please send the revised proposal.", reviewed: false });
    const [fact] = linked("Attached is the revised proposal you requested.", [rejected]);
    assert.ok(fact);
    assert.equal(fact?.action?.fulfillsFactId, null);
  });

  test("H an unreviewed earlier request cannot be the target", () => {
    const unreviewed = target({
      id: "fact-unreviewed",
      evidenceQuote: "Please send the revised proposal.",
      reviewed: false,
    });
    const [fact] = linked("Attached is the revised proposal you requested.", [unreviewed]);
    assert.equal(fact?.action?.fulfillsFactId, null);
  });

  test("I a cross-deal target is rejected", () => {
    const otherDeal = target({
      id: "fact-other-deal",
      dealId: "deal-2",
      evidenceQuote: "Please send the revised proposal.",
    });
    const [fact] = linked("Attached is the revised proposal you requested.", [otherDeal]);
    assert.equal(fact?.action?.fulfillsFactId, null);
  });

  test("J a cross-workspace target is rejected", () => {
    const otherWorkspace = target({
      id: "fact-other-ws",
      workspaceId: "ws-2",
      evidenceQuote: "Please send the revised proposal.",
    });
    const [fact] = linked("Attached is the revised proposal you requested.", [otherWorkspace]);
    assert.equal(fact?.action?.fulfillsFactId, null);
  });

  test("K a later target is rejected", () => {
    const later = target({
      id: "fact-later",
      timestamp: "2026-09-23T15:00:00.000Z",
      evidenceQuote: "Please send the revised proposal.",
    });
    const [fact] = linked("Attached is the revised proposal you requested.", [later]);
    assert.equal(fact?.action?.fulfillsFactId, null);
  });

  test("L M N O attachment wording, a shared day, nearness, and a single open action do not link without an explicit reference", () => {
    const only = target({
      id: "fact-only",
      evidenceQuote: "Please send the revised proposal by Friday.",
      timestamp: "2026-09-22T12:00:00.000Z",
    });
    for (const body of [
      "Attached are the financials.",
      "Here is the proposal.",
      "See proposal.pdf.",
      "The file is attached.",
    ]) {
      assert.equal(linked(body, [only]).length, 0, body);
    }
  });

  test("P Q R S T historical, quoted, hypothetical, negated, and question wording are not current fulfillment", () => {
    const proposal = target({ id: "fact-proposal", evidenceQuote: "Please send the revised proposal." });
    for (const body of [
      "We sent the proposal last month.",
      "They said \"attached is the proposal you requested.\"",
      "The financials were previously sent.",
      "If they request it, we'll send it.",
      "We may send the proposal.",
      "No proposal was sent.",
      "Did you send the proposal?",
      "Please send the proposal.",
    ]) {
      assert.equal(linked(body, [proposal]).length, 0, body);
    }
  });

  test("a revised referent does not attach to a different proposal modifier", () => {
    const updated = target({ id: "fact-updated", evidenceQuote: "Please send the updated proposal." });
    const [fact] = linked("Attached is the revised proposal you requested.", [updated]);
    assert.equal(fact?.action?.fulfillsFactId, null);
  });

  test("per your request and following up on your request are explicit references", () => {
    const financials = target({ id: "fact-financials", evidenceQuote: "Please send the latest financials." });
    assert.equal(linked("Per your request, here are the financials.", [financials])[0]?.action?.fulfillsFactId, "fact-financials");
    assert.equal(
      linked("Following up on your request, attached is the revised proposal.", [
        target({ id: "fact-proposal", evidenceQuote: "Please send the revised proposal." }),
      ])[0]?.action?.fulfillsFactId,
      "fact-proposal",
    );
  });

  test("ambiguous nounless references and commitments are not guessed", () => {
    const left = target({ id: "left", evidenceQuote: "Please respond by Friday.", actionKind: "RESPONSE_REQUESTED" });
    const right = target({ id: "right", evidenceQuote: "Please send the rent roll.", actionKind: "DOCUMENT_REQUESTED" });
    const [fact] = linked("Sending this as requested.", [left, right]);
    assert.equal(fact?.action?.fulfillsFactId, null);
    const commitment = target({
      id: "commitment",
      evidenceQuote: "We'll send the revised proposal.",
      actionKind: "COMMITMENT",
    });
    assert.equal(linked("Attached is the revised proposal you requested.", [commitment])[0]?.action?.fulfillsFactId, null);
  });

  test("invalid provenance and rejected assertions are not targets", () => {
    const ambiguous = target({
      id: "ambiguous",
      evidenceQuote: "Please send the revised proposal.",
      provenanceStatus: "AMBIGUOUS",
    });
    const historical = target({
      id: "historical",
      evidenceQuote: "Please send the revised proposal.",
      assertionStatus: "HISTORICAL",
    });
    assert.equal(linked("Attached is the revised proposal you requested.", [ambiguous])[0]?.action?.fulfillsFactId, null);
    assert.equal(linked("Attached is the revised proposal you requested.", [historical])[0]?.action?.fulfillsFactId, null);
    assert.equal(resolveFulfillmentTarget(readExplicitFulfillment("Attached is the revised proposal you requested.")!, [], scope), null);
  });

  test("speaker side is copied only when already supplied", () => {
    const proposal = target({ id: "fact-proposal", evidenceQuote: "Please send the revised proposal." });
    const unknown = extractActivityFacts({
      bodyText: "Attached is the revised proposal you requested.",
      speakerSide: null,
      fulfillment: { ...scope, targets: [proposal] },
    }).find((fact) => fact.action?.kind === "FULFILLMENT");
    assert.equal(unknown?.action?.responsibleSide, "UNKNOWN");
    const ours = extractActivityFacts({
      bodyText: "Attached is the revised proposal you requested.",
      speakerSide: "OUR_SIDE",
      fulfillment: { ...scope, targets: [proposal] },
    }).find((fact) => fact.action?.kind === "FULFILLMENT");
    assert.equal(ours?.action?.responsibleSide, "OUR_SIDE");
  });

  test("AD the model contract cannot invent fulfillsFactId", async () => {
    const prompt = activityExtractionPrompt();
    assert.equal(prompt.includes("fulfillsFactId"), false);
    assert.match(prompt, /Do not return an action object/);
    const source = readFileSync(new URL("./fulfillment.ts", import.meta.url), "utf8");
    assert.equal(source.includes("openai"), false);
    assert.equal(source.includes("fetch("), false);
    const facts = await extractActivityFactsWithModel(
      { bodyText: "Attached is the revised proposal you requested." },
      async () => JSON.stringify({
        facts: [{
          factType: "DOCUMENT_SENT",
          canonicalType: null,
          side: "UNKNOWN",
          assertionStatus: "ACCEPTED",
          evidenceQuote: "Attached is the revised proposal you requested.",
          display: "Document sent",
          numeric: null,
          unit: null,
          negotiation: null,
          action: { kind: "FULFILLMENT", fulfillsFactId: "fact-proposal" },
        }],
      }),
    );
    assert.equal(facts[0]?.action, undefined);
    assert.equal(JSON.stringify(facts).includes("fulfillsFactId"), false);
  });
});
