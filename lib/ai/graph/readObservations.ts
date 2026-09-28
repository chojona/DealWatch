import type { PrismaClient } from "@prisma/client";

export async function readDocumentObservations(
  prisma: PrismaClient,
  documentId: string
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      dealId: true,
      graphExtractionStatus: true,
      graphFailureCode: true,
      graphFailureReason: true,
      deal: { select: { workspaceId: true } },
    },
  });
  if (!document) return null;

  const [runs, entityObservations, relationshipObservations] = await Promise.all([
    prisma.graphExtractionRun.findMany({
      where: { documentId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.entityObservation.findMany({
      where: { documentId },
      orderBy: { createdAt: "asc" },
      include: { documentPage: { select: { pageNumber: true } } },
    }),
    prisma.relationshipObservation.findMany({
      where: { documentId },
      orderBy: { createdAt: "asc" },
      include: { documentPage: { select: { pageNumber: true } } },
    }),
  ]);

  return {
    documentId: document.id,
    dealId: document.dealId,
    workspaceId: document.deal.workspaceId,
    graphExtractionStatus: document.graphExtractionStatus,
    graphFailureCode: document.graphFailureCode,
    graphFailureReason: document.graphFailureReason,
    runs: runs.map((run) => ({
      id: run.id,
      extractor: run.extractor,
      extractorVersion: run.extractorVersion,
      model: run.model,
      status: run.status,
      failureCode: run.failureCode,
      failureReason: run.failureReason,
      entityCount: run.entityCount,
      relationshipCount: run.relationshipCount,
      rejectedCount: run.rejectedCount,
      diagnostics: run.diagnostics,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    })),
    entityObservations: entityObservations.map((observation) => ({
      id: observation.id,
      observationRunId: observation.graphExtractionRunId,
      observedType: observation.observedType,
      surfaceForm: observation.surfaceForm,
      normalizedName: observation.normalizedName,
      title: observation.title,
      email: observation.email,
      phone: observation.phone,
      domain: observation.domain,
      addressLine1: observation.addressLine1,
      rawAttributes: observation.rawAttributes,
      evidenceQuote: observation.evidenceQuote,
      evidenceStartOffset: observation.evidenceStartOffset,
      evidenceEndOffset: observation.evidenceEndOffset,
      provenanceStatus: observation.provenanceStatus,
      documentPageId: observation.documentPageId,
      pageNumber: observation.documentPage?.pageNumber ?? null,
      extractionConfidence: observation.extractionConfidence,
      extractor: observation.extractor,
      extractorVersion: observation.extractorVersion,
      workspaceId: observation.workspaceId,
    })),
    relationshipObservations: relationshipObservations.map((observation) => ({
      id: observation.id,
      observationRunId: observation.graphExtractionRunId,
      predicate: observation.predicate,
      subjectObservationId: observation.subjectObservationId,
      objectObservationId: observation.objectObservationId,
      principalObservationId: observation.principalObservationId,
      participationRole: observation.participationRole,
      roleLabel: observation.roleLabel,
      affiliationKind: observation.affiliationKind,
      contextDealId: observation.contextDealId,
      statedValidFrom: observation.statedValidFrom?.toISOString() ?? null,
      statedValidTo: observation.statedValidTo?.toISOString() ?? null,
      statedTitle: observation.statedTitle,
      evidenceQuote: observation.evidenceQuote,
      evidenceStartOffset: observation.evidenceStartOffset,
      evidenceEndOffset: observation.evidenceEndOffset,
      provenanceStatus: observation.provenanceStatus,
      documentPageId: observation.documentPageId,
      pageNumber: observation.documentPage?.pageNumber ?? null,
      extractionConfidence: observation.extractionConfidence,
      extractor: observation.extractor,
      extractorVersion: observation.extractorVersion,
      workspaceId: observation.workspaceId,
    })),
  };
}
