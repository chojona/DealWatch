import type { PrismaClient } from "@prisma/client";

export interface ReviewHistoryEntry {
  id: string;
  occurredAt: string;
  dateLabel: string;
  label: string;
  actorLabel: "Manual review";
}

export interface ReviewHistory {
  documentId: string;
  entries: ReviewHistoryEntry[];
}

const ACTOR = "Manual review" as const;

function dateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function decisionLabel(kind: string, reviewState: string): string | null {
  if (kind === "NEGOTIATION_TERM" && reviewState === "ACKNOWLEDGED") return "Negotiation finding acknowledged";
  if (kind === "NEGOTIATION_TERM" && reviewState === "NEEDS_FOLLOW_UP") return "Negotiation finding flagged for follow-up";
  if (kind === "NEGOTIATION_TERM" && reviewState === "PENDING") return "Negotiation finding review cleared";
  if (kind === "NEGOTIATION_CONFLICT" && reviewState === "ACKNOWLEDGED") return "Negotiation conflict acknowledged";
  if (kind === "NEGOTIATION_CONFLICT" && reviewState === "NEEDS_FOLLOW_UP") return "Negotiation conflict flagged for follow-up";
  if (kind === "NEGOTIATION_CONFLICT" && reviewState === "PENDING") return "Negotiation conflict review cleared";
  if (kind === "EVIDENCE" && reviewState === "ACKNOWLEDGED") return "Ambiguity acknowledged";
  if (kind === "EVIDENCE" && reviewState === "NEEDS_FOLLOW_UP") return "Evidence flagged for follow-up";
  if (kind === "EVIDENCE" && reviewState === "PENDING") return "Evidence review cleared";
  if (kind === "ENTITY_CLOSURE" && reviewState === "LEFT_UNRESOLVED") return "Entity left unresolved";
  if (kind === "ENTITY_CLOSURE" && reviewState === "PENDING") return "Entity review reopened";
  return null;
}

function promotionLabel(decision: string): string | null {
  if (decision === "APPROVED") return "Relationship approved";
  if (decision === "REJECTED") return "Relationship rejected";
  if (decision === "ACKNOWLEDGED_BLOCKED") return "Blocked relationship acknowledged";
  return null;
}

/**
 * Read-only audit for one document. Canonical tables stay the source of truth.
 * Queries are bounded to that document.
 */
export async function getReviewHistory(
  prisma: PrismaClient,
  input: { workspaceId: string; documentId: string }
): Promise<ReviewHistory | null> {
  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    select: { id: true, deal: { select: { workspaceId: true } } },
  });
  if (!document || document.deal.workspaceId !== input.workspaceId) return null;

  const [events, corrections, links, promotions] = await Promise.all([
    prisma.reviewDecisionEvent.findMany({
      where: { documentId: document.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, kind: true, reviewState: true, reviewedAt: true },
    }),
    prisma.evidenceCorrection.findMany({
      where: { documentId: document.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, createdAt: true },
    }),
    prisma.entityResolutionLink.findMany({
      where: {
        status: { in: ["ACCEPTED", "SUPERSEDED"] },
        observation: { documentId: document.id, workspaceId: input.workspaceId },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, createdAt: true },
    }),
    prisma.relationshipPromotionEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        relationshipObservation: { documentId: document.id },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, decision: true, reviewedAt: true },
    }),
  ]);

  const entries: ReviewHistoryEntry[] = [];
  for (const event of events) {
    const label = decisionLabel(event.kind, event.reviewState);
    if (!label) continue;
    entries.push({
      id: `decision:${event.id}`,
      occurredAt: event.reviewedAt.toISOString(),
      dateLabel: dateLabel(event.reviewedAt),
      label,
      actorLabel: ACTOR,
    });
  }
  for (const correction of corrections) {
    entries.push({
      id: `evidence:${correction.id}`,
      occurredAt: correction.createdAt.toISOString(),
      dateLabel: dateLabel(correction.createdAt),
      label: "Evidence corrected",
      actorLabel: ACTOR,
    });
  }
  for (const link of links) {
    entries.push({
      id: `resolution:${link.id}`,
      occurredAt: link.createdAt.toISOString(),
      dateLabel: dateLabel(link.createdAt),
      label: "Entity resolved",
      actorLabel: ACTOR,
    });
  }
  for (const promotion of promotions) {
    const label = promotionLabel(promotion.decision);
    if (!label) continue;
    entries.push({
      id: `relationship:${promotion.id}`,
      occurredAt: promotion.reviewedAt.toISOString(),
      dateLabel: dateLabel(promotion.reviewedAt),
      label,
      actorLabel: ACTOR,
    });
  }
  entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
  return { documentId: document.id, entries };
}
