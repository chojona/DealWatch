import assert from "node:assert/strict";
import test from "node:test";
import { GraphInvariantError } from "./errors";
import {
  assertParticipationActor,
  assertProvenanceShape,
  assertRelationshipShape,
  assertWorkspaceMatch,
  evidenceDeletionRefused,
  matchesAsOf,
  promotionPermitted,
} from "./invariants";

test("workspace mismatch is rejected", () => {
  assert.throws(
    () => assertWorkspaceMatch("a", "b", "Company"),
    GraphInvariantError
  );
  assert.doesNotThrow(() => assertWorkspaceMatch("a", "a", "Company"));
});

test("participation requires exactly one actor", () => {
  assert.throws(
    () =>
      assertParticipationActor({
        role: "TENANT",
        personId: "p",
        companyId: "c",
      }),
    /exactly one/
  );
  assert.throws(
    () => assertParticipationActor({ role: "TENANT_BROKER", companyId: "c" }),
    /requires a person/
  );
  assert.throws(
    () => assertParticipationActor({ role: "TENANT", personId: "p" }),
    /requires a company/
  );
  assert.doesNotThrow(() =>
    assertParticipationActor({
      role: "TENANT_BROKER",
      personId: "p",
      representsCompanyId: "acme",
    })
  );
});

test("a company cannot represent itself", () => {
  assert.throws(
    () =>
      assertParticipationActor({
        role: "TENANT_BROKERAGE",
        companyId: "acme",
        representsCompanyId: "acme",
      }),
    /represent itself/
  );
});

test("WORKS_AT rejects a company subject", () => {
  assert.throws(
    () =>
      assertRelationshipShape({
        predicate: "WORKS_AT",
        subjectType: "COMPANY",
        objectType: "COMPANY",
      }),
    /person subject/
  );
});

test("EXACT provenance requires a page and offsets", () => {
  assert.throws(
    () =>
      assertProvenanceShape({
        sourceKind: "DOCUMENT_PAGE",
        dealId: "d",
        documentId: "doc",
        provenanceStatus: "EXACT",
        evidenceQuote: "rent",
      }),
    /documentPageId/
  );
  assert.doesNotThrow(() =>
    assertProvenanceShape({
      sourceKind: "DOCUMENT_PAGE",
      dealId: "d",
      documentId: "doc",
      documentPageId: "page",
      provenanceStatus: "EXACT",
      evidenceStartOffset: 0,
      evidenceEndOffset: 4,
      evidenceQuote: "rent",
    })
  );
});

test("unknown relationship bounds match every as-of date", () => {
  const row = {
    status: "ASSERTED" as const,
    validFrom: null,
    validTo: null,
  };
  assert.equal(matchesAsOf(row, new Date("2020-01-01")), true);
  assert.equal(matchesAsOf(row, new Date("2030-01-01")), true);
  assert.equal(
    matchesAsOf(
      {
        status: "ASSERTED",
        validFrom: new Date("2026-01-01"),
        validTo: new Date("2026-12-31"),
      },
      new Date("2025-01-01")
    ),
    false
  );
});

test("document deletion is refused only when observations reference it", () => {
  assert.equal(evidenceDeletionRefused(0), false);
  assert.equal(evidenceDeletionRefused(1), true);
});

test("UNLOCATED evidence is not auto-promoted", () => {
  assert.equal(
    promotionPermitted({
      disposition: "ACCEPTED",
      provenanceStatus: "UNLOCATED",
      dispositionActor: "SYSTEM",
    }),
    false
  );
  assert.equal(
    promotionPermitted({
      disposition: "ACCEPTED",
      provenanceStatus: "UNLOCATED",
      dispositionActor: "USER",
    }),
    true
  );
  assert.equal(
    promotionPermitted({
      disposition: "PENDING",
      provenanceStatus: "EXACT",
    }),
    false
  );
});
