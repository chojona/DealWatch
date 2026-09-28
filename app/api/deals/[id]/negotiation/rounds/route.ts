import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  extractTerms,
  NegotiationExtractionConfigurationError,
  NegotiationExtractionInputError,
} from "@/lib/ai/negotiation/extractTerms";
import {
  ingestDocument,
  NegotiationDocumentInputSchema,
} from "@/lib/negotiation/ingestDocument";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: dealId } = await context.params;
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { id: true },
    });
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const parsed = NegotiationDocumentInputSchema.parse(await request.json());
    const document = ingestDocument(parsed);
    const latest = await prisma.negotiationRound.findFirst({
      where: { dealId, side: document.side },
      orderBy: { roundNumber: "desc" },
      select: { roundNumber: true },
    });
    const roundNumber = (latest?.roundNumber ?? 0) + 1;
    const extraction = await extractTerms({
      documentText: document.documentText,
      documentName: document.documentName,
      documentDate: document.documentDate,
      side: document.side,
      roundNumber,
    });

    const round = await prisma.negotiationRound.create({
      data: {
        dealId,
        side: document.side,
        roundNumber,
        documentName: document.documentName,
        documentText: document.documentText,
        documentDate: document.documentDate,
        sourceType: document.sourceType,
        terms: {
          create: extraction.terms.map((term) => ({
            canonicalType: term.canonicalType,
            normalizedValue: term.normalizedValue ?? null,
            normalizedNumeric: term.normalizedNumeric ?? null,
            normalizedUnit: term.normalizedUnit ?? null,
            rawValue: term.rawValue,
            status: term.status,
            side: document.side,
            roundNumber,
            confidence: term.confidence,
            evidenceQuote: term.evidenceQuote,
            sourceLocation: term.sourceLocation ?? null,
          })),
        },
      },
      include: { terms: true },
    });

    return NextResponse.json(
      { round, extractionMetadata: extraction.metadata },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid negotiation document", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof NegotiationExtractionInputError) {
      return NextResponse.json(
        { error: "Invalid negotiation document", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof NegotiationExtractionConfigurationError) {
      return NextResponse.json(
        { error: "Negotiation extraction is not configured" },
        { status: 503 }
      );
    }
    console.error("[negotiation round POST]", error);
    return NextResponse.json(
      { error: "Negotiation document analysis failed" },
      { status: 500 }
    );
  }
}
