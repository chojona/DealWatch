import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ActionEvidenceReviewError, reviewActionEvidence } from "@/lib/deals/actions/evidenceReview";
import { STRUCTURED_ACTION_KINDS, STRUCTURED_RESPONSIBLE_SIDES } from "@/lib/ai/activity/schema";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sourceMessageId: z.string().min(1),
  activityFactId: z.string().min(1),
  decision: z.enum(["confirm", "reject", "correct"]),
  correction: z.object({
    kind: z.enum(STRUCTURED_ACTION_KINDS).optional(),
    responsibleSide: z.enum(STRUCTURED_RESPONSIBLE_SIDES).optional(),
    discardNormalizedInstant: z.boolean().optional(),
    fulfillsFactId: z.string().nullable().optional(),
  }).strict().optional(),
}).strict();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Review request is invalid" }, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const workspaceId = await messageRequestWorkspaceId(prisma);
    if (!workspaceId) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    const result = await reviewActionEvidence(prisma, {
      dealId: id,
      sourceMessageId: parsed.data.sourceMessageId,
      activityFactId: parsed.data.activityFactId,
      decision: parsed.data.decision,
      correction: parsed.data.correction,
      expectedWorkspaceId: workspaceId,
    });
    return NextResponse.json({ reviewId: result.review.id, correctionId: result.correction?.id ?? null });
  } catch (error) {
    if (error instanceof ActionEvidenceReviewError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Review could not be saved";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
