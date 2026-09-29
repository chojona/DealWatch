import { Prisma, type ActivityFactReviewState, type PrismaClient } from "@prisma/client";
import { ActivityStructuredPayloadSchema } from "@/lib/ai/activity/schema";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
import { factsFromLatestRun } from "./latestRun";
import { latestMessageRun } from "./state";

async function scopedMessage(db: PrismaClient, sourceMessageId: string, expectedWorkspaceId?: string) {
  const message = await db.sourceMessage.findUnique({
    where: { id: sourceMessageId },
    include: {
      deal: { select: { workspaceId: true } },
      extractionRuns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      facts: { include: { activityExtractionRun: { select: { id: true, status: true, completedAt: true, createdAt: true } } } },
    },
  });
  if (!message || message.workspaceId !== message.deal.workspaceId || (expectedWorkspaceId && expectedWorkspaceId !== message.workspaceId)) throw new Error("Message not found");
  return message;
}

export async function decideMessageReview(
  db: PrismaClient,
  input: { sourceMessageId: string; decision: "ACKNOWLEDGED" | "NEEDS_FOLLOW_UP"; note?: string | null; expectedWorkspaceId?: string }
) {
  const message = await scopedMessage(db, input.sourceMessageId, input.expectedWorkspaceId);
  const run = latestMessageRun(message.extractionRuns);
  const facts = factsFromLatestRun(message.facts);
  if (input.decision === "ACKNOWLEDGED" && run?.status !== "SUCCEEDED") throw new Error("A message can be acknowledged only after successful analysis");
  const reconciliation = await getDealReconciliation(db, message.dealId);
  const links = reconciliation?.links.filter((item) => item.activityEventId === `source-message:${message.id}`) ?? [];
  return db.$transaction(async (tx) => {
    const decision = await tx.messageReviewDecision.create({
      data: {
        workspaceId: message.workspaceId,
        sourceMessageId: message.id,
        decision: input.decision,
        actor: "MANUAL_REVIEW",
        activityExtractionRunId: run?.id ?? null,
        presentedFactIds: facts.map((fact) => fact.id),
        reconciliationSnapshot: links as unknown as Prisma.InputJsonValue,
        note: input.note?.trim() || null,
      },
    });
    await tx.messageReviewEvent.create({
      data: { workspaceId: message.workspaceId, sourceMessageId: message.id, eventType: input.decision, actor: "MANUAL_REVIEW", detail: { decisionId: decision.id, note: decision.note } },
    });
    return decision;
  });
}

export async function reviewActivityFact(
  db: PrismaClient,
  input: { sourceMessageId: string; activityFactId: string; state: ActivityFactReviewState; correctedPayload?: unknown; note?: string | null; expectedWorkspaceId?: string }
) {
  const message = await scopedMessage(db, input.sourceMessageId, input.expectedWorkspaceId);
  const fact = message.facts.find((item) => item.id === input.activityFactId);
  if (!fact) throw new Error("Activity fact not found");
  let correction: Prisma.InputJsonValue | null = null;
  if (input.correctedPayload !== undefined) {
    if (input.state !== "INCORRECT") throw new Error("Only an incorrect fact can have a correction");
    const parsed = ActivityStructuredPayloadSchema.safeParse(input.correctedPayload);
    if (!parsed.success) throw new Error("Corrected structured value is invalid");
    correction = parsed.data as Prisma.InputJsonValue;
  }
  const reconciliation = await getDealReconciliation(db, message.dealId);
  const link = reconciliation?.links.find((item) => item.activityEventId === `source-message:${message.id}` && item.canonicalType === fact.canonicalType && item.eventSide === fact.side) ?? null;
  return db.$transaction(async (tx) => {
    const review = await tx.activityFactReview.create({
      data: {
        workspaceId: message.workspaceId,
        sourceMessageId: message.id,
        activityFactId: fact.id,
        state: input.state,
        actor: "MANUAL_REVIEW",
        note: input.note?.trim() || null,
        reconciliationSnapshot: link ? link as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
      },
    });
    await tx.messageReviewEvent.create({
      data: { workspaceId: message.workspaceId, sourceMessageId: message.id, activityFactId: fact.id, eventType: input.state === "CONFIRMED" ? "FACT_CONFIRMED" : input.state === "INCORRECT" ? "FACT_INCORRECT" : "FACT_SUPERSEDED", actor: "MANUAL_REVIEW", detail: { reviewId: review.id, note: review.note } },
    });
    let correctionRow = null;
    if (correction) {
      correctionRow = await tx.activityFactCorrection.create({
        data: { workspaceId: message.workspaceId, sourceMessageId: message.id, activityFactId: fact.id, activityFactReviewId: review.id, structuredPayload: correction, note: input.note?.trim() || null },
      });
      await tx.messageReviewEvent.create({
        data: { workspaceId: message.workspaceId, sourceMessageId: message.id, activityFactId: fact.id, eventType: "CORRECTION_RECORDED", actor: "MANUAL_REVIEW", detail: { reviewId: review.id, correctionId: correctionRow.id } },
      });
    }
    return { review, correction: correctionRow };
  });
}
