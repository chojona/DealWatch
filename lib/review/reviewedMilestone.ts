import type { PrismaClient } from "@prisma/client";
import { recordDocumentMilestone } from "./milestones";

/**
 * Records one document-reviewed milestone when live review state is REVIEWED.
 * Reopening review does not delete the milestone. Inbox status stays derived.
 */
export async function syncReviewedMilestone(prisma: PrismaClient, documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, deal: { select: { workspaceId: true } } },
  });
  if (!document) return;
  const { getDocumentReview } = await import("@/lib/inbox/service");
  const review = await getDocumentReview(prisma, document.deal.workspaceId, document.id);
  if (review?.item.processingStatus !== "REVIEWED") return;
  await recordDocumentMilestone(prisma, {
    documentId: document.id,
    kind: "DOCUMENT_REVIEWED",
    dedupeKey: `reviewed:${document.id}`,
  });
}
