import { Prisma, type PrismaClient } from "@prisma/client";
import { GRAPH_EXTRACTOR } from "./prompt";
import {
  recordEntityObservation,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import type {
  GraphRejection,
  ValidatedEntityObservation,
  ValidatedRelationshipObservation,
} from "./validateObservations";

export interface PersistGraphInput {
  workspaceId: string;
  dealId: string;
  documentId: string;
  extractor?: string;
  extractorVersion: string;
  model: string;
  entities: ValidatedEntityObservation[];
  relationships: ValidatedRelationshipObservation[];
  rejections: GraphRejection[];
}

export interface PersistedGraphRun {
  runId: string;
  idempotent: boolean;
  entityCount: number;
  relationshipCount: number;
}

function isUnique(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function diagnosticsJson(rejections: GraphRejection[]): Prisma.InputJsonValue {
  return {
    rejections: rejections.map((rejection) => ({
      target: rejection.target,
      key: rejection.key,
      code: rejection.code,
      detail: rejection.detail,
    })),
  };
}

function runKey(input: PersistGraphInput) {
  return {
    documentId: input.documentId,
    extractor: input.extractor ?? GRAPH_EXTRACTOR,
    extractorVersion: input.extractorVersion,
    model: input.model,
  };
}

export async function persistGraphObservations(
  prisma: PrismaClient,
  input: PersistGraphInput
): Promise<PersistedGraphRun> {
  const identity = runKey(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.graphExtractionRun.findUnique({
        where: { documentId_extractor_extractorVersion_model: identity },
      });
      if (existing?.status === "SUCCEEDED") {
        return {
          runId: existing.id,
          idempotent: true,
          entityCount: existing.entityCount,
          relationshipCount: existing.relationshipCount,
        };
      }

      const diagnostics = diagnosticsJson(input.rejections);
      const run = existing
        ? await tx.graphExtractionRun.update({
            where: { id: existing.id },
            data: {
              status: "SUCCEEDED",
              failureCode: null,
              failureReason: null,
              entityCount: input.entities.length,
              relationshipCount: input.relationships.length,
              rejectedCount: input.rejections.length,
              diagnostics,
              completedAt: new Date(),
            },
          })
        : await tx.graphExtractionRun.create({
            data: {
              ...identity,
              workspaceId: input.workspaceId,
              status: "SUCCEEDED",
              entityCount: input.entities.length,
              relationshipCount: input.relationships.length,
              rejectedCount: input.rejections.length,
              diagnostics,
              completedAt: new Date(),
            },
          });

      const ids = new Map<string, string>();
      for (const entity of input.entities) {
        const created = await recordEntityObservation(tx, {
          workspaceId: input.workspaceId,
          observedType: entity.observedType,
          surfaceForm: entity.surfaceForm,
          title: entity.title,
          email: entity.email,
          phone: entity.phone,
          domain: entity.domain,
          addressLine1: entity.addressLine1,
          rawAttributes: entity.rawAttributes ?? undefined,
          sourceKind: "DOCUMENT_PAGE",
          dealId: input.dealId,
          documentId: input.documentId,
          evidenceQuote: entity.evidenceQuote,
          extractionConfidence: entity.extractionConfidence,
          extractor: identity.extractor,
          extractorVersion: identity.extractorVersion,
          graphExtractionRunId: run.id,
        });
        ids.set(entity.observationKey, created.id);
      }

      for (const relationship of input.relationships) {
        const subjectObservationId = ids.get(relationship.subjectObservationKey);
        if (!subjectObservationId) {
          throw new Error("Validated relationship is missing its subject observation");
        }
        const objectObservationId = relationship.objectObservationKey
          ? ids.get(relationship.objectObservationKey)
          : null;
        if (relationship.objectObservationKey && !objectObservationId) {
          throw new Error("Validated relationship is missing its object observation");
        }
        const principalObservationId = relationship.principalObservationKey
          ? ids.get(relationship.principalObservationKey)
          : null;
        if (relationship.principalObservationKey && !principalObservationId) {
          throw new Error("Validated relationship is missing its principal observation");
        }
        await recordRelationshipObservation(tx, {
          workspaceId: input.workspaceId,
          predicate: relationship.predicate,
          subjectObservationId,
          objectObservationId,
          principalObservationId,
          participationRole: relationship.participationRole,
          roleLabel: relationship.roleLabel,
          affiliationKind: relationship.affiliationKind,
          contextDealId:
            relationship.predicate === "PARTICIPATES_AS" ||
            relationship.predicate === "CONCERNS_PROPERTY"
              ? input.dealId
              : null,
          statedValidFrom: relationship.statedValidFrom,
          statedValidTo: relationship.statedValidTo,
          statedTitle: relationship.statedTitle,
          sourceKind: "DOCUMENT_PAGE",
          dealId: input.dealId,
          documentId: input.documentId,
          evidenceQuote: relationship.evidenceQuote,
          extractionConfidence: relationship.extractionConfidence,
          extractor: identity.extractor,
          extractorVersion: identity.extractorVersion,
          graphExtractionRunId: run.id,
        });
      }

      await tx.document.update({
        where: { id: input.documentId },
        data: {
          graphExtractionStatus: "SUCCEEDED",
          graphFailureCode: null,
          graphFailureReason: null,
        },
      });

      return {
        runId: run.id,
        idempotent: false,
        entityCount: input.entities.length,
        relationshipCount: input.relationships.length,
      };
    });
  } catch (error) {
    if (isUnique(error)) {
      const existing = await prisma.graphExtractionRun.findUnique({
        where: { documentId_extractor_extractorVersion_model: identity },
      });
      if (existing?.status === "SUCCEEDED") {
        return {
          runId: existing.id,
          idempotent: true,
          entityCount: existing.entityCount,
          relationshipCount: existing.relationshipCount,
        };
      }
    }
    throw error;
  }
}

export async function recordGraphExtractionFailure(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    documentId: string;
    extractorVersion: string;
    model: string;
    failureCode: string;
    failureReason: string;
    rejections?: GraphRejection[];
  }
): Promise<void> {
  const identity = {
    documentId: input.documentId,
    extractor: GRAPH_EXTRACTOR,
    extractorVersion: input.extractorVersion,
    model: input.model || "unconfigured",
  };
  const existing = await prisma.graphExtractionRun.findUnique({
    where: { documentId_extractor_extractorVersion_model: identity },
  });
  if (existing?.status === "SUCCEEDED") return;

  const data = {
    status: "FAILED" as const,
    failureCode: input.failureCode,
    failureReason: input.failureReason,
    rejectedCount: input.rejections?.length ?? 0,
    diagnostics: input.rejections ? diagnosticsJson(input.rejections) : undefined,
    completedAt: new Date(),
  };
  if (existing) {
    await prisma.graphExtractionRun.update({ where: { id: existing.id }, data });
  } else {
    await prisma.graphExtractionRun.create({
      data: {
        ...identity,
        workspaceId: input.workspaceId,
        ...data,
      },
    });
  }
  await prisma.document.update({
    where: { id: input.documentId },
    data: {
      graphExtractionStatus: "FAILED",
      graphFailureCode: input.failureCode,
      graphFailureReason: input.failureReason,
    },
  });
}
