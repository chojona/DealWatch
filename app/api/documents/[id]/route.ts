import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toDocumentDto } from "@/lib/documents/dto";
import { analyzeNegotiationDocument, receiveNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { runDocumentGraphExtraction } from "@/lib/documents/runGraphExtraction";
import { NegotiationExtractionConfigurationError } from "@/lib/ai/negotiation/extractTerms";
import { getDocumentStorage } from "@/lib/documents/storage";
import { needsStoredPageExtraction } from "@/lib/documents/readinessCopy";
import { loadDocumentReadiness } from "@/lib/documents/readiness";
import { isE2ETestMode } from "@/lib/e2e/mode";
import { e2eNegotiationExtractor } from "@/lib/e2e/negotiationExtractor";
import { e2eGraphExtractor } from "@/lib/e2e/graphExtractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      negotiationRounds: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { terms: true } } },
      },
    },
  });
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ document: toDocumentDto(document) });
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const existing = await prisma.document.findUnique({
      where: { id },
      select: { id: true, ingestionStatus: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    let readiness = await loadDocumentReadiness(prisma, id);
    if (!readiness) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (needsStoredPageExtraction(readiness, existing.ingestionStatus)) {
      const stored = await prisma.document.findUnique({
        where: { id },
        select: {
          dealId: true,
          originalFilename: true,
          mimeType: true,
          negotiationSide: true,
          documentDate: true,
          documentType: true,
          storageKey: true,
        },
      });
      if (
        !stored?.documentDate ||
        (stored.negotiationSide !== "TENANT" && stored.negotiationSide !== "LANDLORD")
      ) {
        return NextResponse.json(
          { error: "Analysis unavailable", missing: readiness.missing },
          { status: 409 }
        );
      }
      const bytes = await getDocumentStorage().get(stored.storageKey);
      const prepared = await receiveNegotiationPdf({
        dealId: stored.dealId,
        bytes,
        filename: stored.originalFilename,
        mimeType: stored.mimeType,
        side: stored.negotiationSide,
        documentDate: stored.documentDate,
        documentType: stored.documentType,
        storage: getDocumentStorage(),
        prisma,
        mode: "extract",
      });
      if (prepared.document.ingestionStatus !== "READY") {
        return NextResponse.json(prepared, { status: 422 });
      }
      readiness = await loadDocumentReadiness(prisma, id);
      if (!readiness) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
    }
    if (!readiness.analysisReady && existing.ingestionStatus !== "COMPLETE") {
      return NextResponse.json(
        { error: "Analysis unavailable", missing: readiness.missing },
        { status: 409 }
      );
    }

    let negotiationConfigError: unknown = null;
    let result: Awaited<ReturnType<typeof analyzeNegotiationDocument>> | null =
      null;
    try {
      result = await analyzeNegotiationDocument({
        documentId: id,
        prisma,
        ...(isE2ETestMode() ? { extractTerms: e2eNegotiationExtractor } : {}),
      });
    } catch (error) {
      if (error instanceof NegotiationExtractionConfigurationError) {
        negotiationConfigError = error;
      } else {
        throw error;
      }
    }

    await runDocumentGraphExtraction({
      prisma,
      documentId: id,
      ...(isE2ETestMode() ? { extractor: e2eGraphExtractor } : {}),
    });
    if (negotiationConfigError) throw negotiationConfigError;
    if (!result) {
      return NextResponse.json({ error: "Document analysis failed" }, { status: 500 });
    }

    const reloaded = await prisma.document.findUnique({
      where: { id },
      include: {
        negotiationRounds: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { terms: true } } },
        },
      },
    });
    if (reloaded) result = { ...result, document: toDocumentDto(reloaded) };

    const status =
      result.idempotent
        ? 200
        : result.document.ingestionStatus === "FAILED"
          ? 422
          : 201;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (error instanceof NegotiationExtractionConfigurationError) {
      return NextResponse.json(
        { error: "Negotiation extraction is not configured" },
        { status: 503 }
      );
    }
    console.error("[document analyze POST]", error);
    return NextResponse.json(
      { error: "Document analysis failed" },
      { status: 500 }
    );
  }
}
