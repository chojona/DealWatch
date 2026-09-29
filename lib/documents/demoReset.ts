import type { PrismaClient } from "@prisma/client";
import { getDocumentStorage } from "./storage";
import { inspectSourceFile } from "./sourceFile";

export class DemoResetError extends Error {
  constructor(
    readonly code: "PRODUCTION" | "NOT_FOUND",
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "DemoResetError";
  }
}

export interface DemoResetRetention {
  kind: string;
  id: string;
  reason: string;
}

export interface DemoResetReport {
  documentId: string;
  removed: boolean;
  removedLabels: string[];
  retained: DemoResetRetention[];
}

/**
 * Development-only removal of one document and review data that exists only
 * for it. Shared canonical entities and assertions are kept and reported.
 * Refuses entirely in production. This is not a workspace reset.
 */
export async function resetDevelopmentDocument(
  prisma: PrismaClient,
  documentId: string
): Promise<DemoResetReport> {
  if (process.env.NODE_ENV === "production") {
    throw new DemoResetError("PRODUCTION", "Demo reset is refused in production.", 403);
  }
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, storageKey: true, dealId: true },
  });
  if (!document) throw new DemoResetError("NOT_FOUND", "Document not found", 404);

  const removedLabels: string[] = [];
  const retained: DemoResetRetention[] = [];

  const relationships = await prisma.relationshipObservation.findMany({
    where: { documentId: document.id },
    select: {
      id: true,
      promotion: {
        select: {
          id: true,
          decision: true,
          employmentId: true,
          propertyStakeId: true,
          dealParticipationId: true,
          linkedDealId: true,
        },
      },
    },
  });
  const entities = await prisma.entityObservation.findMany({
    where: { documentId: document.id },
    select: {
      id: true,
      resolutionLinks: {
        select: { id: true, personId: true, companyId: true, propertyId: true },
      },
    },
  });

  await prisma.$transaction(async (tx) => {
    const employmentIds = new Set<string>();
    const stakeIds = new Set<string>();
    const participationIds = new Set<string>();
    for (const relationship of relationships) {
      const promotion = relationship.promotion;
      if (!promotion) continue;
      if (promotion.employmentId) {
        employmentIds.add(promotion.employmentId);
        await tx.employmentSupport.deleteMany({ where: { relationshipObservationId: relationship.id } });
      }
      if (promotion.propertyStakeId) {
        stakeIds.add(promotion.propertyStakeId);
        await tx.propertyStakeSupport.deleteMany({ where: { relationshipObservationId: relationship.id } });
      }
      if (promotion.dealParticipationId) {
        participationIds.add(promotion.dealParticipationId);
        await tx.dealParticipationSupport.deleteMany({ where: { relationshipObservationId: relationship.id } });
      }
      if (promotion.linkedDealId) {
        retained.push({
          kind: "DealProperty",
          id: promotion.linkedDealId,
          reason: "The deal property link was kept. Reset does not clear a deal property that may exist outside this document.",
        });
      }
    }

    await tx.relationshipPromotionEvent.deleteMany({
      where: { relationshipObservationId: { in: relationships.map((row) => row.id) } },
    });
    await tx.relationshipPromotion.deleteMany({
      where: { relationshipObservationId: { in: relationships.map((row) => row.id) } },
    });
    for (const employmentId of employmentIds) {
      const remaining = await tx.employmentSupport.count({ where: { employmentId } });
      const employment = await tx.employment.findUnique({
        where: { id: employmentId },
        select: { id: true, assertionSource: true },
      });
      if (employment && remaining === 0 && employment.assertionSource === "OBSERVATION") {
        await tx.employment.delete({ where: { id: employment.id } });
        removedLabels.push(`Employment ${employment.id}`);
      } else if (employment) {
        retained.push({
          kind: "Employment",
          id: employment.id,
          reason: "Other evidence still supports this employment, or it was not created from this document alone.",
        });
      }
    }
    for (const stakeId of stakeIds) {
      const remaining = await tx.propertyStakeSupport.count({ where: { propertyStakeId: stakeId } });
      const stake = await tx.propertyStake.findUnique({
        where: { id: stakeId },
        select: { id: true, assertionSource: true },
      });
      if (stake && remaining === 0 && stake.assertionSource === "OBSERVATION") {
        await tx.propertyStake.delete({ where: { id: stake.id } });
        removedLabels.push(`PropertyStake ${stake.id}`);
      } else if (stake) {
        retained.push({
          kind: "PropertyStake",
          id: stake.id,
          reason: "Other evidence still supports this property stake, or it was not created from this document alone.",
        });
      }
    }
    for (const participationId of participationIds) {
      const remaining = await tx.dealParticipationSupport.count({ where: { dealParticipationId: participationId } });
      const participation = await tx.dealParticipation.findUnique({
        where: { id: participationId },
        select: { id: true, assertionSource: true },
      });
      if (participation && remaining === 0 && participation.assertionSource === "OBSERVATION") {
        await tx.dealParticipation.delete({ where: { id: participation.id } });
        removedLabels.push(`DealParticipation ${participation.id}`);
      } else if (participation) {
        retained.push({
          kind: "DealParticipation",
          id: participation.id,
          reason: "Other evidence still supports this participation, or it was not created from this document alone.",
        });
      }
    }
    await tx.observationDisposition.deleteMany({
      where: {
        OR: [
          { entityObservationId: { in: entities.map((row) => row.id) } },
          { relationshipObservationId: { in: relationships.map((row) => row.id) } },
        ],
      },
    });
    await tx.entityResolutionCandidate.deleteMany({
      where: { entityObservationId: { in: entities.map((row) => row.id) } },
    });
    const linkedPeople = new Set<string>();
    const linkedCompanies = new Set<string>();
    const linkedProperties = new Set<string>();
    for (const entity of entities) {
      for (const link of entity.resolutionLinks) {
        if (link.personId) linkedPeople.add(link.personId);
        if (link.companyId) linkedCompanies.add(link.companyId);
        if (link.propertyId) linkedProperties.add(link.propertyId);
      }
    }
    await tx.entityResolutionLink.deleteMany({
      where: { entityObservationId: { in: entities.map((row) => row.id) } },
    });
    await tx.observationSupersession.deleteMany({
      where: {
        OR: [
          { priorEntityObservationId: { in: entities.map((row) => row.id) } },
          { successorEntityObservationId: { in: entities.map((row) => row.id) } },
          { priorRelationshipObservationId: { in: relationships.map((row) => row.id) } },
          { successorRelationshipObservationId: { in: relationships.map((row) => row.id) } },
        ],
      },
    });
    await tx.relationshipObservation.deleteMany({ where: { documentId: document.id } });
    await tx.entityObservation.deleteMany({ where: { documentId: document.id } });
    await tx.graphExtractionRun.deleteMany({ where: { documentId: document.id } });
    await tx.negotiationRound.deleteMany({ where: { documentId: document.id } });
    await tx.document.delete({ where: { id: document.id } });
    removedLabels.push(`Document ${document.id}`);

    for (const personId of linkedPeople) {
      const stillUsed = await tx.entityResolutionLink.count({ where: { personId } });
      const employments = await tx.employment.count({ where: { personId } });
      const participations = await tx.dealParticipation.count({ where: { personId } });
      if (stillUsed > 0 || employments > 0 || participations > 0) {
        retained.push({
          kind: "Person",
          id: personId,
          reason: "This person is still used outside the removed document.",
        });
        continue;
      }
      try {
        await tx.personAlias.deleteMany({ where: { personId } });
        await tx.personIdentifier.deleteMany({ where: { personId } });
        await tx.person.delete({ where: { id: personId } });
        removedLabels.push(`Person ${personId}`);
      } catch {
        retained.push({
          kind: "Person",
          id: personId,
          reason: "This person still has dependent records and was kept.",
        });
      }
    }
    for (const companyId of linkedCompanies) {
      const stillUsed = await tx.entityResolutionLink.count({ where: { companyId } });
      const employments = await tx.employment.count({ where: { companyId } });
      const stakes = await tx.propertyStake.count({ where: { companyId } });
      const participations = await tx.dealParticipation.count({ where: { companyId } });
      if (stillUsed > 0 || employments > 0 || stakes > 0 || participations > 0) {
        retained.push({
          kind: "Company",
          id: companyId,
          reason: "This company is still used outside the removed document.",
        });
        continue;
      }
      try {
        await tx.companyAlias.deleteMany({ where: { companyId } });
        await tx.companyIdentifier.deleteMany({ where: { companyId } });
        await tx.company.delete({ where: { id: companyId } });
        removedLabels.push(`Company ${companyId}`);
      } catch {
        retained.push({
          kind: "Company",
          id: companyId,
          reason: "This company still has dependent records and was kept.",
        });
      }
    }
    for (const propertyId of linkedProperties) {
      const stillUsed = await tx.entityResolutionLink.count({ where: { propertyId } });
      const stakes = await tx.propertyStake.count({ where: { propertyId } });
      const deals = await tx.deal.count({ where: { propertyId } });
      if (stillUsed > 0 || stakes > 0 || deals > 0) {
        retained.push({
          kind: "Property",
          id: propertyId,
          reason: "This property is still used outside the removed document.",
        });
        continue;
      }
      try {
        await tx.propertyAlias.deleteMany({ where: { propertyId } });
        await tx.externalIdentifier.deleteMany({ where: { propertyId } });
        await tx.property.delete({ where: { id: propertyId } });
        removedLabels.push(`Property ${propertyId}`);
      } catch {
        retained.push({
          kind: "Property",
          id: propertyId,
          reason: "This property still has dependent records and was kept.",
        });
      }
    }
  });

  const source = await inspectSourceFile(getDocumentStorage(), document.storageKey);
  if (source === "AVAILABLE") {
    await getDocumentStorage().delete(document.storageKey);
    removedLabels.push("Stored PDF");
  }

  return { documentId: document.id, removed: true, removedLabels, retained };
}
