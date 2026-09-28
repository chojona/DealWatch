import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AffiliationKind,
  EntityObservation,
  ParticipationRole,
  PropertyStakePredicate,
  RelationshipObservation,
} from "@prisma/client";
import { GraphInvariantError } from "@/lib/entities/errors";
import {
  attachObservationSupport,
  createCompany,
  createDealParticipation,
  createEmployment,
  createPerson,
  createProperty,
  createPropertyStake,
  linkDealProperty,
  recordObservationDisposition,
} from "@/lib/entities/service";
import type { GraphDb } from "@/lib/entities/workspace";
import { MANUAL_REVIEW_NOTE, planIdentifiers } from "./identifiers";
import type {
  CanonicalEntityPreview,
  CanonicalEntityResult,
  CanonicalEntityType,
  DealKnowledge,
  EvidenceSupport,
  EvidenceView,
  ExistingAssertionView,
  RelationshipConflict,
  RelationshipPromotionPreview,
  RelationshipReviewStatus,
  ResolvedEndpointView,
} from "./types";

const STAKE_PREDICATES = new Set<PropertyStakePredicate>([
  "OWNS",
  "MANAGES",
  "OCCUPIES",
  "DEVELOPED",
  "LENDS_ON",
]);

type ObservationRow = EntityObservation;

function actionLabel(type: CanonicalEntityType): string {
  if (type === "PERSON") return "Create Person";
  if (type === "COMPANY") return "Create Company";
  return "Create Property";
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function loadEntityObservation(db: GraphDb, observationId: string): Promise<ObservationRow | null> {
  return db.entityObservation.findUnique({ where: { id: observationId } });
}

async function acceptedLink(db: GraphDb, observationId: string) {
  const links = await db.entityResolutionLink.findMany({
    where: { entityObservationId: observationId, status: "ACCEPTED" },
  });
  if (links.length > 1) {
    throw new GraphInvariantError("Observation has more than one accepted resolution link");
  }
  return links[0] ?? null;
}

async function resolvedEntity(
  db: GraphDb,
  observation: ObservationRow
): Promise<{ entityId: string; name: string; resolutionLinkId: string } | null> {
  const link = await acceptedLink(db, observation.id);
  if (!link) return null;
  if (link.workspaceId !== observation.workspaceId) {
    throw new GraphInvariantError("Resolution link is outside the observation workspace");
  }
  if (observation.observedType === "PERSON") {
    if (!link.personId) throw new GraphInvariantError("Accepted person link is missing its person");
    const person = await db.person.findUnique({ where: { id: link.personId } });
    if (!person || person.workspaceId !== observation.workspaceId) {
      throw new GraphInvariantError("Resolved person is outside the observation workspace");
    }
    return { entityId: person.id, name: person.canonicalName, resolutionLinkId: link.id };
  }
  if (observation.observedType === "COMPANY") {
    if (!link.companyId) throw new GraphInvariantError("Accepted company link is missing its company");
    const company = await db.company.findUnique({ where: { id: link.companyId } });
    if (!company || company.workspaceId !== observation.workspaceId) {
      throw new GraphInvariantError("Resolved company is outside the observation workspace");
    }
    return { entityId: company.id, name: company.canonicalName, resolutionLinkId: link.id };
  }
  if (observation.observedType === "PROPERTY") {
    if (!link.propertyId) throw new GraphInvariantError("Accepted property link is missing its property");
    const property = await db.property.findUnique({ where: { id: link.propertyId } });
    if (!property || property.workspaceId !== observation.workspaceId) {
      throw new GraphInvariantError("Resolved property is outside the observation workspace");
    }
    return { entityId: property.id, name: property.canonicalName, resolutionLinkId: link.id };
  }
  return null;
}

async function identifierConflicts(
  db: GraphDb,
  observation: ObservationRow,
  exceptEntityId: string | null
): Promise<string | null> {
  const plan = planIdentifiers(observation);
  const workspaceId = observation.workspaceId;
  for (const identifier of plan.personIdentifiers) {
    const existing = await db.personIdentifier.findUnique({
      where: {
        workspaceId_kind_normalizedValue: {
          workspaceId,
          kind: identifier.kind,
          normalizedValue: identifier.normalizedValue,
        },
      },
    });
    if (existing && existing.personId !== exceptEntityId) {
      return `Conflicting ${identifier.kind.toLowerCase()} identifier already belongs to another person. Promotion is blocked until that conflict is reviewed.`;
    }
  }
  if (plan.companyDomain) {
    const identifier = await db.companyIdentifier.findUnique({
      where: {
        workspaceId_kind_normalizedValue: {
          workspaceId,
          kind: "DOMAIN",
          normalizedValue: plan.companyDomain,
        },
      },
    });
    if (identifier && identifier.companyId !== exceptEntityId) {
      return "Conflicting domain identifier already belongs to another company. Promotion is blocked until that conflict is reviewed.";
    }
    const owner = await db.company.findFirst({
      where: {
        workspaceId,
        primaryDomain: plan.companyDomain,
        ...(exceptEntityId ? { id: { not: exceptEntityId } } : {}),
        status: { not: "MERGED" },
      },
    });
    if (owner) {
      return "Conflicting domain already belongs to another company. Promotion is blocked until that conflict is reviewed.";
    }
  }
  for (const external of plan.externalIdentifiers) {
    const existing = await db.externalIdentifier.findUnique({
      where: {
        workspaceId_scheme_value: {
          workspaceId,
          scheme: external.scheme,
          value: external.value,
        },
      },
    });
    if (!existing) continue;
    const ownerId = existing.propertyId ?? existing.companyId ?? existing.personId;
    if (ownerId !== exceptEntityId) {
      return "Conflicting external identifier already belongs to another record. Promotion is blocked until that conflict is reviewed.";
    }
  }
  return null;
}

export async function previewCanonicalEntity(
  prisma: GraphDb,
  observationId: string
): Promise<CanonicalEntityPreview | null> {
  const observation = await loadEntityObservation(prisma, observationId);
  if (!observation) return null;
  if (
    observation.observedType !== "PERSON" &&
    observation.observedType !== "COMPANY" &&
    observation.observedType !== "PROPERTY"
  ) {
    return null;
  }
  const plan = planIdentifiers(observation);
  const already = await resolvedEntity(prisma, observation);
  const blockedReason = already ? null : await identifierConflicts(prisma, observation, null);
  return {
    observationId: observation.id,
    workspaceId: observation.workspaceId,
    observedType: observation.observedType,
    actionLabel: actionLabel(observation.observedType),
    fields: plan.fields,
    blockedReason,
    alreadyResolved: already,
  };
}

async function writeEntity(
  db: GraphDb,
  observation: ObservationRow
): Promise<string> {
  const plan = planIdentifiers(observation);
  const workspaceId = observation.workspaceId;
  if (observation.observedType === "PERSON") {
    const person = await createPerson(db, {
      workspaceId,
      canonicalName: observation.surfaceForm,
      primaryTitle: observation.title,
      identifiers: plan.personIdentifiers.map((identifier) => ({
        kind: identifier.kind,
        value: identifier.value,
      })),
    });
    return person.id;
  }
  if (observation.observedType === "COMPANY") {
    const company = await createCompany(db, {
      workspaceId,
      canonicalName: observation.surfaceForm,
      website: plan.companyWebsite,
      primaryDomain: plan.companyDomain,
      identifiers: plan.companyDomain
        ? [{ kind: "DOMAIN" as const, value: plan.companyDomain }]
        : [],
    });
    return company.id;
  }
  const property = await createProperty(db, {
    workspaceId,
    canonicalName: observation.surfaceForm,
    addressLine1: observation.addressLine1,
    city: observation.city,
    region: observation.region,
    postalCode: observation.postalCode,
    country: observation.country,
    externalIdentifiers: plan.externalIdentifiers,
  });
  return property.id;
}

function linkData(type: CanonicalEntityType, entityId: string) {
  return {
    personId: type === "PERSON" ? entityId : null,
    companyId: type === "COMPANY" ? entityId : null,
    propertyId: type === "PROPERTY" ? entityId : null,
  };
}

async function createFromObservation(
  db: GraphDb,
  observationId: string
): Promise<CanonicalEntityResult | null> {
  const observation = await loadEntityObservation(db, observationId);
  if (!observation) return null;
  if (
    observation.observedType !== "PERSON" &&
    observation.observedType !== "COMPANY" &&
    observation.observedType !== "PROPERTY"
  ) {
    throw new GraphInvariantError("Only person, company, and property observations can be promoted");
  }
  const type = observation.observedType;
  const existing = await resolvedEntity(db, observation);
  if (existing) {
    return {
      observationId: observation.id,
      workspaceId: observation.workspaceId,
      observedType: type,
      entityId: existing.entityId,
      resolutionLinkId: existing.resolutionLinkId,
      idempotent: true,
    };
  }
  const blocked = await identifierConflicts(db, observation, null);
  if (blocked) throw new GraphInvariantError(blocked);

  const before = await db.entityObservation.findUniqueOrThrow({ where: { id: observation.id } });
  const entityId = await writeEntity(db, observation);
  const link = await db.entityResolutionLink.create({
    data: {
      workspaceId: observation.workspaceId,
      entityObservationId: observation.id,
      ...linkData(type, entityId),
      method: "MANUAL",
      resolutionConfidence: 1,
      status: "ACCEPTED",
    },
  });
  await db.entityResolutionCandidate.updateMany({
    where: {
      entityObservationId: observation.id,
      workspaceId: observation.workspaceId,
      decision: "PENDING",
    },
    data: {
      decision: "REJECTED",
      decidedAt: new Date(),
      decisionReason: "Reviewer created a new canonical entity from this observation",
    },
  });
  await recordObservationDisposition(db, {
    entityObservationId: observation.id,
    disposition: "ACCEPTED",
    actor: "SYSTEM",
    note: MANUAL_REVIEW_NOTE,
  });
  const after = await db.entityObservation.findUniqueOrThrow({ where: { id: observation.id } });
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new GraphInvariantError("Promotion must not change the observation");
  }
  return {
    observationId: observation.id,
    workspaceId: observation.workspaceId,
    observedType: type,
    entityId,
    resolutionLinkId: link.id,
    idempotent: false,
  };
}

export async function createCanonicalEntityFromObservation(
  prisma: PrismaClient,
  observationId: string
): Promise<CanonicalEntityResult | null> {
  try {
    return await prisma.$transaction((tx) => createFromObservation(tx, observationId));
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    const observation = await loadEntityObservation(prisma, observationId);
    if (!observation) return null;
    const existing = await resolvedEntity(prisma, observation);
    if (!existing) throw error;
    return {
      observationId: observation.id,
      workspaceId: observation.workspaceId,
      observedType: observation.observedType as CanonicalEntityType,
      entityId: existing.entityId,
      resolutionLinkId: existing.resolutionLinkId,
      idempotent: true,
    };
  }
}

type EndpointResolution = {
  view: ResolvedEndpointView;
  entityId: string | null;
  entityType: "PERSON" | "COMPANY" | "PROPERTY" | null;
};

async function resolveEndpoint(
  db: GraphDb,
  role: ResolvedEndpointView["role"],
  observationId: string,
  workspaceId: string
): Promise<EndpointResolution> {
  const observation = await db.entityObservation.findUnique({ where: { id: observationId } });
  if (!observation) throw new GraphInvariantError("Relationship endpoint observation does not exist");
  if (observation.workspaceId !== workspaceId) {
    throw new GraphInvariantError("Relationship endpoint is outside the relationship workspace");
  }
  const resolved = await resolvedEntity(db, observation);
  return {
    entityId: resolved?.entityId ?? null,
    entityType:
      observation.observedType === "PERSON" ||
      observation.observedType === "COMPANY" ||
      observation.observedType === "PROPERTY"
        ? observation.observedType
        : null,
    view: {
      role,
      observationId: observation.id,
      surfaceForm: observation.surfaceForm,
      observedType: observation.observedType,
      resolved: Boolean(resolved),
      entityId: resolved?.entityId ?? null,
      entityName: resolved?.name ?? null,
    },
  };
}

function roleLabel(role: string, custom: string | null): string {
  if (role === "OTHER" && custom) return custom;
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function loadRelationship(db: GraphDb, relationshipObservationId: string) {
  return db.relationshipObservation.findUnique({
    where: { id: relationshipObservationId },
    include: {
      document: { select: { id: true, originalFilename: true } },
      documentPage: { select: { pageNumber: true } },
      promotion: true,
      contextDeal: { select: { id: true, name: true, propertyId: true, workspaceId: true } },
    },
  });
}

type LoadedRelationship = NonNullable<Awaited<ReturnType<typeof loadRelationship>>>;

async function buildRelationshipPreview(
  db: GraphDb,
  relationship: LoadedRelationship
): Promise<RelationshipPromotionPreview> {
  const endpoints: EndpointResolution[] = [
    await resolveEndpoint(db, "subject", relationship.subjectObservationId, relationship.workspaceId),
  ];
  if (relationship.objectObservationId) {
    endpoints.push(
      await resolveEndpoint(db, "object", relationship.objectObservationId, relationship.workspaceId)
    );
  }
  if (relationship.principalObservationId) {
    endpoints.push(
      await resolveEndpoint(db, "principal", relationship.principalObservationId, relationship.workspaceId)
    );
  }
  const unresolved = endpoints.some((endpoint) => !endpoint.view.resolved);
  const subject = endpoints.find((endpoint) => endpoint.view.role === "subject")!;
  const object = endpoints.find((endpoint) => endpoint.view.role === "object") ?? null;
  const principal = endpoints.find((endpoint) => endpoint.view.role === "principal") ?? null;
  const subjectName = subject.view.entityName ?? subject.view.surfaceForm;
  const objectName = object ? object.view.entityName ?? object.view.surfaceForm : null;
  const principalName = principal ? principal.view.entityName ?? principal.view.surfaceForm : null;
  const dealName = relationship.contextDeal?.name ?? "this deal";

  const conflicts: RelationshipConflict[] = [];
  let existingAssertion: ExistingAssertionView | null = null;
  let blockReason: string | null = null;
  const lines: RelationshipPromotionPreview["assertionLines"] = [];

  if (unresolved) {
    blockReason = "An endpoint observation is still unresolved.";
  }

  if (relationship.predicate === "WORKS_AT") {
    lines.push({ label: "Person", value: subjectName, note: null });
    lines.push({ label: "Relationship", value: "WORKS_AT", note: null });
    lines.push({ label: "Company", value: objectName ?? "Unresolved company", note: null });
    const affiliation = relationship.affiliationKind ?? "UNKNOWN";
    lines.push({ label: "Affiliation", value: affiliation, note: null });
    if (relationship.statedTitle) {
      lines.push({ label: "Title", value: relationship.statedTitle, note: "Kept on the observation. Not used to close another employment." });
    }
    if (subject.entityId && object?.entityId && !unresolved) {
      const others = await db.employment.findMany({
        where: {
          workspaceId: relationship.workspaceId,
          personId: subject.entityId,
          status: "ASSERTED",
          NOT: { companyId: object.entityId, affiliationKind: affiliation },
        },
        include: { company: { select: { canonicalName: true } } },
      });
      for (const other of others) {
        if (other.companyId === object.entityId && other.affiliationKind === affiliation) continue;
        conflicts.push({
          severity: "info",
          message: `Potential conflict / temporal change: ${subjectName} also has an open employment at ${other.company.canonicalName} (${other.affiliationKind}). Approving keeps both. Neither is closed.`,
        });
      }
      const match = await db.employment.findFirst({
        where: {
          workspaceId: relationship.workspaceId,
          personId: subject.entityId,
          companyId: object.entityId,
          affiliationKind: affiliation,
          status: "ASSERTED",
        },
      });
      if (match) {
        existingAssertion = {
          kind: "Employment",
          id: match.id,
          summary: `${subjectName} already works at ${objectName} as ${affiliation}. Approval attaches another support record.`,
        };
      }
    }
  } else if (STAKE_PREDICATES.has(relationship.predicate as PropertyStakePredicate)) {
    const predicate = relationship.predicate as PropertyStakePredicate;
    lines.push({ label: "Company", value: subjectName, note: null });
    lines.push({ label: "Relationship", value: predicate, note: null });
    lines.push({ label: "Property", value: objectName ?? "Unresolved property", note: null });
    if (subject.entityId && object?.entityId && !unresolved) {
      const competitors = await db.propertyStake.findMany({
        where: {
          workspaceId: relationship.workspaceId,
          propertyId: object.entityId,
          predicate,
          status: "ASSERTED",
          companyId: { not: subject.entityId },
        },
        include: { company: { select: { canonicalName: true } } },
      });
      for (const competitor of competitors) {
        conflicts.push({
          severity: "info",
          message: `Competing ${predicate}: ${competitor.company.canonicalName} already has an open assertion. Approving does not replace it.`,
        });
      }
      const match = await db.propertyStake.findFirst({
        where: {
          workspaceId: relationship.workspaceId,
          companyId: subject.entityId,
          propertyId: object.entityId,
          predicate,
          status: "ASSERTED",
        },
      });
      if (match) {
        existingAssertion = {
          kind: "PropertyStake",
          id: match.id,
          summary: `${subjectName} already has ${predicate} on ${objectName}. Approval attaches another support record.`,
        };
      }
    }
  } else if (relationship.predicate === "PARTICIPATES_AS") {
    const role = relationship.participationRole;
    lines.push({ label: "Participant", value: subjectName, note: null });
    lines.push({ label: "Role", value: role ? roleLabel(role, relationship.roleLabel) : "Missing role", note: null });
    lines.push({ label: "Deal", value: dealName, note: null });
    if (principalName) lines.push({ label: "Represents", value: principalName, note: null });
    if (!relationship.contextDealId || !relationship.contextDeal) {
      blockReason = blockReason ?? "Participation has no deal context.";
    } else if (relationship.contextDeal.workspaceId !== relationship.workspaceId) {
      blockReason = "Deal context is outside the relationship workspace.";
    }
    if (!role) blockReason = blockReason ?? "Participation role is missing.";
    if (subject.entityId && role && relationship.contextDeal && !unresolved) {
      const representsCompanyId = principal?.entityType === "COMPANY" ? principal.entityId : null;
      const actorFilter =
        subject.entityType === "PERSON"
          ? { personId: subject.entityId }
          : { companyId: subject.entityId };
      const match = await db.dealParticipation.findFirst({
        where: {
          workspaceId: relationship.workspaceId,
          dealId: relationship.contextDeal.id,
          role,
          status: "ASSERTED",
          ...actorFilter,
        },
      });
      if (match && match.representsCompanyId !== representsCompanyId) {
        blockReason =
          "An open participation already exists for this actor, deal, and role with different representation. It was not overwritten.";
        conflicts.push({ severity: "block", message: blockReason });
      } else if (match) {
        existingAssertion = {
          kind: "DealParticipation",
          id: match.id,
          summary: `${subjectName} already participates as ${roleLabel(role, relationship.roleLabel)}. Approval attaches another support record.`,
        };
      }
    }
  } else if (relationship.predicate === "CONCERNS_PROPERTY") {
    lines.push({ label: "Deal", value: dealName, note: null });
    lines.push({ label: "Property", value: subjectName, note: null });
    if (!relationship.contextDeal) {
      blockReason = blockReason ?? "The deal this property concerns is missing.";
    } else if (subject.entityId && !unresolved) {
      const currentId = relationship.contextDeal.propertyId;
      if (currentId && currentId !== subject.entityId) {
        const current = await db.property.findUnique({ where: { id: currentId } });
        blockReason = `This deal is already linked to ${current?.canonicalName ?? "another property"}. That link was not replaced.`;
        conflicts.push({ severity: "block", message: blockReason });
      } else if (currentId === subject.entityId) {
        existingAssertion = {
          kind: "DealProperty",
          id: relationship.contextDeal.id,
          summary: `${dealName} already concerns ${subjectName}. Approval records another supporting observation.`,
        };
      }
    }
  } else {
    blockReason = "This predicate cannot be promoted.";
  }

  const stored = relationship.promotion;
  let status: RelationshipReviewStatus = "PENDING";
  if (stored?.decision === "APPROVED") status = "APPROVED";
  else if (stored?.decision === "REJECTED") status = "REJECTED";
  else if (unresolved) status = "BLOCKED_UNRESOLVED_ENTITY";

  const canApprove = status !== "APPROVED" && status !== "REJECTED" ? !blockReason : status === "REJECTED" && !blockReason;
  const headline =
    relationship.predicate === "PARTICIPATES_AS"
      ? `${subjectName} · ${relationship.participationRole ? roleLabel(relationship.participationRole, relationship.roleLabel) : "Participant"}`
      : relationship.predicate === "CONCERNS_PROPERTY"
        ? `${dealName} concerns ${subjectName}`
        : `${subjectName} ${relationship.predicate} ${objectName ?? ""}`.trim();

  const canonical = stored?.decision === "APPROVED"
    ? stored.employmentId
      ? { kind: "Employment" as const, id: stored.employmentId }
      : stored.propertyStakeId
        ? { kind: "PropertyStake" as const, id: stored.propertyStakeId }
        : stored.dealParticipationId
          ? { kind: "DealParticipation" as const, id: stored.dealParticipationId }
          : stored.linkedDealId
            ? { kind: "DealProperty" as const, id: stored.linkedDealId }
            : null
    : null;

  return {
    relationshipObservationId: relationship.id,
    workspaceId: relationship.workspaceId,
    predicate: relationship.predicate,
    status,
    canApprove: status === "APPROVED" ? false : Boolean(canApprove),
    blockReason: status === "APPROVED" || status === "REJECTED" ? null : blockReason,
    headline,
    assertionLines: lines,
    evidenceQuote: relationship.evidenceQuote,
    provenanceStatus: relationship.provenanceStatus,
    pageNumber: relationship.documentPage?.pageNumber ?? null,
    documentId: relationship.document?.id ?? null,
    documentName: relationship.document?.originalFilename ?? null,
    messageId: relationship.messageId,
    sourceKind: relationship.sourceKind,
    sourceLocation: relationship.sourceLocation,
    endpoints: endpoints.map((endpoint) => endpoint.view),
    conflicts,
    existingAssertion,
    reviewReason: stored?.reviewReason ?? null,
    reviewedAt: stored?.reviewedAt.toISOString() ?? null,
    actor: stored?.actor ?? null,
    canonical,
  };
}

export async function previewRelationshipPromotion(
  prisma: GraphDb,
  relationshipObservationId: string
): Promise<RelationshipPromotionPreview | null> {
  const relationship = await loadRelationship(prisma, relationshipObservationId);
  if (!relationship) return null;
  return buildRelationshipPreview(prisma, relationship);
}

export async function listDocumentRelationshipPromotions(
  prisma: PrismaClient,
  documentId: string
): Promise<RelationshipPromotionPreview[] | null> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true },
  });
  if (!document) return null;
  const rows = await prisma.relationshipObservation.findMany({
    where: { documentId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const previews: RelationshipPromotionPreview[] = [];
  for (const row of rows) {
    const preview = await previewRelationshipPromotion(prisma, row.id);
    if (preview) previews.push(preview);
  }
  return previews;
}

async function findOrCreateAssertion(
  db: GraphDb,
  relationship: RelationshipObservation,
  subject: EndpointResolution,
  object: EndpointResolution | null,
  principal: EndpointResolution | null
): Promise<{ kind: ExistingAssertionView["kind"]; id: string; created: boolean }> {
  const workspaceId = relationship.workspaceId;
  if (relationship.predicate === "WORKS_AT") {
    if (subject.entityType !== "PERSON" || !subject.entityId || object?.entityType !== "COMPANY" || !object.entityId) {
      throw new GraphInvariantError("WORKS_AT requires a resolved person and company");
    }
    const affiliationKind = (relationship.affiliationKind ?? "UNKNOWN") as AffiliationKind;
    const existing = await db.employment.findFirst({
      where: {
        workspaceId,
        personId: subject.entityId,
        companyId: object.entityId,
        affiliationKind,
        status: "ASSERTED",
      },
    });
    if (existing) return { kind: "Employment", id: existing.id, created: false };
    const created = await createEmployment(db, {
      workspaceId,
      personId: subject.entityId,
      companyId: object.entityId,
      affiliationKind,
      titleAtTime: relationship.statedTitle,
      assertionSource: "OBSERVATION",
    });
    return { kind: "Employment", id: created.id, created: true };
  }

  if (STAKE_PREDICATES.has(relationship.predicate as PropertyStakePredicate)) {
    const predicate = relationship.predicate as PropertyStakePredicate;
    if (subject.entityType !== "COMPANY" || !subject.entityId || object?.entityType !== "PROPERTY" || !object.entityId) {
      throw new GraphInvariantError("A property stake requires a resolved company and property");
    }
    const existing = await db.propertyStake.findFirst({
      where: {
        workspaceId,
        companyId: subject.entityId,
        propertyId: object.entityId,
        predicate,
        status: "ASSERTED",
      },
    });
    if (existing) return { kind: "PropertyStake", id: existing.id, created: false };
    const created = await createPropertyStake(db, {
      workspaceId,
      companyId: subject.entityId,
      propertyId: object.entityId,
      predicate,
      assertionSource: "OBSERVATION",
    });
    return { kind: "PropertyStake", id: created.id, created: true };
  }

  if (relationship.predicate === "PARTICIPATES_AS") {
    if (!relationship.participationRole || !relationship.contextDealId) {
      throw new GraphInvariantError("Participation requires a role and a deal");
    }
    const deal = await db.deal.findUnique({ where: { id: relationship.contextDealId } });
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new GraphInvariantError("Participation deal is missing or outside the workspace");
    }
    const representsCompanyId = principal?.entityType === "COMPANY" ? principal.entityId : null;
    const actor =
      subject.entityType === "PERSON"
        ? { personId: subject.entityId, companyId: null }
        : { personId: null, companyId: subject.entityId };
    if (!actor.personId && !actor.companyId) {
      throw new GraphInvariantError("Participation actor is unresolved");
    }
    const existing = await db.dealParticipation.findFirst({
      where: {
        workspaceId,
        dealId: deal.id,
        role: relationship.participationRole,
        status: "ASSERTED",
        ...(actor.personId ? { personId: actor.personId } : { companyId: actor.companyId }),
      },
    });
    if (existing) {
      if (existing.representsCompanyId !== representsCompanyId) {
        throw new GraphInvariantError(
          "An open participation already exists for this actor, deal, and role with different representation. It was not overwritten."
        );
      }
      return { kind: "DealParticipation", id: existing.id, created: false };
    }
    const created = await createDealParticipation(db, {
      workspaceId,
      dealId: deal.id,
      role: relationship.participationRole as ParticipationRole,
      roleLabel: relationship.roleLabel,
      personId: actor.personId,
      companyId: actor.companyId,
      representsCompanyId,
      assertionSource: "OBSERVATION",
    });
    return { kind: "DealParticipation", id: created.id, created: true };
  }

  if (relationship.predicate === "CONCERNS_PROPERTY") {
    if (subject.entityType !== "PROPERTY" || !subject.entityId || !relationship.contextDealId) {
      throw new GraphInvariantError("CONCERNS_PROPERTY requires a resolved property and a deal");
    }
    const deal = await db.deal.findUnique({ where: { id: relationship.contextDealId } });
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new GraphInvariantError("The deal is missing or outside the workspace");
    }
    if (deal.propertyId && deal.propertyId !== subject.entityId) {
      throw new GraphInvariantError("This deal is already linked to a different property. That link was not replaced.");
    }
    if (!deal.propertyId) {
      await linkDealProperty(db, {
        workspaceId,
        dealId: deal.id,
        propertyId: subject.entityId,
      });
    }
    return { kind: "DealProperty", id: deal.id, created: !deal.propertyId };
  }

  throw new GraphInvariantError("This predicate cannot be promoted");
}

async function attachSupport(
  db: GraphDb,
  relationship: RelationshipObservation,
  assertion: { kind: ExistingAssertionView["kind"]; id: string }
) {
  if (assertion.kind === "DealProperty") return;
  const existing =
    assertion.kind === "Employment"
      ? await db.employmentSupport.findUnique({
          where: {
            employmentId_relationshipObservationId: {
              employmentId: assertion.id,
              relationshipObservationId: relationship.id,
            },
          },
        })
      : assertion.kind === "PropertyStake"
        ? await db.propertyStakeSupport.findUnique({
            where: {
              propertyStakeId_relationshipObservationId: {
                propertyStakeId: assertion.id,
                relationshipObservationId: relationship.id,
              },
            },
          })
        : await db.dealParticipationSupport.findUnique({
            where: {
              dealParticipationId_relationshipObservationId: {
                dealParticipationId: assertion.id,
                relationshipObservationId: relationship.id,
              },
            },
          });
  if (existing) return;
  await attachObservationSupport(db, {
    workspaceId: relationship.workspaceId,
    relationshipObservationId: relationship.id,
    employmentId: assertion.kind === "Employment" ? assertion.id : null,
    propertyStakeId: assertion.kind === "PropertyStake" ? assertion.id : null,
    dealParticipationId: assertion.kind === "DealParticipation" ? assertion.id : null,
  });
}

async function approveInTransaction(
  db: GraphDb,
  relationshipObservationId: string,
  reviewReason: string | null
) {
  const relationship = await loadRelationship(db, relationshipObservationId);
  if (!relationship) return null;
  const before = await db.relationshipObservation.findUniqueOrThrow({
    where: { id: relationship.id },
  });
  if (relationship.promotion?.decision === "APPROVED" && relationship.promotion.employmentId) {
    return {
      relationshipObservationId: relationship.id,
      decision: "APPROVED" as const,
      idempotent: true,
      canonicalKind: "Employment" as const,
      canonicalId: relationship.promotion.employmentId,
    };
  }
  if (relationship.promotion?.decision === "APPROVED" && relationship.promotion.propertyStakeId) {
    return {
      relationshipObservationId: relationship.id,
      decision: "APPROVED" as const,
      idempotent: true,
      canonicalKind: "PropertyStake" as const,
      canonicalId: relationship.promotion.propertyStakeId,
    };
  }
  if (relationship.promotion?.decision === "APPROVED" && relationship.promotion.dealParticipationId) {
    return {
      relationshipObservationId: relationship.id,
      decision: "APPROVED" as const,
      idempotent: true,
      canonicalKind: "DealParticipation" as const,
      canonicalId: relationship.promotion.dealParticipationId,
    };
  }
  if (relationship.promotion?.decision === "APPROVED" && relationship.promotion.linkedDealId) {
    return {
      relationshipObservationId: relationship.id,
      decision: "APPROVED" as const,
      idempotent: true,
      canonicalKind: "DealProperty" as const,
      canonicalId: relationship.promotion.linkedDealId,
    };
  }

  const preview = await buildRelationshipPreview(db, relationship);
  if (preview.status === "BLOCKED_UNRESOLVED_ENTITY" || preview.blockReason) {
    throw new GraphInvariantError(preview.blockReason ?? "An endpoint observation is still unresolved.");
  }

  const subject = await resolveEndpoint(db, "subject", relationship.subjectObservationId, relationship.workspaceId);
  const object = relationship.objectObservationId
    ? await resolveEndpoint(db, "object", relationship.objectObservationId, relationship.workspaceId)
    : null;
  const principal = relationship.principalObservationId
    ? await resolveEndpoint(db, "principal", relationship.principalObservationId, relationship.workspaceId)
    : null;
  if (!subject.view.resolved || (object && !object.view.resolved) || (principal && !principal.view.resolved)) {
    throw new GraphInvariantError("An endpoint observation is still unresolved.");
  }

  const assertion = await findOrCreateAssertion(db, relationship, subject, object, principal);
  await attachSupport(db, relationship, assertion);
  const reviewedAt = new Date();
  const data = {
    decision: "APPROVED" as const,
    reviewReason,
    reviewedAt,
    actor: "MANUAL_REVIEW" as const,
    employmentId: assertion.kind === "Employment" ? assertion.id : null,
    propertyStakeId: assertion.kind === "PropertyStake" ? assertion.id : null,
    dealParticipationId: assertion.kind === "DealParticipation" ? assertion.id : null,
    linkedDealId: assertion.kind === "DealProperty" ? assertion.id : null,
  };
  if (relationship.promotion) {
    await db.relationshipPromotion.update({
      where: { id: relationship.promotion.id },
      data,
    });
  } else {
    await db.relationshipPromotion.create({
      data: {
        workspaceId: relationship.workspaceId,
        relationshipObservationId: relationship.id,
        ...data,
      },
    });
  }
  await recordObservationDisposition(db, {
    relationshipObservationId: relationship.id,
    disposition: "ACCEPTED",
    actor: "SYSTEM",
    note: reviewReason ? `${MANUAL_REVIEW_NOTE} ${reviewReason}` : MANUAL_REVIEW_NOTE,
  });
  const after = await db.relationshipObservation.findUniqueOrThrow({ where: { id: relationship.id } });
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new GraphInvariantError("Promotion must not change the relationship observation");
  }
  return {
    relationshipObservationId: relationship.id,
    decision: "APPROVED" as const,
    idempotent: false,
    canonicalKind: assertion.kind,
    canonicalId: assertion.id,
  };
}

export async function approveRelationshipObservation(
  prisma: PrismaClient,
  relationshipObservationId: string,
  reviewReason?: string | null
) {
  return prisma.$transaction((tx) =>
    approveInTransaction(tx, relationshipObservationId, reviewReason ?? null)
  );
}

export async function rejectRelationshipObservation(
  prisma: PrismaClient,
  relationshipObservationId: string,
  reviewReason?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const relationship = await loadRelationship(tx, relationshipObservationId);
    if (!relationship) return null;
    if (relationship.promotion?.decision === "APPROVED") {
      throw new GraphInvariantError(
        "An approved relationship stays in the canonical graph. Removing it is deferred."
      );
    }
    if (relationship.promotion?.decision === "REJECTED") {
      return {
        relationshipObservationId: relationship.id,
        decision: "REJECTED" as const,
        idempotent: true,
      };
    }
    const beforeCounts = {
      employments: await tx.employment.count({ where: { workspaceId: relationship.workspaceId } }),
      stakes: await tx.propertyStake.count({ where: { workspaceId: relationship.workspaceId } }),
      participations: await tx.dealParticipation.count({ where: { workspaceId: relationship.workspaceId } }),
    };
    const reviewedAt = new Date();
    const reason = reviewReason ?? "Rejected by a reviewer";
    if (relationship.promotion) {
      await tx.relationshipPromotion.update({
        where: { id: relationship.promotion.id },
        data: { decision: "REJECTED", reviewReason: reason, reviewedAt, actor: "MANUAL_REVIEW" },
      });
    } else {
      await tx.relationshipPromotion.create({
        data: {
          workspaceId: relationship.workspaceId,
          relationshipObservationId: relationship.id,
          decision: "REJECTED",
          reviewReason: reason,
          reviewedAt,
          actor: "MANUAL_REVIEW",
        },
      });
    }
    await recordObservationDisposition(tx, {
      relationshipObservationId: relationship.id,
      disposition: "REJECTED",
      actor: "SYSTEM",
      note: `${MANUAL_REVIEW_NOTE} ${reason}`,
    });
    const afterCounts = {
      employments: await tx.employment.count({ where: { workspaceId: relationship.workspaceId } }),
      stakes: await tx.propertyStake.count({ where: { workspaceId: relationship.workspaceId } }),
      participations: await tx.dealParticipation.count({ where: { workspaceId: relationship.workspaceId } }),
    };
    if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) {
      throw new GraphInvariantError("Reject must not create canonical truth");
    }
    return {
      relationshipObservationId: relationship.id,
      decision: "REJECTED" as const,
      idempotent: false,
    };
  });
}

function supportView(input: {
  id: string;
  evidenceQuote: string;
  provenanceStatus: EvidenceSupport["provenanceStatus"];
  sourceKind: string;
  sourceLocation: string | null;
  messageId: string | null;
  document: { id: string; originalFilename: string } | null;
  documentPage: { pageNumber: number } | null;
}): EvidenceSupport {
  const pageNumber = input.provenanceStatus === "EXACT" ? input.documentPage?.pageNumber ?? null : null;
  const href =
    input.document && pageNumber
      ? `/api/documents/${input.document.id}/file#page=${pageNumber}`
      : input.document
        ? `/api/documents/${input.document.id}/file`
        : null;
  return {
    observationId: input.id,
    quote: input.evidenceQuote,
    provenanceStatus: input.provenanceStatus,
    pageNumber,
    documentId: input.document?.id ?? null,
    documentName: input.document?.originalFilename ?? null,
    messageId: input.messageId,
    sourceKind: input.sourceKind,
    sourceLocation: input.sourceLocation,
    href,
  };
}

const evidenceInclude = {
  document: { select: { id: true, originalFilename: true } },
  documentPage: { select: { pageNumber: true } },
} as const;

export async function getRelationshipEvidence(
  prisma: GraphDb,
  input: {
    employmentId?: string;
    propertyStakeId?: string;
    dealParticipationId?: string;
    dealId?: string;
  }
): Promise<EvidenceView | null> {
  const targets = [input.employmentId, input.propertyStakeId, input.dealParticipationId, input.dealId].filter(Boolean);
  if (targets.length !== 1) {
    throw new GraphInvariantError("Evidence is read for exactly one canonical assertion");
  }
  if (input.employmentId) {
    const employment = await prisma.employment.findUnique({
      where: { id: input.employmentId },
      include: { person: true, company: true },
    });
    if (!employment) return null;
    const supports = await prisma.employmentSupport.findMany({
      where: { employmentId: employment.id },
      include: { relationshipObservation: { include: evidenceInclude } },
      orderBy: { createdAt: "asc" },
    });
    return {
      title: `${employment.person.canonicalName} works at ${employment.company.canonicalName}`,
      supportCount: supports.length,
      supports: supports.map((support) => supportView(support.relationshipObservation)),
    };
  }
  if (input.propertyStakeId) {
    const stake = await prisma.propertyStake.findUnique({
      where: { id: input.propertyStakeId },
      include: { company: true, property: true },
    });
    if (!stake) return null;
    const supports = await prisma.propertyStakeSupport.findMany({
      where: { propertyStakeId: stake.id },
      include: { relationshipObservation: { include: evidenceInclude } },
      orderBy: { createdAt: "asc" },
    });
    return {
      title: `${stake.company.canonicalName} ${stake.predicate} ${stake.property.canonicalName}`,
      supportCount: supports.length,
      supports: supports.map((support) => supportView(support.relationshipObservation)),
    };
  }
  if (input.dealParticipationId) {
    const participation = await prisma.dealParticipation.findUnique({
      where: { id: input.dealParticipationId },
      include: { person: true, company: true, represents: true, deal: true },
    });
    if (!participation) return null;
    const supports = await prisma.dealParticipationSupport.findMany({
      where: { dealParticipationId: participation.id },
      include: { relationshipObservation: { include: evidenceInclude } },
      orderBy: { createdAt: "asc" },
    });
    const actor = participation.person?.canonicalName ?? participation.company?.canonicalName ?? "Participant";
    return {
      title: `${actor} · ${roleLabel(participation.role, participation.roleLabel)} on ${participation.deal.name}`,
      supportCount: supports.length,
      supports: supports.map((support) => supportView(support.relationshipObservation)),
    };
  }
  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId! },
    include: { canonicalProperty: true },
  });
  if (!deal) return null;
  const promotions = await prisma.relationshipPromotion.findMany({
    where: { linkedDealId: deal.id, decision: "APPROVED" },
    include: { relationshipObservation: { include: evidenceInclude } },
    orderBy: { createdAt: "asc" },
  });
  return {
    title: deal.canonicalProperty
      ? `${deal.name} concerns ${deal.canonicalProperty.canonicalName}`
      : `${deal.name} property link`,
    supportCount: promotions.length,
    supports: promotions.map((promotion) => supportView(promotion.relationshipObservation)),
  };
}

function addressOf(property: {
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}): string {
  return [property.addressLine1, property.city, property.region, property.postalCode].filter(Boolean).join(", ");
}

export async function getDealKnowledge(prisma: PrismaClient, dealId: string): Promise<DealKnowledge | null> {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { canonicalProperty: true },
  });
  if (!deal) return null;
  const participations = await prisma.dealParticipation.findMany({
    where: { workspaceId: deal.workspaceId, dealId: deal.id, status: "ASSERTED" },
    include: { person: true, company: true, represents: true },
    orderBy: { createdAt: "asc" },
  });
  const personIds = participations.map((row) => row.personId).filter((id): id is string => Boolean(id));
  const employments = await prisma.employment.findMany({
    where: {
      workspaceId: deal.workspaceId,
      status: "ASSERTED",
      OR: [
        ...(personIds.length ? [{ personId: { in: personIds } }] : []),
        {
          supports: {
            some: {
              relationshipObservation: {
                OR: [{ dealId: deal.id }, { contextDealId: deal.id }],
              },
            },
          },
        },
      ],
    },
    include: { person: true, company: true },
    orderBy: { createdAt: "asc" },
  });
  const stakes = deal.propertyId
    ? await prisma.propertyStake.findMany({
        where: { workspaceId: deal.workspaceId, propertyId: deal.propertyId, status: "ASSERTED" },
        include: { company: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const entityRows = await prisma.entityObservation.findMany({
    where: { workspaceId: deal.workspaceId, dealId: deal.id },
    orderBy: { createdAt: "asc" },
  });
  const pendingEntities = [];
  for (const observation of entityRows) {
    const link = await acceptedLink(prisma, observation.id);
    if (link) continue;
    pendingEntities.push({
      id: observation.id,
      observedType: observation.observedType,
      surfaceForm: observation.surfaceForm,
      evidenceQuote: observation.evidenceQuote,
    });
  }
  const relationshipRows = await prisma.relationshipObservation.findMany({
    where: {
      workspaceId: deal.workspaceId,
      OR: [{ dealId: deal.id }, { contextDealId: deal.id }],
    },
    orderBy: { createdAt: "asc" },
  });
  const pendingRelationships = [];
  for (const relationship of relationshipRows) {
    const preview = await previewRelationshipPromotion(prisma, relationship.id);
    if (!preview || preview.status === "APPROVED") continue;
    pendingRelationships.push({
      id: relationship.id,
      predicate: relationship.predicate,
      status: preview.status,
      evidenceQuote: relationship.evidenceQuote,
      headline: preview.headline,
    });
  }

  const people = new Map<string, DealKnowledge["canonical"]["people"][number]>();
  for (const participation of participations) {
    if (!participation.person) continue;
    const current = people.get(participation.person.id) ?? {
      personId: participation.person.id,
      name: participation.person.canonicalName,
      roles: [],
      employers: [],
    };
    current.roles.push(roleLabel(participation.role, participation.roleLabel));
    people.set(participation.person.id, current);
  }
  for (const employment of employments) {
    const current = people.get(employment.personId) ?? {
      personId: employment.personId,
      name: employment.person.canonicalName,
      roles: [],
      employers: [],
    };
    current.employers.push({
      employmentId: employment.id,
      companyName: employment.company.canonicalName,
      affiliationKind: employment.affiliationKind,
      titleAtTime: employment.titleAtTime,
    });
    people.set(employment.personId, current);
  }

  return {
    dealId: deal.id,
    dealName: deal.name,
    workspaceId: deal.workspaceId,
    propertyLabel: deal.property,
    canonical: {
      property: deal.canonicalProperty
        ? {
            id: deal.canonicalProperty.id,
            name: deal.canonicalProperty.canonicalName,
            address: addressOf(deal.canonicalProperty),
            evidence: (await getRelationshipEvidence(prisma, { dealId: deal.id }))!,
          }
        : null,
      stakes: await Promise.all(
        stakes.map(async (stake) => ({
          id: stake.id,
          predicate: stake.predicate,
          companyName: stake.company.canonicalName,
          evidence: (await getRelationshipEvidence(prisma, { propertyStakeId: stake.id }))!,
        }))
      ),
      participations: await Promise.all(
        participations.map(async (participation) => ({
          id: participation.id,
          role: participation.role,
          roleLabel: participation.roleLabel,
          actorName: participation.person?.canonicalName ?? participation.company?.canonicalName ?? "Unknown",
          representsCompanyName: participation.represents?.canonicalName ?? null,
          evidence: (await getRelationshipEvidence(prisma, { dealParticipationId: participation.id }))!,
        }))
      ),
      employments: await Promise.all(
        employments.map(async (employment) => ({
          id: employment.id,
          personName: employment.person.canonicalName,
          companyName: employment.company.canonicalName,
          affiliationKind: employment.affiliationKind,
          titleAtTime: employment.titleAtTime,
          evidence: (await getRelationshipEvidence(prisma, { employmentId: employment.id }))!,
        }))
      ),
      people: [...people.values()],
    },
    pending: {
      entities: pendingEntities,
      relationships: pendingRelationships,
    },
  };
}

export async function documentReviewCounts(
  prisma: PrismaClient,
  input: {
    observationIds: string[];
    relationships: RelationshipPromotionPreview[];
  }
) {
  let resolved = 0;
  for (const observationId of input.observationIds) {
    const link = await acceptedLink(prisma, observationId);
    if (link) resolved += 1;
  }
  const unresolved = input.observationIds.length - resolved;
  const ready = input.relationships.filter((row) => row.status === "PENDING" && row.canApprove).length;
  const blocked = input.relationships.filter(
    (row) => row.status === "BLOCKED_UNRESOLVED_ENTITY" || (row.status === "PENDING" && !row.canApprove)
  ).length;
  const approved = input.relationships.filter((row) => row.status === "APPROVED").length;
  return {
    unresolved,
    resolved,
    ready,
    blocked,
    approved,
  };
}
