import assert from "node:assert/strict";
import test from "node:test";
import { validatePdfUpload } from "./validateUpload";
import { buildTextPdf } from "./minimalPdf";

test("non-PDF bytes are rejected", () => {
  const result = validatePdfUpload({
    bytes: Buffer.from("not a pdf"),
    mimeType: "application/pdf",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "NON_PDF");
});

test("a non-PDF mime type is rejected even with a PDF header", () => {
  const result = validatePdfUpload({
    bytes: buildTextPdf(["Hello"]),
    mimeType: "text/plain",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "NON_PDF");
});

test("oversized files are rejected", () => {
  const result = validatePdfUpload({
    bytes: buildTextPdf(["Hello"]),
    mimeType: "application/pdf",
    maxBytes: 32,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "OVERSIZED");
});
