import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { leaveEntityUnresolved, reopenEntityClosure } from "@/lib/review/closure";
import { ReviewActionError } from "@/lib/review/decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  observationId: z.string().min(1),
  action: z.enum(["LEAVE_UNRESOLVED", "REOPEN"]),
  note: z.string().nullable().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = Schema.parse(await request.json());
    const decision =
      body.action === "LEAVE_UNRESOLVED"
        ? await leaveEntityUnresolved(prisma, {
            documentId: id,
            observationId: body.observationId,
            note: body.note,
          })
        : await reopenEntityClosure(prisma, { documentId: id, observationId: body.observationId });
    return NextResponse.json({
      decision: decision
        ? {
            id: decision.id,
            reviewState: decision.reviewState,
            note: decision.note,
            reviewedAt: decision.reviewedAt.toISOString(),
            actor: decision.actor,
            reviewerUserId: decision.reviewerUserId,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof ReviewActionError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Entity review action is invalid." }, { status: 400 });
    }
    console.error("[entity closure POST]", error);
    return NextResponse.json({ error: "Entity review could not be saved." }, { status: 500 });
  }
}
