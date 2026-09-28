import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfDocument } from "./extractPdf";
import { buildTextPdf } from "./minimalPdf";

test("valid text PDF extraction keeps embedded text", async () => {
  const pdf = buildTextPdf([
    "Base Rent shall be $65.00 per rentable square foot.",
  ]);
  const extracted = await extractPdfDocument(pdf);
  assert.equal(extracted.pageCount, 1);
  assert.equal(
    extracted.pages[0]?.text,
    "Base Rent shall be $65.00 per rentable square foot."
  );
  assert.match(extracted.fullText, /\$65\.00/);
});

test("multiple pages preserve page boundaries", async () => {
  const pdf = buildTextPdf([
    "Page one only",
    "Tenant Improvement Allowance: $110.00/RSF",
  ]);
  const extracted = await extractPdfDocument(pdf);
  assert.equal(extracted.pageCount, 2);
  assert.equal(extracted.pages[0]?.pageNumber, 1);
  assert.equal(extracted.pages[1]?.pageNumber, 2);
  assert.equal(extracted.pages[0]?.text, "Page one only");
  assert.equal(
    extracted.pages[1]?.text,
    "Tenant Improvement Allowance: $110.00/RSF"
  );
  assert.equal(extracted.pages[0]?.text.includes("110.00"), false);
});

test("a PDF with no embedded text extracts as empty pages", async () => {
  const pdf = buildTextPdf(["   "]);
  const extracted = await extractPdfDocument(pdf);
  assert.equal(extracted.pageCount, 1);
  assert.equal(extracted.pages[0]?.text, "");
});
