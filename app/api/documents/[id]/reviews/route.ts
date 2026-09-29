import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { recordReviewDecision, ReviewActionError } from "@/lib/review/decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.discriminatedUnion("kind", [
  z.object({
    action: z.enum(["ACKNOWLEDGE", "NEEDS_FOLLOW_UP", "CLEAR"]),
    note: z.string().nullable().optional(),
    kind: z.literal("NEGOTIATION_TERM"),
    negotiationTermId: z.string().min(1),
  }),
  z.object({
    action: z.enum(["ACKNOWLEDGE", "NEEDS_FOLLOW_UP", "CLEAR"]),
    note: z.string().nullable().optional(),
    kind: z.literal("NEGOTIATION_CONFLICT"),
    canonicalType: z.string().min(1),
  }),
  z.object({
    action: z.enum(["ACKNOWLEDGE", "NEEDS_FOLLOW_UP", "CLEAR"]),
    note: z.string().nullable().optional(),
    kind: z.literal("EVIDENCE"),
    evidenceKind: z.enum(["TERM", "ENTITY", "RELATIONSHIP"]),
    id: z.string().min(1),
  }),
]);

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = Schema.parse(await request.json());
    const target =
      body.kind === "NEGOTIATION_TERM"
        ? { kind: "NEGOTIATION_TERM" as const, negotiationTermId: body.negotiationTermId }
        : body.kind === "NEGOTIATION_CONFLICT"
          ? { kind: "NEGOTIATION_CONFLICT" as const, canonicalType: body.canonicalType }
          : { kind: "EVIDENCE" as const, evidenceKind: body.evidenceKind, id: body.id };
    const decision = await recordReviewDecision(prisma, {
      documentId: id,
      action: body.action,
      target,
      note: body.note,
    });
    return NextResponse.json({
      decision: {
        id: decision.id,
        reviewState: decision.reviewState,
        note: decision.note,
        reviewedAt: decision.reviewedAt.toISOString(),
        actor: decision.actor,
        reviewerUserId: decision.reviewerUserId,
      },
    });
  } catch (error) {
    if (error instanceof ReviewActionError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Review action is invalid." }, { status: 400 });
    }
    console.error("[document review POST]", error);
    return NextResponse.json({ error: "Review could not be saved." }, { status: 500 });
  }
}
