import type { Prisma, PrismaClient } from "@prisma/client";
import type { GraphDb } from "@/lib/entities/workspace";
import { ReviewActionError } from "./decisions";
import { syncReviewedMilestone } from "./reviewedMilestone";

const CLOSURE_KIND = "ENTITY_CLOSURE" as const;

function closureKey(observationId: string) {
  return `entity-closure:${observationId}`;
}

async function documentWorkspace(prisma: PrismaClient, documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, deal: { select: { workspaceId: true } } },
  });
  if (!document) throw new ReviewActionError("NOT_FOUND", "Document not found", 404);
  return document;
}

/**
 * Clears a left-unresolved decision because an accepted resolution link now
 * exists. The link is the audit record. No second history row is written.
 */
export async function releaseEntityClosureOnResolve(db: GraphDb, observationId: string) {
  const current = await db.reviewDecision.findFirst({
    where: {
      kind: CLOSURE_KIND,
      entityObservationId: observationId,
      reviewState: "LEFT_UNRESOLVED",
    },
  });
  if (!current) return;
  await db.reviewDecision.update({
    where: { id: current.id },
    data: {
      reviewState: "PENDING",
      note: null,
      reviewedAt: new Date(),
      actor: "MANUAL_REVIEW",
      reviewerUserId: null,
    },
  });
}

/**
 * Persists "I reviewed this observation and intentionally chose not to resolve it."
 * Does not reject the observation, create a canonical entity, or hide it.
 */
export async function leaveEntityUnresolved(
  prisma: PrismaClient,
  input: { documentId: string; observationId: string; note?: string | null }
) {
  const document = await documentWorkspace(prisma, input.documentId);
  const observation = await prisma.entityObservation.findUnique({
    where: { id: input.observationId },
    select: {
      id: true,
      documentId: true,
      workspaceId: true,
      resolutionLinks: { where: { status: "ACCEPTED", supersededAt: null }, select: { id: true } },
    },
  });
  if (
    !observation ||
    observation.documentId !== document.id ||
    observation.workspaceId !== document.deal.workspaceId
  ) {
    throw new ReviewActionError("CROSS_DOCUMENT", "That entity observation is not on this document.", 404);
  }
  if (observation.resolutionLinks.length > 0) {
    throw new ReviewActionError(
      "INVALID",
      "This observation is already resolved. Leaving it unresolved does not undo that resolution.",
      409
    );
  }

  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;
  const subjectKey = closureKey(observation.id);
  const reviewedAt = new Date();
  const saved = await prisma.$transaction(async (tx) => {
    const current = await tx.reviewDecision.findUnique({
      where: { documentId_subjectKey: { documentId: document.id, subjectKey } },
    });
    if (current?.reviewState === "LEFT_UNRESOLVED" && (current.note ?? null) === note) {
      return current;
    }
    const data = {
      reviewState: "LEFT_UNRESOLVED" as const,
      note,
      reviewedAt,
      actor: "MANUAL_REVIEW" as const,
      reviewerUserId: null,
      kind: CLOSURE_KIND,
      negotiationTermId: null,
      canonicalType: null,
      entityObservationId: observation.id,
      relationshipObservationId: null,
    };
    const decision = current
      ? await tx.reviewDecision.update({ where: { id: current.id }, data })
      : await tx.reviewDecision.create({
          data: { documentId: document.id, subjectKey, ...data },
        });
    await tx.reviewDecisionEvent.create({
      data: { documentId: document.id, subjectKey, ...data },
    });
    return decision;
  });
  await syncReviewedMilestone(prisma, document.id);
  return saved;
}

/** Returns a left-unresolved observation to unreviewed. Does not create or remove entities. */
export async function reopenEntityClosure(
  prisma: PrismaClient,
  input: { documentId: string; observationId: string }
) {
  const document = await documentWorkspace(prisma, input.documentId);
  const observation = await prisma.entityObservation.findUnique({
    where: { id: input.observationId },
    select: { id: true, documentId: true, workspaceId: true },
  });
  if (
    !observation ||
    observation.documentId !== document.id ||
    observation.workspaceId !== document.deal.workspaceId
  ) {
    throw new ReviewActionError("CROSS_DOCUMENT", "That entity observation is not on this document.", 404);
  }
  const subjectKey = closureKey(observation.id);
  const reviewedAt = new Date();
  const saved = await prisma.$transaction(async (tx) => {
    const current = await tx.reviewDecision.findUnique({
      where: { documentId_subjectKey: { documentId: document.id, subjectKey } },
    });
    if (!current || current.reviewState === "PENDING") return current;
    const data = {
      reviewState: "PENDING" as const,
      note: null,
      reviewedAt,
      actor: "MANUAL_REVIEW" as const,
      reviewerUserId: null,
      kind: CLOSURE_KIND,
      negotiationTermId: null,
      canonicalType: null,
      entityObservationId: observation.id,
      relationshipObservationId: null,
    };
    const decision = await tx.reviewDecision.update({ where: { id: current.id }, data });
    await tx.reviewDecisionEvent.create({
      data: { documentId: document.id, subjectKey, ...data },
    });
    return decision;
  });
  await syncReviewedMilestone(prisma, document.id);
  return saved;
}

export type EntityClosure = "UNREVIEWED" | "RESOLVED" | "LEFT_UNRESOLVED";

export function entityClosureFrom(input: {
  resolved: boolean;
  leftUnresolved: boolean;
}): EntityClosure {
  if (input.resolved) return "RESOLVED";
  if (input.leftUnresolved) return "LEFT_UNRESOLVED";
  return "UNREVIEWED";
}

export async function leftUnresolvedObservationIds(
  db: GraphDb,
  observationIds: string[]
): Promise<Set<string>> {
  if (observationIds.length === 0) return new Set();
  const rows = await db.reviewDecision.findMany({
    where: {
      kind: CLOSURE_KIND,
      reviewState: "LEFT_UNRESOLVED",
      entityObservationId: { in: observationIds },
    },
    select: { entityObservationId: true },
  });
  return new Set(
    rows.map((row) => row.entityObservationId).filter((id): id is string => Boolean(id))
  );
}

export type ClosureDecision = Prisma.ReviewDecisionGetPayload<{
  select: { id: true; reviewState: true; note: true; reviewedAt: true; actor: true; reviewerUserId: true };
}>;
