import type { PrismaClient } from "@prisma/client";
import { recordDocumentMilestone } from "./milestones";
import { ReviewActionError } from "./decisions";
import { syncReviewedMilestone } from "./reviewedMilestone";

/**
 * Active correction is the newest row with supersededAt null.
 * Older rows stay so the original span history is recoverable.
 * NegotiationTerm evidence columns are not written.
 */
export async function correctNegotiationEvidence(
  prisma: PrismaClient,
  input: {
    documentId: string;
    negotiationTermId: string;
    documentPageId: string;
    startOffset: number;
    endOffset: number;
    evidenceQuote: string;
  }
) {
  if (!Number.isInteger(input.startOffset) || !Number.isInteger(input.endOffset)) {
    throw new ReviewActionError("INVALID", "Evidence offsets must be integers.", 400);
  }
  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    select: { id: true, deal: { select: { workspaceId: true } } },
  });
  if (!document) throw new ReviewActionError("NOT_FOUND", "Document not found", 404);

  const term = await prisma.negotiationTerm.findUnique({
    where: { id: input.negotiationTermId },
    select: {
      id: true,
      evidenceQuote: true,
      documentPageId: true,
      evidenceStartOffset: true,
      evidenceEndOffset: true,
      provenanceStatus: true,
      round: { select: { documentId: true, deal: { select: { workspaceId: true } } } },
    },
  });
  if (!term || term.round.documentId !== document.id || term.round.deal.workspaceId !== document.deal.workspaceId) {
    throw new ReviewActionError("CROSS_DOCUMENT", "That negotiation finding is not on this document.", 404);
  }

  const page = await prisma.documentPage.findUnique({
    where: { id: input.documentPageId },
    select: { id: true, documentId: true, text: true },
  });
  if (!page || page.documentId !== document.id) {
    throw new ReviewActionError("CROSS_DOCUMENT", "That page is not part of this document.", 404);
  }
  if (input.startOffset < 0 || input.endOffset > page.text.length || input.startOffset >= input.endOffset) {
    throw new ReviewActionError("INVALID", "Those offsets are outside the extracted page text.", 400);
  }
  const selected = page.text.slice(input.startOffset, input.endOffset);
  if (selected !== input.evidenceQuote) {
    throw new ReviewActionError(
      "INVALID",
      "The evidence quote does not match the selected page text.",
      400
    );
  }
  if (selected.trim().length === 0) {
    throw new ReviewActionError("INVALID", "The selected evidence is empty.", 400);
  }

  const saved = await prisma.$transaction(async (tx) => {
    const active = await tx.evidenceCorrection.findFirst({
      where: { negotiationTermId: term.id, supersededAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (
      active &&
      active.documentPageId === page.id &&
      active.startOffset === input.startOffset &&
      active.endOffset === input.endOffset &&
      active.evidenceQuote === selected
    ) {
      return active;
    }
    const createdAt = new Date();
    if (active) {
      await tx.evidenceCorrection.updateMany({
        where: { negotiationTermId: term.id, supersededAt: null },
        data: { supersededAt: createdAt },
      });
    }
    return tx.evidenceCorrection.create({
      data: {
        documentId: document.id,
        negotiationTermId: term.id,
        documentPageId: page.id,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        evidenceQuote: selected,
        actor: "MANUAL_REVIEW",
        reviewerUserId: null,
        createdAt,
      },
    });
  });

  await recordDocumentMilestone(prisma, {
    documentId: document.id,
    kind: "EVIDENCE_CORRECTED",
    dedupeKey: `evidence-corrected:${document.id}`,
  });
  await syncReviewedMilestone(prisma, document.id);

  const reread = await prisma.negotiationTerm.findUnique({
    where: { id: term.id },
    select: {
      evidenceQuote: true,
      documentPageId: true,
      evidenceStartOffset: true,
      evidenceEndOffset: true,
      provenanceStatus: true,
    },
  });
  return { correction: saved, original: reread };
}
