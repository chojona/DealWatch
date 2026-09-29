import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ReviewActionError } from "@/lib/review/decisions";
import { reviewFormalTerm } from "@/lib/review/formalTerm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("ACCEPT"),
    negotiationTermId: z.string().min(1),
    note: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("REJECT"),
    negotiationTermId: z.string().min(1),
    note: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("CORRECT"),
    negotiationTermId: z.string().min(1),
    note: z.string().nullable().optional(),
    rawValue: z.string().nullable().optional(),
    normalizedValue: z.string().nullable().optional(),
    normalizedNumeric: z.number().finite().nullable().optional(),
    normalizedUnit: z.string().nullable().optional(),
    structuredPayload: z.unknown().optional(),
    amountPerRSFYear: z.number().finite().nullable().optional(),
  }),
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = Schema.parse(await request.json());
    const saved = await reviewFormalTerm(prisma, { documentId: id, ...body });
    return NextResponse.json({
      unchanged: saved.unchanged,
      review: {
        id: saved.review.id,
        negotiationTermId: saved.review.negotiationTermId,
        state: saved.review.state,
        normalizedValue: saved.review.normalizedValue,
        normalizedNumeric: saved.review.normalizedNumeric,
        normalizedUnit: saved.review.normalizedUnit,
        rawValue: saved.review.rawValue,
        structuredPayload: saved.review.structuredPayload,
        note: saved.review.note,
        reviewedAt: saved.review.reviewedAt.toISOString(),
        actor: saved.review.actor,
        reviewerUserId: saved.review.reviewerUserId,
      },
      original: saved.original,
    });
  } catch (error) {
    if (error instanceof ReviewActionError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Formal review is invalid." }, { status: 400 });
    }
    console.error("[formal review POST]", error);
    return NextResponse.json({ error: "Formal review could not be saved." }, { status: 500 });
  }
}
