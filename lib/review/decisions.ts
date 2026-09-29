import type { Prisma, PrismaClient, ReviewDecisionState, ReviewSubjectKind } from "@prisma/client";
import { recordDocumentMilestone } from "./milestones";
import { syncReviewedMilestone } from "./reviewedMilestone";

export class ReviewActionError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "CROSS_DOCUMENT",
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "ReviewActionError";
  }
}

export type ReviewAction = "ACKNOWLEDGE" | "NEEDS_FOLLOW_UP" | "CLEAR";

export type ReviewTarget =
  | { kind: "NEGOTIATION_TERM"; negotiationTermId: string }
  | { kind: "NEGOTIATION_CONFLICT"; canonicalType: string }
  | {
      kind: "EVIDENCE";
      evidenceKind: "TERM" | "ENTITY" | "RELATIONSHIP";
      id: string;
    };

const STATE_FOR_ACTION: Record<ReviewAction, ReviewDecisionState> = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  NEEDS_FOLLOW_UP: "NEEDS_FOLLOW_UP",
  CLEAR: "PENDING",
};

function subjectFor(target: ReviewTarget): {
  subjectKey: string;
  kind: ReviewSubjectKind;
  negotiationTermId: string | null;
  canonicalType: string | null;
  entityObservationId: string | null;
  relationshipObservationId: string | null;
} {
  if (target.kind === "NEGOTIATION_TERM") {
    return {
      subjectKey: `term:${target.negotiationTermId}`,
      kind: "NEGOTIATION_TERM",
      negotiationTermId: target.negotiationTermId,
      canonicalType: null,
      entityObservationId: null,
      relationshipObservationId: null,
    };
  }
  if (target.kind === "NEGOTIATION_CONFLICT") {
    return {
      subjectKey: `conflict:${target.canonicalType}`,
      kind: "NEGOTIATION_CONFLICT",
      negotiationTermId: null,
      canonicalType: target.canonicalType,
      entityObservationId: null,
      relationshipObservationId: null,
    };
  }
  const prefix = target.evidenceKind === "TERM" ? "term" : target.evidenceKind === "ENTITY" ? "entity" : "relationship";
  return {
    subjectKey: `evidence:${prefix}:${target.id}`,
    kind: "EVIDENCE",
    negotiationTermId: target.evidenceKind === "TERM" ? target.id : null,
    canonicalType: null,
    entityObservationId: target.evidenceKind === "ENTITY" ? target.id : null,
    relationshipObservationId: target.evidenceKind === "RELATIONSHIP" ? target.id : null,
  };
}

async function assertTarget(prisma: PrismaClient, documentId: string, target: ReviewTarget) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, dealId: true, deal: { select: { workspaceId: true } } },
  });
  if (!document) throw new ReviewActionError("NOT_FOUND", "Document not found", 404);

  if (target.kind === "NEGOTIATION_TERM" || (target.kind === "EVIDENCE" && target.evidenceKind === "TERM")) {
    const termId = target.kind === "NEGOTIATION_TERM" ? target.negotiationTermId : target.id;
    const term = await prisma.negotiationTerm.findUnique({
      where: { id: termId },
      select: {
        id: true,
        provenanceStatus: true,
        round: { select: { documentId: true, deal: { select: { workspaceId: true } } } },
      },
    });
    if (!term || term.round.documentId !== document.id || term.round.deal.workspaceId !== document.deal.workspaceId) {
      throw new ReviewActionError("CROSS_DOCUMENT", "That negotiation finding is not on this document.", 404);
    }
    if (target.kind === "EVIDENCE" && term.provenanceStatus !== "AMBIGUOUS" && term.provenanceStatus !== "UNLOCATED") {
      throw new ReviewActionError("INVALID", "This finding has no provenance issue to review.", 409);
    }
    return document;
  }

  if (target.kind === "NEGOTIATION_CONFLICT") {
    const terms = await prisma.negotiationTerm.findMany({
      where: {
        canonicalType: target.canonicalType,
        round: { documentId: document.id, deal: { workspaceId: document.deal.workspaceId } },
      },
      select: { id: true },
    });
    if (terms.length === 0) {
      throw new ReviewActionError("CROSS_DOCUMENT", "That conflict is not on this document.", 404);
    }
    return document;
  }

  if (target.evidenceKind === "ENTITY") {
    const row = await prisma.entityObservation.findFirst({
      where: { id: target.id, documentId: document.id, workspaceId: document.deal.workspaceId },
      select: { id: true, provenanceStatus: true },
    });
    if (!row) throw new ReviewActionError("CROSS_DOCUMENT", "That entity evidence is not on this document.", 404);
    if (row.provenanceStatus !== "AMBIGUOUS" && row.provenanceStatus !== "UNLOCATED") {
      throw new ReviewActionError("INVALID", "This evidence has no provenance issue to review.", 409);
    }
    return document;
  }

  const relationship = await prisma.relationshipObservation.findFirst({
    where: { id: target.id, documentId: document.id, workspaceId: document.deal.workspaceId },
    select: { id: true, provenanceStatus: true },
  });
  if (!relationship) {
    throw new ReviewActionError("CROSS_DOCUMENT", "That relationship evidence is not on this document.", 404);
  }
  if (relationship.provenanceStatus !== "AMBIGUOUS" && relationship.provenanceStatus !== "UNLOCATED") {
    throw new ReviewActionError("INVALID", "This evidence has no provenance issue to review.", 409);
  }
  return document;
}

/**
 * Records a human review decision. Negotiation terms, conflicts, and
 * provenance issues are metadata about findings. This function does not
 * write NegotiationTerm, resolution links, or canonical graph rows.
 */
export async function recordReviewDecision(
  prisma: PrismaClient,
  input: {
    documentId: string;
    action: ReviewAction;
    target: ReviewTarget;
    note?: string | null;
  }
) {
  const document = await assertTarget(prisma, input.documentId, input.target);
  const subject = subjectFor(input.target);
  const reviewState = STATE_FOR_ACTION[input.action];
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;
  const reviewedAt = new Date();

  const saved = await prisma.$transaction(async (tx) => {
    const current = await tx.reviewDecision.findUnique({
      where: { documentId_subjectKey: { documentId: document.id, subjectKey: subject.subjectKey } },
    });
    if (current && current.reviewState === reviewState && (current.note ?? null) === note) {
      return current;
    }
    const data = {
      reviewState,
      note,
      reviewedAt,
      actor: "MANUAL_REVIEW" as const,
      reviewerUserId: null,
      kind: subject.kind,
      negotiationTermId: subject.negotiationTermId,
      canonicalType: subject.canonicalType,
      entityObservationId: subject.entityObservationId,
      relationshipObservationId: subject.relationshipObservationId,
    };
    const decision = current
      ? await tx.reviewDecision.update({ where: { id: current.id }, data })
      : await tx.reviewDecision.create({
          data: { documentId: document.id, subjectKey: subject.subjectKey, ...data },
        });
    await tx.reviewDecisionEvent.create({
      data: {
        documentId: document.id,
        subjectKey: subject.subjectKey,
        ...data,
      },
    });
    return decision;
  });

  if (subject.kind === "NEGOTIATION_TERM" || subject.kind === "NEGOTIATION_CONFLICT") {
    await maybeRecordNegotiationMilestone(prisma, document.id);
  }
  await syncReviewedMilestone(prisma, document.id);
  return saved;
}

async function maybeRecordNegotiationMilestone(prisma: PrismaClient, documentId: string) {
  const terms = await prisma.negotiationTerm.findMany({
    where: { round: { documentId } },
    select: { id: true },
  });
  if (terms.length === 0) return;
  const decisions = await prisma.reviewDecision.findMany({
    where: { documentId, kind: "NEGOTIATION_TERM", negotiationTermId: { in: terms.map((term) => term.id) } },
    select: { reviewState: true, negotiationTermId: true },
  });
  const byTerm = new Map(decisions.map((decision) => [decision.negotiationTermId, decision.reviewState]));
  const complete = terms.every((term) => {
    const state = byTerm.get(term.id);
    return state === "ACKNOWLEDGED" || state === "NEEDS_FOLLOW_UP";
  });
  if (!complete) return;
  await recordDocumentMilestone(prisma, {
    documentId,
    kind: "NEGOTIATION_REVIEWED",
    dedupeKey: `negotiation-reviewed:${documentId}`,
  });
}

export async function negotiationReviewSummaries(
  prisma: PrismaClient,
  rounds: Array<{ documentId: string | null; terms: Array<{ id: string }> }>
) {
  const documentIds = [...new Set(rounds.map((round) => round.documentId).filter((id): id is string => Boolean(id)))];
  if (documentIds.length === 0) return new Map<string, { findingsReviewed: number; findingsFollowUp: number; findingsTotal: number }>();
  const decisions = await prisma.reviewDecision.findMany({
    where: { documentId: { in: documentIds }, kind: "NEGOTIATION_TERM" },
    select: { documentId: true, negotiationTermId: true, reviewState: true },
  });
  const summaries = new Map<string, { findingsReviewed: number; findingsFollowUp: number; findingsTotal: number }>();
  for (const round of rounds) {
    if (!round.documentId) continue;
    const current = summaries.get(round.documentId) ?? { findingsReviewed: 0, findingsFollowUp: 0, findingsTotal: 0 };
    current.findingsTotal += round.terms.length;
    summaries.set(round.documentId, current);
  }
  for (const decision of decisions) {
    const current = summaries.get(decision.documentId);
    if (!current) continue;
    if (decision.reviewState === "ACKNOWLEDGED") current.findingsReviewed += 1;
    if (decision.reviewState === "NEEDS_FOLLOW_UP") current.findingsFollowUp += 1;
  }
  return summaries;
}

export type ReviewDecisionRow = Prisma.ReviewDecisionGetPayload<{
  select: {
    documentId: true;
    subjectKey: true;
    kind: true;
    negotiationTermId: true;
    canonicalType: true;
    entityObservationId: true;
    relationshipObservationId: true;
    reviewState: true;
    note: true;
    reviewedAt: true;
  };
}>;
