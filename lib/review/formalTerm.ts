import { Prisma, type PrismaClient } from "@prisma/client";
import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import {
  FormalCorrectionError,
  formalReviewWriteData,
  resolveFormalCorrection,
  type FormalCommercialFields,
  type FormalReviewState,
} from "@/lib/negotiation/formalReview";
import { ReviewActionError } from "./decisions";

export type FormalTermReviewCommand =
  | { action: "ACCEPT"; note?: string | null }
  | { action: "REJECT"; note?: string | null }
  | {
      action: "CORRECT";
      note?: string | null;
      rawValue?: string | null;
      normalizedValue?: string | null;
      normalizedNumeric?: number | null;
      normalizedUnit?: string | null;
      structuredPayload?: unknown;
      amountPerRSFYear?: number | null;
    };

const reviewSelect = {
  id: true,
  negotiationTermId: true,
  state: true,
  normalizedValue: true,
  normalizedNumeric: true,
  normalizedUnit: true,
  rawValue: true,
  structuredPayload: true,
  note: true,
  reviewedAt: true,
  actor: true,
  reviewerUserId: true,
  updatedAt: true,
} as const;

/**
 * Records the current formal-review decision for one extraction.
 * NegotiationTerm is read and never updated. A repeated identical command
 * returns the existing row and does not append another event.
 */
export async function reviewFormalTerm(
  prisma: PrismaClient,
  input: { documentId: string; negotiationTermId: string } & FormalTermReviewCommand
) {
  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    select: { id: true, deal: { select: { id: true, workspaceId: true } } },
  });
  if (!document) throw new ReviewActionError("NOT_FOUND", "Document not found", 404);

  const term = await prisma.negotiationTerm.findUnique({
    where: { id: input.negotiationTermId },
    select: {
      id: true,
      canonicalType: true,
      structuredPayload: true,
      round: { select: { documentId: true, dealId: true, deal: { select: { workspaceId: true } } } },
    },
  });
  if (
    !term ||
    term.round.documentId !== document.id ||
    term.round.dealId !== document.deal.id ||
    term.round.deal.workspaceId !== document.deal.workspaceId
  ) {
    throw new ReviewActionError("CROSS_DOCUMENT", "That negotiation finding is not on this document.", 404);
  }

  const note = input.note?.trim() || null;
  const fields = input.action === "CORRECT" ? correctionFields(term, input) : null;
  const state: FormalReviewState = input.action === "ACCEPT" ? "ACCEPTED" : input.action === "REJECT" ? "REJECTED" : "CORRECTED";
  const reviewedAt = new Date();
  const data = {
    state,
    note,
    reviewedAt,
    actor: "MANUAL_REVIEW" as const,
    reviewerUserId: null,
    ...formalReviewWriteData(fields),
  };

  const saved = await prisma.$transaction(async (tx) => {
    const existing = await tx.formalTermReview.findUnique({
      where: { negotiationTermId: term.id },
      select: reviewSelect,
    });
    if (existing && sameReview(existing, data)) return { review: existing, unchanged: true };
    const review = existing
      ? await tx.formalTermReview.update({
          where: { id: existing.id },
          data,
          select: reviewSelect,
        })
      : await tx.formalTermReview.create({
          data: { negotiationTermId: term.id, ...data },
          select: reviewSelect,
        });
    await tx.formalTermReviewEvent.create({
      data: {
        formalTermReviewId: review.id,
        negotiationTermId: term.id,
        state: review.state,
        normalizedValue: review.normalizedValue,
        normalizedNumeric: review.normalizedNumeric,
        normalizedUnit: review.normalizedUnit,
        rawValue: review.rawValue,
        structuredPayload: review.structuredPayload === null ? Prisma.JsonNull : (review.structuredPayload as Prisma.InputJsonValue),
        note: review.note,
        reviewedAt: review.reviewedAt,
        actor: review.actor,
        reviewerUserId: review.reviewerUserId,
      },
    });
    return { review, unchanged: false };
  });

  const original = await prisma.negotiationTerm.findUnique({
    where: { id: term.id },
    select: {
      id: true,
      canonicalType: true,
      normalizedValue: true,
      normalizedNumeric: true,
      normalizedUnit: true,
      rawValue: true,
      structuredPayload: true,
      evidenceQuote: true,
      documentPageId: true,
      evidenceStartOffset: true,
      evidenceEndOffset: true,
      provenanceStatus: true,
    },
  });
  return { ...saved, original };
}

function correctionFields(
  term: { canonicalType: string; structuredPayload: unknown },
  input: Extract<FormalTermReviewCommand, { action: "CORRECT" }>
): FormalCommercialFields {
  try {
    return resolveFormalCorrection(
      { canonicalType: term.canonicalType as CanonicalTermType, structuredPayload: term.structuredPayload },
      input
    );
  } catch (error) {
    if (error instanceof FormalCorrectionError) {
      throw new ReviewActionError("INVALID", error.message, 400);
    }
    throw error;
  }
}

function sameReview(
  existing: {
    state: FormalReviewState;
    normalizedValue: string | null;
    normalizedNumeric: number | null;
    normalizedUnit: string | null;
    rawValue: string | null;
    structuredPayload: unknown;
    note: string | null;
  },
  next: {
    state: FormalReviewState;
    normalizedValue: string | null;
    normalizedNumeric: number | null;
    normalizedUnit: string | null;
    rawValue: string | null;
    structuredPayload: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    note: string | null;
  }
): boolean {
  return existing.state === next.state
    && existing.normalizedValue === next.normalizedValue
    && existing.normalizedNumeric === next.normalizedNumeric
    && existing.normalizedUnit === next.normalizedUnit
    && existing.rawValue === next.rawValue
    && existing.note === next.note
    && JSON.stringify(existing.structuredPayload ?? null) === JSON.stringify(next.structuredPayload === Prisma.JsonNull ? null : next.structuredPayload);
}
