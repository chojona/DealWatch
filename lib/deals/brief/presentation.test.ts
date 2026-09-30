import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { communicationFactDetail, communicationFactLabel } from "./presentation";

describe("communication fact labels", () => {
  test("an action stored as OTHER uses the request, not Other", () => {
    const label = communicationFactLabel({
      factType: "OTHER",
      canonicalType: null,
      evidenceQuote: "Please send the insurance certificate.",
      payload: {
        display: "Document requested",
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
      },
    });
    assert.equal(label, "Document requested");
    assert.equal(communicationFactDetail({
      label,
      display: "Document requested",
      evidenceQuote: "Please send the insurance certificate.",
    }), "Please send the insurance certificate.");
  });

  test("a commercial value keeps its term label and display", () => {
    const label = communicationFactLabel({
      factType: "NEGOTIATION_VALUE",
      canonicalType: "BASE_RENT",
      evidenceQuote: "Base rent is $67.00/RSF/year.",
      payload: {
        display: "$67.00/RSF/year",
        numeric: 67,
        unit: "USD_PER_RSF_YEAR",
        negotiation: null,
      },
    });
    assert.equal(label, "Base Rent");
    assert.equal(communicationFactDetail({
      label,
      display: "$67.00/RSF/year",
      evidenceQuote: "Base rent is $67.00/RSF/year.",
    }), "$67.00/RSF/year");
  });
});
