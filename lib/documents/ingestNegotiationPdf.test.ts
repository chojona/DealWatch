import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ExtractTermsOutput } from "@/lib/ai/negotiation/schemas";
import { NegotiationExtractionError } from "@/lib/ai/negotiation/extractTerms";
import {
  DocumentUploadRejected,
  ingestNegotiationPdf,
  type NegotiationTermExtractor,
} from "./ingestNegotiationPdf";
import { buildTextPdf } from "./minimalPdf";
import { LocalDocumentStorage } from "./storage";
import { createTestDatabase, createTestDeal } from "./testDb";

const rentQuote = "Base Rent shall be $65.00 per rentable square foot.";
const sharedQuote = "Parking: 10 reserved spaces.";

function extractor(
  calls: string[],
  options?: { fail?: boolean; quote?: string }
): NegotiationTermExtractor {
  return async (input) => {
    calls.push(input.documentText);
    if (options?.fail) {
      throw new NegotiationExtractionError("mock analysis failure");
    }
    const quote = options?.quote ?? rentQuote;
    const terms: ExtractTermsOutput["terms"] = input.documentText.includes(quote)
      ? [
          {
            canonicalType: quote === rentQuote ? "BASE_RENT" : "PARKING",
            normalizedValue: quote === rentQuote ? "$65.00/RSF/year" : "10 spaces",
            normalizedNumeric: quote === rentQuote ? 65 : 10,
            normalizedUnit: quote === rentQuote ? "USD_PER_RSF_YEAR" : "SPACES",
            rawValue: quote,
            status: "PROPOSED",
            confidence: 0.95,
            evidenceQuote: quote,
            sourceLocation: "Page 9",
            ...(quote === rentQuote
              ? {
                  structuredPayload: {
                    termType: "BASE_RENT" as const,
                    rent: { kind: "simple" as const, amountPerRSFYear: 65 },
                  },
                }
              : {}),
          },
        ]
      : [];
    return {
      terms,
      metadata: {
        model: "mock",
        extractedAt: new Date().toISOString(),
        latencyMs: 1,
        extractionConfidence: 0.9,
        validationFailures: 0,
      },
    };
  };
}

async function harness() {
  const db = await createTestDatabase();
  const storageRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-files-"));
  const storage = new LocalDocumentStorage(storageRoot);
  const deal = await createTestDeal(db.prisma);
  return { db, storage, deal };
}

test("successful PDF ingestion creates one round, payload, and page provenance", async () => {
  const { db, storage, deal } = await harness();
  const calls: string[] = [];
  try {
    const pdf = buildTextPdf([
      "200 Clarendon Street\nTenant: Acme Corp",
      rentQuote,
    ]);
    const first = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "../../Landlord Counterproposal.pdf",
      mimeType: "application/pdf",
      side: "LANDLORD",
      documentDate: new Date("2026-05-01"),
      documentType: "COUNTERPROPOSAL",
      storage,
      prisma: db.prisma,
      extractTerms: extractor(calls),
    });
    assert.equal(first.document.ingestionStatus, "COMPLETE");
    assert.equal(first.idempotent, false);
    assert.equal(first.document.termCount, 1);
    assert.equal(first.document.pageCount, 2);
    assert.equal(first.document.originalFilename, "Landlord Counterproposal.pdf");
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? "", /--- PAGE 1 ---/);
    assert.match(calls[0] ?? "", /--- PAGE 2 ---/);
    assert.equal((calls[0] ?? "").includes(rentQuote), true);

    const rounds = await db.prisma.negotiationRound.findMany({
      where: { dealId: deal.id },
      include: { terms: { include: { documentPage: true } } },
    });
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]?.sourceType, "UPLOADED_PDF");
    assert.equal(rounds[0]?.documentId, first.document.id);
    assert.equal(rounds[0]?.terms.length, 1);
    const term = rounds[0]?.terms[0];
    assert.equal(term?.provenanceStatus, "EXACT");
    assert.equal(term?.documentPage?.pageNumber, 2);
    assert.equal(term?.sourceLocation, null);
    assert.equal(term?.evidenceStartOffset, 0);
    assert.equal(
      term?.documentPage?.text.slice(
        term.evidenceStartOffset ?? 0,
        term.evidenceEndOffset ?? 0
      ),
      rentQuote
    );
    assert.equal(
      term?.structuredPayload &&
        typeof term.structuredPayload === "object" &&
        "termType" in term.structuredPayload
        ? term.structuredPayload.termType
        : null,
      "BASE_RENT"
    );

    const second = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "Landlord Counterproposal.pdf",
      mimeType: "application/pdf",
      side: "LANDLORD",
      documentDate: new Date("2026-05-01"),
      documentType: "COUNTERPROPOSAL",
      storage,
      prisma: db.prisma,
      extractTerms: extractor(calls),
    });
    assert.equal(second.idempotent, true);
    assert.equal(second.document.id, first.document.id);
    assert.equal(calls.length, 1);
    assert.equal(await db.prisma.negotiationRound.count(), 1);
    assert.equal(await db.prisma.document.count(), 1);
  } finally {
    await db.cleanup();
  }
});

test("duplicate quotes across pages persist as ambiguous provenance", async () => {
  const { db, storage, deal } = await harness();
  try {
    const result = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: buildTextPdf([sharedQuote, `Restated. ${sharedQuote}`]),
      filename: "loi.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-05-02"),
      documentType: "LOI",
      storage,
      prisma: db.prisma,
      extractTerms: extractor([], { quote: sharedQuote }),
    });
    assert.equal(result.document.ingestionStatus, "COMPLETE");
    const term = await db.prisma.negotiationTerm.findFirst({
      where: { round: { documentId: result.document.id } },
    });
    assert.equal(term?.provenanceStatus, "AMBIGUOUS");
    assert.equal(term?.documentPageId, null);
    assert.equal(term?.evidenceStartOffset, null);
  } finally {
    await db.cleanup();
  }
});

test("a scanned PDF is rejected and a retry does not create a round", async () => {
  const { db, storage, deal } = await harness();
  const calls: string[] = [];
  try {
    const pdf = buildTextPdf(["   "]);
    const first = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "scan.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-05-03"),
      documentType: "OTHER",
      storage,
      prisma: db.prisma,
      extractTerms: extractor(calls),
    });
    assert.equal(first.document.ingestionStatus, "FAILED");
    assert.equal(first.document.failureCode, "SCANNED_OR_EMPTY");
    assert.equal(await db.prisma.negotiationRound.count(), 0);
    const second = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "scan.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-05-03"),
      documentType: "OTHER",
      storage,
      prisma: db.prisma,
      extractTerms: extractor(calls),
    });
    assert.equal(second.idempotent, true);
    assert.equal(second.document.id, first.document.id);
    assert.equal(calls.length, 0);
    assert.equal(await db.prisma.document.count(), 1);
  } finally {
    await db.cleanup();
  }
});

test("failed extraction leaves a retryable document and no round", async () => {
  const { db, storage, deal } = await harness();
  try {
    const pdf = buildTextPdf([rentQuote]);
    const failed = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "broken.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-05-04"),
      documentType: "PROPOSAL",
      storage,
      prisma: db.prisma,
      extractPdf: async () => {
        throw new Error("unreadable");
      },
      extractTerms: extractor([]),
    });
    assert.equal(failed.document.ingestionStatus, "FAILED");
    assert.equal(failed.document.failureCode, "EXTRACTION_FAILED");
    assert.equal(await db.prisma.negotiationRound.count(), 0);
    assert.equal(await db.prisma.documentPage.count(), 0);
    assert.equal(await storage.exists(`${failed.document.id}/${failed.document.filename}`), true);

    const recovered = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "broken.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-05-04"),
      documentType: "PROPOSAL",
      storage,
      prisma: db.prisma,
      extractTerms: extractor([]),
    });
    assert.equal(recovered.document.id, failed.document.id);
    assert.equal(
      recovered.document.ingestionStatus,
      "COMPLETE",
      `${recovered.document.failureCode ?? ""} ${recovered.document.failureReason ?? ""}`
    );
    assert.equal(await db.prisma.negotiationRound.count(), 1);
  } finally {
    await db.cleanup();
  }
});

test("failed analysis leaves extracted pages and a retry creates one round", async () => {
  const { db, storage, deal } = await harness();
  const calls: string[] = [];
  let fail = true;
  try {
    const pdf = buildTextPdf([rentQuote]);
    const extractTerms: NegotiationTermExtractor = async (input) => {
      calls.push(input.documentText);
      if (fail) throw new NegotiationExtractionError("mock analysis failure");
      return extractor([])(input);
    };
    const failed = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "loi.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-05-05"),
      documentType: "LOI",
      storage,
      prisma: db.prisma,
      extractTerms,
    });
    assert.equal(failed.document.ingestionStatus, "FAILED");
    assert.equal(failed.document.failureCode, "ANALYSIS_FAILED");
    assert.equal(await db.prisma.negotiationRound.count(), 0);
    assert.equal(await db.prisma.documentPage.count(), 1);

    fail = false;
    const retried = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "loi.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-05-05"),
      documentType: "LOI",
      storage,
      prisma: db.prisma,
      extractTerms,
    });
    assert.equal(
      retried.document.ingestionStatus,
      "COMPLETE",
      `${retried.document.failureCode ?? ""} ${retried.document.failureReason ?? ""}`
    );
    assert.equal(retried.document.id, failed.document.id);
    assert.equal(await db.prisma.negotiationRound.count(), 1);
    assert.equal(calls.length, 2);
  } finally {
    await db.cleanup();
  }
});

test("non-PDF and oversized uploads do not create documents", async () => {
  const { db, storage, deal } = await harness();
  try {
    await assert.rejects(
      () =>
        ingestNegotiationPdf({
          dealId: deal.id,
          bytes: Buffer.from("hello"),
          filename: "notes.txt",
          mimeType: "text/plain",
          side: "TENANT",
          documentDate: new Date("2026-05-06"),
          documentType: "OTHER",
          storage,
          prisma: db.prisma,
          extractTerms: extractor([]),
        }),
      (error: unknown) =>
        error instanceof DocumentUploadRejected && error.code === "NON_PDF"
    );
    await assert.rejects(
      () =>
        ingestNegotiationPdf({
          dealId: deal.id,
          bytes: buildTextPdf(["Hello"]),
          filename: "big.pdf",
          mimeType: "application/pdf",
          side: "TENANT",
          documentDate: new Date("2026-05-06"),
          documentType: "OTHER",
          storage,
          prisma: db.prisma,
          maxBytes: 32,
          extractTerms: extractor([]),
        }),
      (error: unknown) =>
        error instanceof DocumentUploadRejected && error.code === "OVERSIZED"
    );
    assert.equal(await db.prisma.document.count(), 0);
  } finally {
    await db.cleanup();
  }
});
