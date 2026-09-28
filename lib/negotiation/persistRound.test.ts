import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractTermsOutput } from "@/lib/ai/negotiation/schemas";
import { ingestDocument } from "./ingestDocument";
import {
  persistExtractedNegotiationRound,
  writeNegotiationRound,
} from "./persistRound";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";

const quote = "Base Rent: $61.00 per rentable square foot per year.";

function term(evidenceQuote = quote): ExtractTermsOutput["terms"][number] {
  return {
    canonicalType: "BASE_RENT",
    normalizedValue: "$61.00/RSF/year",
    normalizedNumeric: 61,
    normalizedUnit: "USD_PER_RSF_YEAR",
    rawValue: "$61.00 per rentable square foot per year",
    status: "PROPOSED",
    confidence: 0.99,
    evidenceQuote,
    sourceLocation: "Base Rent",
    structuredPayload: {
      termType: "BASE_RENT",
      rent: { kind: "simple", amountPerRSFYear: 61 },
    },
  };
}

test("pasted-text ingestion still creates one round and keeps structured payloads", async () => {
  const db = await createTestDatabase();
  try {
    const deal = await createTestDeal(db.prisma);
    const parsed = ingestDocument({
      sourceType: "PASTED_TEXT",
      documentName: "Tenant LOI",
      documentText: quote,
      documentDate: "2026-03-01",
      side: "TENANT",
    });
    const round = await persistExtractedNegotiationRound(db.prisma, {
      dealId: deal.id,
      side: parsed.side,
      documentName: parsed.documentName,
      documentText: parsed.documentText,
      documentDate: parsed.documentDate,
      sourceType: parsed.sourceType,
      terms: [term(), { ...term("Lease Term: Ten (10) years."), canonicalType: "LEASE_TERM", normalizedValue: "120 months", normalizedNumeric: 120, normalizedUnit: "MONTHS", rawValue: "Ten (10) years", structuredPayload: undefined }],
    });
    assert.equal(round.sourceType, "PASTED_TEXT");
    assert.equal(round.documentId, null);
    assert.equal(round.terms.length, 2);
    const saved = await db.prisma.negotiationTerm.findFirst({
      where: { roundId: round.id, canonicalType: "BASE_RENT" },
    });
    assert.equal(saved?.structuredPayload && typeof saved.structuredPayload === "object" && "termType" in saved.structuredPayload
      ? saved.structuredPayload.termType
      : null, "BASE_RENT");
    assert.equal(await db.prisma.negotiationRound.count(), 1);
  } finally {
    await db.cleanup();
  }
});

test("terms are persisted atomically with their round", async () => {
  const db = await createTestDatabase();
  try {
    const deal = await createTestDeal(db.prisma);
    await assert.rejects(
      db.prisma.$transaction(async (tx) => {
        await writeNegotiationRound(tx, {
          dealId: deal.id,
          side: "LANDLORD",
          documentName: "Counter",
          documentText: quote,
          documentDate: new Date("2026-04-01"),
          sourceType: "PASTED_TEXT",
          terms: [term(), term("Lease Term: Ten (10) years.")],
        });
        throw new Error("fail before commit");
      })
    );
    assert.equal(await db.prisma.negotiationRound.count(), 0);
    assert.equal(await db.prisma.negotiationTerm.count(), 0);

    const saved = await persistExtractedNegotiationRound(db.prisma, {
      dealId: deal.id,
      side: "LANDLORD",
      documentName: "Counter",
      documentText: quote,
      documentDate: new Date("2026-04-01"),
      sourceType: "PASTED_TEXT",
      terms: [term(), term("Lease Term: Ten (10) years.")],
    });
    assert.equal(saved.terms.length, 2);
    assert.equal(await db.prisma.negotiationTerm.count({ where: { roundId: saved.id } }), 2);
  } finally {
    await db.cleanup();
  }
});
