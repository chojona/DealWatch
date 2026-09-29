import type { PrismaClient } from "@prisma/client";

export async function recordDocumentMilestone(
  prisma: PrismaClient,
  input: {
    documentId: string;
    kind: "ANALYZED" | "NEGOTIATION_REVIEWED" | "EVIDENCE_CORRECTED" | "DOCUMENT_REVIEWED";
    dedupeKey: string;
  }
) {
  try {
    await prisma.documentMilestone.create({
      data: {
        documentId: input.documentId,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}
