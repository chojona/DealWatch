import { Prisma, type PrismaClient } from "@prisma/client";
import { validateStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type { ValidatedNegotiationTerm } from "@/lib/ai/negotiation/schemas";
import type { ProvenanceWrite } from "@/lib/documents/locateEvidence";

export interface RoundTermWrite extends ValidatedNegotiationTerm {
  provenance?: ProvenanceWrite;
}

export interface NegotiationRoundWrite {
  dealId: string;
  side: "TENANT" | "LANDLORD";
  documentName: string;
  documentText: string;
  documentDate: Date;
  sourceType: string;
  documentId?: string | null;
  terms: RoundTermWrite[];
}

function termCreateData(
  term: RoundTermWrite,
  side: string,
  roundNumber: number
): Prisma.NegotiationTermUncheckedCreateWithoutRoundInput {
  const structuredPayload = term.structuredPayload
    ? (validateStructuredPayload(term.structuredPayload) as Prisma.InputJsonValue)
    : null;

  return {
    canonicalType: term.canonicalType,
    normalizedValue: term.normalizedValue ?? null,
    normalizedNumeric: term.normalizedNumeric ?? null,
    normalizedUnit: term.normalizedUnit ?? null,
    rawValue: term.rawValue,
    status: term.status,
    side,
    roundNumber,
    confidence: term.confidence,
    evidenceQuote: term.evidenceQuote,
    sourceLocation: term.sourceLocation ?? null,
    documentPageId: term.provenance?.documentPageId ?? null,
    evidenceStartOffset: term.provenance?.evidenceStartOffset ?? null,
    evidenceEndOffset: term.provenance?.evidenceEndOffset ?? null,
    provenanceStatus: term.provenance?.provenanceStatus ?? null,
    structuredPayload: structuredPayload ?? Prisma.DbNull,
  };
}

/**
 * Creates one round and all of its terms in the caller's transaction.
 * Round numbers stay per side across pasted text and uploaded PDFs.
 */
export async function writeNegotiationRound(
  db: Prisma.TransactionClient,
  input: NegotiationRoundWrite
) {
  const latest = await db.negotiationRound.findFirst({
    where: { dealId: input.dealId, side: input.side },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  const roundNumber = (latest?.roundNumber ?? 0) + 1;

  return db.negotiationRound.create({
    data: {
      dealId: input.dealId,
      side: input.side,
      roundNumber,
      documentName: input.documentName,
      documentText: input.documentText,
      documentDate: input.documentDate,
      sourceType: input.sourceType,
      documentId: input.documentId ?? null,
      terms: {
        create: input.terms.map((term) =>
          termCreateData(term, input.side, roundNumber)
        ),
      },
    },
    include: { terms: true },
  });
}

export async function persistExtractedNegotiationRound(
  prisma: PrismaClient,
  input: NegotiationRoundWrite
) {
  return prisma.$transaction((tx) => writeNegotiationRound(tx, input));
}
