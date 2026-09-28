import assert from "node:assert/strict";
import test from "node:test";
import { validateExtractedTerms } from "@/lib/ai/negotiation/validateTerms";
import {
  attachEvidenceProvenance,
  locateEvidence,
} from "./locateEvidence";
import { toPageMarkedText } from "./pageText";

const pages = [
  { id: "page-1", pageNumber: 1, text: "200 Clarendon Street" },
  {
    id: "page-2",
    pageNumber: 2,
    text: "Base Rent shall be $65.00 per rentable square foot.",
  },
];

test("exact evidence quote maps to the correct page", () => {
  const located = locateEvidence({
    evidenceQuote: "Base Rent shall be $65.00 per rentable square foot.",
    pages,
  });
  assert.equal(located.status, "EXACT");
  if (located.status !== "EXACT") return;
  assert.equal(located.pageNumber, 2);
  assert.equal(located.pageId, "page-2");
  assert.equal(located.startOffset, 0);
  assert.equal(
    located.endOffset - located.startOffset,
    "Base Rent shall be $65.00 per rentable square foot.".length
  );
  assert.equal(
    pages[1]?.text.slice(located.startOffset, located.endOffset),
    "Base Rent shall be $65.00 per rentable square foot."
  );
});

test("duplicate quote across pages is ambiguous", () => {
  const located = locateEvidence({
    evidenceQuote: "Parking: 10 reserved spaces.",
    pages: [
      { id: "a", pageNumber: 1, text: "Parking: 10 reserved spaces." },
      { id: "b", pageNumber: 2, text: "See above. Parking: 10 reserved spaces." },
    ],
  });
  assert.equal(located.status, "AMBIGUOUS");
  if (located.status !== "AMBIGUOUS") return;
  assert.deepEqual(
    located.matches.map((match) => match.pageNumber),
    [1, 2]
  );
});

test("a repeated quote on one page stays on that page", () => {
  const located = locateEvidence({
    evidenceQuote: "Base Rent",
    pages: [{ id: "only", pageNumber: 3, text: "Base Rent and Base Rent" }],
  });
  assert.equal(located.status, "EXACT");
  if (located.status !== "EXACT") return;
  assert.equal(located.pageNumber, 3);
  assert.equal(located.startOffset, 0);
});

test("page markers are not treated as provenance", () => {
  const marked = toPageMarkedText(pages);
  const located = locateEvidence({
    evidenceQuote: "--- PAGE 1 ---",
    pages,
  });
  assert.equal(marked.includes("--- PAGE 1 ---"), true);
  assert.equal(located.status, "UNLOCATED");
});

test("exact evidence still passes the frozen validator and then locates a page", () => {
  const marked = toPageMarkedText(pages);
  const quote = "Base Rent shall be $65.00 per rentable square foot.";
  const validated = validateExtractedTerms({
    documentText: marked,
    model: "mock",
    extractedAt: new Date("2026-09-28T00:00:00.000Z"),
    latencyMs: 1,
    extraction: {
      overallConfidence: 0.9,
      terms: [
        {
          canonicalType: "BASE_RENT",
          normalizedValue: "$65.00/RSF/year",
          normalizedNumeric: 65,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: "$65.00 per rentable square foot",
          status: "PROPOSED",
          confidence: 0.95,
          evidenceQuote: quote,
          sourceLocation: "Page 9",
          structuredPayload: {
            termType: "BASE_RENT",
            rent: { kind: "simple", amountPerRSFYear: 65 },
          },
        },
      ],
    },
  });
  assert.equal(validated.terms.length, 1);
  const attached = attachEvidenceProvenance(validated.terms[0]!, pages);
  assert.equal(attached.provenance.provenanceStatus, "EXACT");
  assert.equal(attached.provenance.documentPageId, "page-2");
  assert.equal(attached.sourceLocation, undefined);
});
