import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  normalizePropertyAddress,
  normalizeSurfaceForm,
} from "./normalize";

test("normalization is deterministic", () => {
  const samples = [
    "  Sarah   Chen ",
    "CBRE, Inc.",
    "JLL Boston",
    "200 Clarendon Street",
  ];
  for (const sample of samples) {
    assert.equal(normalizeSurfaceForm(sample), normalizeSurfaceForm(sample));
    assert.equal(normalizePersonName(sample), normalizePersonName(sample));
    assert.equal(normalizeCompanyName(sample), normalizeCompanyName(sample));
  }
  assert.equal(normalizeEmail("  S.Chen@JLLBoston.com "), normalizeEmail("s.chen@jllboston.com"));
  assert.equal(normalizePhone("(617) 555-0100"), normalizePhone("6175550100"));
  assert.equal(normalizeDomain("HTTPS://www.CBRE.com/about"), "cbre.com");
});

test("normalization does not perform resolution", () => {
  assert.notEqual(normalizeCompanyName("CBRE"), normalizeCompanyName("CBRE Group"));
  assert.notEqual(normalizeCompanyName("JLL Boston"), normalizeCompanyName("JLL"));
  assert.notEqual(normalizeCompanyName("CBRE"), normalizeCompanyName("CBRE, Inc."));
  assert.equal(normalizeCompanyName("CBRE, Inc."), "cbre inc");
  assert.notEqual(
    normalizePropertyAddress({ addressLine1: "200 Clarendon Street" }),
    normalizePropertyAddress({ addressLine1: "200 Clarendon St" })
  );
  assert.notEqual(normalizePersonName("Sarah Chen"), normalizePersonName("Sara Chen"));
});

test("phone normalization keeps a leading plus and does not invent a country code", () => {
  assert.equal(normalizePhone("+1 (617) 555-0100"), "+16175550100");
  assert.equal(normalizePhone("617.555.0100"), "6175550100");
});
