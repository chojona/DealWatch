/**
 * One live PDF ingestion smoke test.
 * Uses the existing OpenAI negotiation extractor and a temporary database.
 * Does not change prompts, fixtures, or model selection.
 *
 *   node --env-file=.env --import tsx scripts/smoke-document-ingestion.ts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createTermExtractor,
  extractNegotiationWithOpenAIOnce,
} from "@/lib/ai/negotiation/extractTerms";
import { ingestNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log("SKIP smoke: OPENAI_API_KEY is not set");
    return;
  }

  const db = await createTestDatabase();
  const storage = new LocalDocumentStorage(
    mkdtempSync(path.join(tmpdir(), "dealwatch-smoke-"))
  );
  try {
    const deal = await createTestDeal(db.prisma);
    const pdf = buildTextPdf([
      [
        "200 Clarendon Street",
        "Tenant: Acme Corp",
        "Base Rent:",
        "Years 1-2: $65.00/RSF/year",
        "Years 3-5: $68.00/RSF/year",
        "Tenant Improvement Allowance:",
        "$110.00/RSF",
        "Renewal:",
        "Two five-year options at Fair Market Rent.",
      ].join("\n"),
    ]);

    const result = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: pdf,
      filename: "200-clarendon-loi.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-28"),
      documentType: "LOI",
      storage,
      prisma: db.prisma,
      extractTerms: createTermExtractor(extractNegotiationWithOpenAIOnce),
    });

    const round = await db.prisma.negotiationRound.findFirst({
      where: { documentId: result.document.id },
      include: { terms: { include: { documentPage: true } } },
    });
    const summary = {
      status: result.document.ingestionStatus,
      failure: result.document.failureReason,
      pageCount: result.document.pageCount,
      roundId: round?.id ?? null,
      termCount: round?.terms.length ?? 0,
      terms: round?.terms.map((term) => ({
        type: term.canonicalType,
        value: term.normalizedValue,
        provenance: term.provenanceStatus,
        page: term.documentPage?.pageNumber ?? null,
        payload: term.structuredPayload ? true : false,
        quote: term.evidenceQuote.slice(0, 80),
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (result.document.ingestionStatus !== "COMPLETE" || !round) {
      process.exitCode = 1;
    }
  } finally {
    await db.cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
