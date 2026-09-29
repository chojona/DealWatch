import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toDocumentDto } from "@/lib/documents/dto";
import { analyzeNegotiationDocument } from "@/lib/documents/ingestNegotiationPdf";
import { runDocumentGraphExtraction } from "@/lib/documents/runGraphExtraction";
import { NegotiationExtractionConfigurationError } from "@/lib/ai/negotiation/extractTerms";
import { GraphInvariantError } from "@/lib/entities/errors";
import { deleteDocumentPreservingEvidence } from "@/lib/entities/service";
import { getDocumentStorage } from "@/lib/documents/storage";
import { loadDocumentReadiness } from "@/lib/documents/readiness";

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
    const readiness = await loadDocumentReadiness(prisma, id);
    if (!readiness) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
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
      });
    } catch (error) {
      if (error instanceof NegotiationExtractionConfigurationError) {
        negotiationConfigError = error;
      } else {
        throw error;
      }
    }

    await runDocumentGraphExtraction({ prisma, documentId: id });
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

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const existing = await prisma.document.findUnique({
    where: { id },
    select: { id: true, storageKey: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  try {
    await deleteDocumentPreservingEvidence(prisma, id);
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  await getDocumentStorage().delete(existing.storageKey);
  return NextResponse.json({ deleted: true });
}
