import assert from "node:assert/strict";
import test from "node:test";
import { presentTermSource } from "./presentSource";

test("legacy seeded deals still render without document provenance", () => {
  const source = presentTermSource({
    documentName: "Tenant LOI",
    evidenceQuote:
      "Base Rent: $61.00 per rentable square foot per year, triple net, with 2.5% annual increases.",
    sourceLocation: "Base Rent",
    provenanceStatus: null,
    pageNumber: null,
    originalFilename: null,
    documentId: null,
  });
  assert.equal(source.filename, "Tenant LOI");
  assert.equal(source.pageLabel, null);
  assert.equal(source.pageNumber, null);
  assert.equal(source.documentId, null);
  assert.equal(source.sectionLabel, "Base Rent");
  assert.match(source.evidenceQuote, /\$61\.00/);
});

test("an exact PDF match shows the file name and page", () => {
  const source = presentTermSource({
    documentName: "round",
    evidenceQuote: "Base Rent shall be $65.00 per rentable square foot.",
    sourceLocation: "Base Rent",
    provenanceStatus: "EXACT",
    pageNumber: 3,
    originalFilename: "Landlord Counterproposal.pdf",
    documentId: "doc_1",
  });
  assert.equal(source.filename, "Landlord Counterproposal.pdf");
  assert.equal(source.pageLabel, "Page 3");
  assert.equal(source.pageNumber, 3);
  assert.equal(source.documentId, "doc_1");
});

test("ambiguous provenance does not select a page", () => {
  const source = presentTermSource({
    documentName: "round",
    evidenceQuote: "Parking: 10 reserved spaces.",
    sourceLocation: null,
    provenanceStatus: "AMBIGUOUS",
    pageNumber: 1,
    originalFilename: "loi.pdf",
    documentId: "doc_1",
  });
  assert.equal(source.pageLabel, "Page ambiguous");
  assert.equal(source.pageNumber, null);
});
