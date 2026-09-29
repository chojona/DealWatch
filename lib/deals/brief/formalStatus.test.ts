import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  countOpenFormalTerms,
  projectFormalBriefStatus,
} from "./formalStatus";
import {
  BRIEF_SECTION_CAPS,
  comparisonOutcomeLabel,
  displayedComparisons,
  hiddenCount,
  remainderLabel,
} from "./presentation";
import type { DealEvidenceComparison } from "./types";

describe("Deal Brief formal status projection", () => {
  test("REJECTED and WITHDRAWN stay distinct and do not count as open", () => {
    const rejected = projectFormalBriefStatus({ label: "Base rent", status: "REJECTED", conflict: false });
    const withdrawn = projectFormalBriefStatus({ label: "Base rent", status: "WITHDRAWN", conflict: false });
    const open = projectFormalBriefStatus({ label: "Base rent", status: "PROPOSED", conflict: false });
    const unresolved = projectFormalBriefStatus({ label: "TI allowance", status: "UNRESOLVED", conflict: false });
    const agreed = projectFormalBriefStatus({ label: "Lease term", status: "AGREED", conflict: false });

    assert.equal(rejected.briefStatus, "REJECTED");
    assert.equal(rejected.label, "Rejected");
    assert.equal(rejected.countsAsOpen, false);
    assert.equal(rejected.attention?.label, "Base rent was rejected");
    assert.match(rejected.attention?.description ?? "", /Rejected/);

    assert.equal(withdrawn.briefStatus, "WITHDRAWN");
    assert.equal(withdrawn.label, "Withdrawn");
    assert.equal(withdrawn.countsAsOpen, false);
    assert.equal(withdrawn.attention?.label, "Base rent was withdrawn");

    assert.equal(open.briefStatus, "OPEN");
    assert.equal(open.countsAsOpen, true);
    assert.equal(open.attention?.label, "Base rent remains open");
    assert.equal(unresolved.briefStatus, "OPEN");
    assert.equal(unresolved.countsAsOpen, true);
    assert.equal(unresolved.attention?.label, "TI allowance is unresolved");
    assert.equal(agreed.briefStatus, "AGREED");
    assert.equal(agreed.countsAsOpen, false);
    assert.equal(agreed.attention, null);
  });

  test("a fully rejected formal review is Rejected without counting as open", () => {
    const reviewed = projectFormalBriefStatus({
      label: "Base rent",
      status: "NOT_MENTIONED",
      conflict: false,
      reviewRejected: true,
    });
    assert.equal(reviewed.briefStatus, "REJECTED");
    assert.equal(reviewed.label, "Rejected");
    assert.equal(reviewed.countsAsOpen, false);
    assert.equal(reviewed.attention?.label, "Base rent was rejected");
    assert.match(reviewed.attention?.description ?? "", /Formal review rejected/);
  });

  test("mixed statuses produce openCount 2", () => {
    const terms = [
      projectFormalBriefStatus({ label: "A", status: "PROPOSED", conflict: false }),
      projectFormalBriefStatus({ label: "B", status: "UNRESOLVED", conflict: false }),
      projectFormalBriefStatus({ label: "C", status: "AGREED", conflict: false }),
      projectFormalBriefStatus({ label: "D", status: "REJECTED", conflict: false }),
      projectFormalBriefStatus({ label: "E", status: "WITHDRAWN", conflict: false }),
    ];
    assert.equal(countOpenFormalTerms(terms), 2);
  });

  test("unknown statuses fail closed instead of becoming Open", () => {
    const unknown = projectFormalBriefStatus({ label: "Base rent", status: "MAYBE", conflict: false });
    assert.equal(unknown.briefStatus, "UNKNOWN");
    assert.equal(unknown.label, "Unknown");
    assert.equal(unknown.countsAsOpen, false);
    assert.equal(unknown.attention, null);
  });

  test("conflict keeps conflict copy and still counts an unresolved term as open", () => {
    const conflict = projectFormalBriefStatus({ label: "Base rent", status: "UNRESOLVED", conflict: true });
    assert.equal(conflict.briefStatus, "CONFLICT");
    assert.equal(conflict.label, "Conflict");
    assert.equal(conflict.countsAsOpen, true);
    assert.equal(conflict.attention?.type, "NEGOTIATION_CONFLICT");
  });
});

describe("Deal Brief truncation and comparison wording", () => {
  test("remainder is hidden only above the cap", () => {
    assert.equal(hiddenCount(10, BRIEF_SECTION_CAPS.attention), 4);
    assert.equal(hiddenCount(BRIEF_SECTION_CAPS.attention, BRIEF_SECTION_CAPS.attention), 0);
    assert.equal(hiddenCount(3, BRIEF_SECTION_CAPS.attention), 0);
    assert.equal(remainderLabel("attention", 4), "+ 4 more items need attention");
    assert.equal(remainderLabel("changes", 7), "+ 7 more recent changes");
    assert.equal(remainderLabel("communications", 5), "View 5 more communications");
    assert.equal(remainderLabel("timeline", 2), "+ 2 earlier events");
    assert.equal(remainderLabel("comparisons", 3), "3 additional paper/email comparisons");
  });

  test("DIFFERS uses deterministic wording and comparison remainder follows display order", () => {
    assert.equal(comparisonOutcomeLabel("DIFFERS"), "Paper and communication differ");
    assert.equal(comparisonOutcomeLabel("MATCH"), "Match");
    assert.equal(comparisonOutcomeLabel("NOT_COMPARABLE"), "Not comparable");

    const comparisons = Array.from({ length: 9 }, (_, index) => ({
      id: `comparison-${index}`,
      canonicalType: `TYPE_${index}`,
      label: `Term ${index}`,
      side: "LANDLORD" as const,
      outcome: index === 0 ? "NOT_COMPARABLE" as const : "DIFFERS" as const,
      reason: "EXACT_VALUE_DIFFERENCE" as const,
      timestamp: `2026-09-${String(20 - index).padStart(2, "0")}T00:00:00.000Z`,
      formal: { value: "a", numeric: 1, unit: "USD", observationIds: [], evidenceQuote: null, pageLabel: null, reviewState: null, source: null },
      communication: {
        factId: `fact-${index}`,
        value: "b",
        numeric: 2,
        unit: "USD",
        reviewed: true,
        corrected: false,
        subject: "Rent",
        sender: "Broker",
        evidenceQuote: "b",
        reviewState: "CONFIRMED",
        rawValue: "b",
        source: { kind: "COMMUNICATION_EVIDENCE" as const, id: "m", label: "m", href: "/messages/m" },
      },
    })) satisfies DealEvidenceComparison[];
    const displayed = displayedComparisons(comparisons);
    assert.equal(displayed.length, 8);
    assert.equal(displayed[0]?.id, "comparison-1");
    assert.equal(hiddenCount(displayed.length, BRIEF_SECTION_CAPS.comparisons), 2);
  });
});
