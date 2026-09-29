import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ReviewActionError } from "@/lib/review/decisions";
import { correctNegotiationEvidence } from "@/lib/review/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  negotiationTermId: z.string().min(1),
  documentPageId: z.string().min(1),
  startOffset: z.number().int(),
  endOffset: z.number().int(),
  evidenceQuote: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = Schema.parse(await request.json());
    const saved = await correctNegotiationEvidence(prisma, { documentId: id, ...body });
    return NextResponse.json({
      correction: {
        id: saved.correction.id,
        documentPageId: saved.correction.documentPageId,
        startOffset: saved.correction.startOffset,
        endOffset: saved.correction.endOffset,
        evidenceQuote: saved.correction.evidenceQuote,
        supersededAt: saved.correction.supersededAt?.toISOString() ?? null,
      },
      original: saved.original,
    });
  } catch (error) {
    if (error instanceof ReviewActionError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Evidence correction is invalid." }, { status: 400 });
    }
    console.error("[evidence correction POST]", error);
    return NextResponse.json({ error: "Evidence correction could not be saved." }, { status: 500 });
  }
}
