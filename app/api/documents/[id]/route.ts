import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toDocumentDto } from "@/lib/documents/dto";
import { analyzeNegotiationDocument } from "@/lib/documents/ingestNegotiationPdf";
import { NegotiationExtractionConfigurationError } from "@/lib/ai/negotiation/extractTerms";

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
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const result = await analyzeNegotiationDocument({
      documentId: id,
      prisma,
    });
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
