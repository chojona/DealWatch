import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NegotiationTermView } from "./types";
import {
  decisionCopy,
  gapClosure,
  openTermTreatment,
  roundChangeLine,
  sideStep,
  filterNegotiationTerms,
  storedRelation,
} from "./workspace-present";

function term(overrides: Partial<NegotiationTermView> & Pick<NegotiationTermView, "canonicalType" | "label" | "status">): NegotiationTermView {
  return {
    group: "ECONOMICS",
    resolutionMode: "LEGACY",
    tenantPosition: null,
    landlordPosition: null,
    agreedPosition: null,
    conflict: false,
    movement: {
      kind: "NONE",
      label: "No prior position",
      side: null,
      from: null,
      to: null,
      amount: null,
      unit: null,
      direction: "UNKNOWN",
      roundId: null,
    },
    numericGap: null,
    changedInLatestRound: false,
    latestSideToChange: null,
    structuredState: null,
    evidence: [],
    history: [],
    sourceObservationIds: [],
    ...overrides,
  };
}

function value(summary: string, id: string) {
  return {
    kind: "VALUE" as const,
    value: { summary, details: [] },
    structuredPayload: null,
    observationIds: [id],
  };
}

describe("negotiation workspace presentation", () => {
  test("the decision sentence uses the highest-significance comparable gap", () => {
    const copy = decisionCopy([
      term({
        canonicalType: "TI_ALLOWANCE",
        label: "TI allowance",
        status: "PROPOSED",
        numericGap: { value: 10, unit: "USD_PER_RSF_YEAR", display: "$10.00 / RSF / yr" },
        tenantPosition: value("$115.00 / RSF", "t"),
        landlordPosition: value("$105.00 / RSF", "l"),
      }),
      term({
        canonicalType: "BASE_RENT",
        label: "Base rent",
        status: "PROPOSED",
        numericGap: { value: 3, unit: "USD_PER_RSF_YEAR", display: "$3.00 / RSF / yr" },
        tenantPosition: value("$64.00 / RSF / yr", "t"),
        landlordPosition: value("$67.00 / RSF / yr", "l"),
      }),
    ]);
    assert.equal(copy.sentence, "Base rent is $3.00 / RSF / yr apart.");
    assert.equal(copy.support, "1 other term is still open.");
  });

  test("a zero gap is not drawn as a position rail", () => {
    const escalation = term({
      canonicalType: "ANNUAL_ESCALATION",
      label: "Annual escalation",
      status: "PROPOSED",
      numericGap: { value: 0, unit: "PERCENT_ANNUAL", display: "0%" },
      tenantPosition: value("2.75%", "t"),
      landlordPosition: value("2.75%", "l"),
    });
    assert.equal(openTermTreatment(escalation), "prose");
    assert.equal(storedRelation(escalation), "Proposed");
  });

  test("matching positions stay prose", () => {
    assert.equal(openTermTreatment(term({
      canonicalType: "RENT_STRUCTURE",
      label: "Rent structure",
      status: "UNRESOLVED",
      tenantPosition: value("Triple net", "t"),
      landlordPosition: value("Triple net", "l"),
    })), "prose");
  });

  test("commencement stays prose and rejected is a stored relation", () => {
    assert.equal(openTermTreatment(term({
      canonicalType: "COMMENCEMENT_DATE",
      label: "Commencement date",
      status: "UNRESOLVED",
    })), "prose");
    assert.equal(storedRelation(term({
      canonicalType: "TERMINATION_RIGHTS",
      label: "Termination rights",
      status: "REJECTED",
    })), "Rejected");
  });

  test("gap closure requires a numeric movement that matches the formatted other side", () => {
    const rent = term({
      canonicalType: "BASE_RENT",
      label: "Base rent",
      status: "PROPOSED",
      numericGap: { value: 3, unit: "USD_PER_RSF_YEAR", display: "$3.00 / RSF / yr" },
      movement: {
        kind: "NUMERIC",
        label: "Landlord moved",
        side: "LANDLORD",
        from: 72,
        to: 67,
        amount: 5,
        unit: "USD_PER_RSF_YEAR",
        direction: "TOWARD_TENANT",
        roundId: "r",
      },
      history: [
        observation("t1", "TENANT", "$61.00 / RSF / yr"),
        observation("l1", "LANDLORD", "$72.00 / RSF / yr"),
        observation("t2", "TENANT", "$64.00 / RSF / yr"),
        observation("l2", "LANDLORD", "$67.00 / RSF / yr"),
      ],
    });
    assert.equal(sideStep(rent, "TENANT")?.delta, null);
    assert.equal(sideStep(rent, "LANDLORD")?.delta, "−$5.00 / RSF / yr");
    assert.deepEqual(gapClosure(rent), { display: "$8.00 / RSF / yr", widened: false });
  });

  test("Open keeps terms that require negotiation and All includes agreed terms", () => {
    const terms = [
      term({ canonicalType: "BASE_RENT", label: "Base rent", status: "PROPOSED" }),
      term({ canonicalType: "LEASE_TERM", label: "Lease term", status: "AGREED" }),
      term({ canonicalType: "TERMINATION_RIGHTS", label: "Termination rights", status: "REJECTED" }),
      term({ canonicalType: "COMMENCEMENT_DATE", label: "Commencement date", status: "UNRESOLVED" }),
    ];
    const open = filterNegotiationTerms(terms, "OPEN").map((item) => item.canonicalType);
    const all = filterNegotiationTerms(terms, "ALL").map((item) => item.canonicalType);
    assert.deepEqual(open, ["BASE_RENT", "COMMENCEMENT_DATE"]);
    assert.deepEqual(all, ["BASE_RENT", "LEASE_TERM", "TERMINATION_RIGHTS", "COMMENCEMENT_DATE"]);
    assert.notDeepEqual(open, all);
  });

  test("round lines keep the formal change readable", () => {
    assert.equal(roundChangeLine({
      canonicalType: "BASE_RENT",
      label: "Base rent",
      kind: "CHANGED",
      previousValue: "$72.00 / RSF / yr",
      currentValue: "$67.00 / RSF / yr",
    }), "Base rent: $72.00 / RSF / yr → $67.00 / RSF / yr");
    assert.equal(roundChangeLine({
      canonicalType: "BASE_RENT",
      label: "Base rent",
      kind: "CHANGED",
      previousValue: null,
      currentValue: "$72.00 / RSF / yr",
    }), "Base rent: $72.00 / RSF / yr");
  });
});

function observation(id: string, side: "TENANT" | "LANDLORD", summary: string) {
  return {
    id,
    roundId: id,
    roundName: id,
    roundDate: "2026-09-01T00:00:00.000Z",
    side,
    status: "PROPOSED" as const,
    value: { summary, details: [] },
    evidence: {
      observationId: id,
      quote: summary,
      originalQuote: summary,
      spanCorrected: false,
      confidence: 1,
      sourceKind: "PDF_UPLOAD",
      sourceLabel: "Paper",
      sourceLocation: null,
      provenanceStatus: "EXACT" as const,
      pageNumber: 1,
      pageLabel: "Page 1",
      documentId: null,
      href: null,
      modelDerived: true as const,
    },
    formalReview: null,
  };
}
