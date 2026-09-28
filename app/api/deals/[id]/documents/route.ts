import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { toDocumentDto } from "@/lib/documents/dto";
import {
  DocumentUploadRejected,
  ingestNegotiationPdf,
} from "@/lib/documents/ingestNegotiationPdf";
import { getDocumentStorage } from "@/lib/documents/storage";
import { NegotiationExtractionConfigurationError } from "@/lib/ai/negotiation/extractTerms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MetadataSchema = z.object({
  side: z.enum(["TENANT", "LANDLORD"]),
  documentDate: z.string().refine((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime());
  }, "Document date must be valid"),
  documentType: z.enum([
    "LOI",
    "PROPOSAL",
    "COUNTERPROPOSAL",
    "TERM_SHEET",
    "AMENDMENT",
    "RENEWAL_PROPOSAL",
    "OTHER",
  ]),
  phase: z.enum(["extract", "full"]).optional(),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: dealId } = await context.params;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const documents = await prisma.document.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    include: {
      negotiationRounds: {
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { terms: true } } },
      },
    },
  });

  return NextResponse.json({
    documents: documents.map((document) => toDocumentDto(document)),
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: dealId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    const parsed = MetadataSchema.parse({
      side: form.get("side"),
      documentDate: form.get("documentDate"),
      documentType: form.get("documentType"),
      phase: form.get("phase") || undefined,
    });
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required" }, { status: 400 });
    }

    const result = await ingestNegotiationPdf({
      dealId,
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mimeType: file.type,
      side: parsed.side,
      documentDate: new Date(parsed.documentDate),
      documentType: parsed.documentType,
      storage: getDocumentStorage(),
      prisma,
      mode: parsed.phase ?? "full",
    });

    const status =
      result.idempotent
        ? 200
        : result.document.ingestionStatus === "FAILED"
          ? 422
          : 201;
    return NextResponse.json(result, { status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid document metadata", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof DocumentUploadRejected) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof NegotiationExtractionConfigurationError) {
      return NextResponse.json(
        { error: "Negotiation extraction is not configured" },
        { status: 503 }
      );
    }
    console.error("[document upload POST]", error);
    return NextResponse.json(
      { error: "Document ingestion failed" },
      { status: 500 }
    );
  }
}
