import { Prisma, type PrismaClient } from "@prisma/client";
import { GraphInvariantError } from "@/lib/entities/errors";
import { releaseEntityClosureOnResolve } from "@/lib/review/closure";
import {
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  normalizeSurfaceForm,
} from "@/lib/entities/normalize";
import { proposeResolution } from "./propose";
import { isSharedInbox } from "./sharedInbox";
import type {
  CatalogCompany,
  CatalogPerson,
  CatalogProperty,
  ObservationResolutionView,
  ResolutionCandidateView,
  ResolutionCatalog,
  ResolutionObservation,
  ResolutionProposal,
} from "./types";

const CREATE_NEW_REASON =
  "Creates a canonical record only after the reviewer confirms the proposed fields. High confidence does not create it.";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function caseVariants(token: string): string[] {
  const lower = token.toLocaleLowerCase("en-US");
  const upper = token.toLocaleUpperCase("en-US");
  const titled = lower ? lower[0]!.toLocaleUpperCase("en-US") + lower.slice(1) : lower;
  return [...new Set([token, lower, upper, titled])];
}

function tokens(value: string): string[] {
  const raw = value
    .split(/\s+/)
    .map((token) => token.replace(/[.,]/g, ""))
    .filter((token) => token.length >= 3);
  return [...new Set(raw.flatMap(caseVariants))];
}

function containsToken(token: string) {
  return { contains: token };
}

function linkedInValue(raw: unknown): string | null {
  const record = asRecord(raw);
  const value = record?.observedLinkedIn;
  return typeof value === "string" && value.trim() ? value : null;
}

function externalIdValue(raw: unknown): string | null {
  const record = asRecord(raw);
  const value = record?.externalId;
  return typeof value === "string" && value.trim() ? value : null;
}

async function loadObservation(
  prisma: PrismaClient,
  observationId: string
): Promise<ResolutionObservation | null> {
  const observation = await prisma.entityObservation.findUnique({
    where: { id: observationId },
    include: {
      document: { select: { documentDate: true } },
      relationshipSubjects: {
        include: { objectObservation: { select: { normalizedName: true, surfaceForm: true } } },
      },
    },
  });
  if (!observation) return null;
  if (
    observation.observedType !== "PERSON" &&
    observation.observedType !== "COMPANY" &&
    observation.observedType !== "PROPERTY"
  ) {
    return null;
  }
  return {
    id: observation.id,
    workspaceId: observation.workspaceId,
    observedType: observation.observedType,
    surfaceForm: observation.surfaceForm,
    normalizedName: observation.normalizedName,
    title: observation.title,
    email: observation.email,
    phone: observation.phone,
    domain: observation.domain,
    addressLine1: observation.addressLine1,
    city: observation.city,
    region: observation.region,
    postalCode: observation.postalCode,
    country: observation.country,
    linkedIn: linkedInValue(observation.rawAttributes),
    externalId: externalIdValue(observation.rawAttributes),
    dealId: observation.dealId,
    documentDate: observation.document?.documentDate?.toISOString() ?? null,
    relationships: observation.relationshipSubjects.map((relationship) => ({
      predicate: relationship.predicate,
      objectNormalizedName: relationship.objectObservation?.normalizedName ?? null,
      objectSurfaceForm: relationship.objectObservation?.surfaceForm ?? null,
      evidenceQuote: relationship.evidenceQuote,
      statedValidFrom: relationship.statedValidFrom?.toISOString() ?? null,
      statedValidTo: relationship.statedValidTo?.toISOString() ?? null,
    })),
  };
}

async function loadBlockedCatalog(
  prisma: PrismaClient,
  observation: ResolutionObservation
): Promise<ResolutionCatalog> {
  const workspaceId = observation.workspaceId;
  const nameTokens = tokens(observation.surfaceForm);
  if (observation.observedType === "PERSON") {
    const email = observation.email && !isSharedInbox(observation.email) ? normalizeEmail(observation.email) : null;
    const phone = observation.phone ? normalizePhone(observation.phone) : null;
    const linkedIn = observation.linkedIn ? normalizeSurfaceForm(observation.linkedIn) : null;
    const identifierOr = [
      email ? { kind: "EMAIL" as const, normalizedValue: email } : null,
      phone ? { kind: "PHONE" as const, normalizedValue: phone } : null,
      linkedIn ? { kind: "LINKEDIN" as const, normalizedValue: linkedIn } : null,
    ].filter((item): item is { kind: "EMAIL" | "PHONE" | "LINKEDIN"; normalizedValue: string } => item != null);
    const people = await prisma.person.findMany({
      where: {
        workspaceId,
        status: { not: "MERGED" },
        OR: [
          ...identifierOr.map((identifier) => ({
            identifiers: { some: { workspaceId, kind: identifier.kind, normalizedValue: identifier.normalizedValue } },
          })),
          ...(observation.normalizedName
            ? [{ aliases: { some: { workspaceId, normalizedAlias: observation.normalizedName } } }]
            : []),
          ...nameTokens.map((token) => ({ canonicalName: containsToken(token) })),
        ],
      },
      include: {
        aliases: true,
        identifiers: true,
        employments: { include: { company: { include: { aliases: true } } } },
        participations: { select: { dealId: true } },
      },
    });
    const catalogPeople: CatalogPerson[] = people.map((person) => ({
      id: person.id,
      workspaceId: person.workspaceId,
      canonicalName: person.canonicalName,
      primaryTitle: person.primaryTitle,
      status: person.status,
      aliases: person.aliases.map((alias) => alias.normalizedAlias),
      emails: person.identifiers.filter((identifier) => identifier.kind === "EMAIL").map((identifier) => identifier.normalizedValue),
      phones: person.identifiers.filter((identifier) => identifier.kind === "PHONE").map((identifier) => identifier.normalizedValue),
      linkedIns: person.identifiers.filter((identifier) => identifier.kind === "LINKEDIN").map((identifier) => identifier.normalizedValue),
      employments: person.employments.map((employment) => ({
        companyName: employment.company.canonicalName,
        aliases: employment.company.aliases.map((alias) => alias.normalizedAlias),
        validTo: employment.validTo?.toISOString() ?? null,
        status: employment.status,
      })),
      dealIds: person.participations.map((participation) => participation.dealId),
    }));
    return { people: catalogPeople, companies: [], properties: [] };
  }

  if (observation.observedType === "COMPANY") {
    const domain = observation.domain ? normalizeDomain(observation.domain) : null;
    const externalId = observation.externalId ? observation.externalId.trim() : null;
    const companyOr = [
      ...(domain ? [{ primaryDomain: domain }, { identifiers: { some: { workspaceId, normalizedValue: domain } } }] : []),
      ...(observation.normalizedName
        ? [{ aliases: { some: { workspaceId, normalizedAlias: observation.normalizedName } } }]
        : []),
      ...(externalId
        ? [{ externalIdentifiers: { some: { workspaceId, value: externalId } } }]
        : []),
      ...nameTokens.flatMap((token) => [
        { canonicalName: containsToken(token) },
        { legalName: containsToken(token) },
      ]),
    ];
    if (companyOr.length === 0) return { people: [], companies: [], properties: [] };
    const companies = await prisma.company.findMany({
      where: {
        workspaceId,
        status: { not: "MERGED" },
        OR: companyOr,
      },
      include: {
        aliases: true,
        identifiers: true,
        externalIdentifiers: true,
        participations: { select: { dealId: true } },
      },
    });
    return {
      people: [],
      companies: companies.map(toCatalogCompany),
      properties: [],
    };
  }

  const addressTokens = tokens(observation.addressLine1 ?? "");
  const properties = await prisma.property.findMany({
    where: {
      workspaceId,
      status: { not: "MERGED" },
      OR: [
        ...(observation.normalizedName
          ? [{ aliases: { some: { workspaceId, normalizedAlias: observation.normalizedName } } }]
          : []),
        ...(observation.externalId
          ? [{ externalIdentifiers: { some: { workspaceId, value: observation.externalId.trim() } } }]
          : []),
        ...nameTokens.map((token) => ({ canonicalName: containsToken(token) })),
        ...addressTokens.map((token) => ({ addressLine1: containsToken(token) })),
        ...caseVariants(observation.city ?? "").filter((city) => city.length >= 2).map((city) => ({ city })),
      ],
    },
    include: {
      aliases: true,
      externalIdentifiers: true,
      deals: { select: { id: true } },
    },
  });
  const catalogProperties: CatalogProperty[] = properties.map((property) => ({
    id: property.id,
    workspaceId: property.workspaceId,
    canonicalName: property.canonicalName,
    addressLine1: property.addressLine1,
    addressLine2: property.addressLine2,
    city: property.city,
    region: property.region,
    postalCode: property.postalCode,
    country: property.country,
    status: property.status,
    aliases: property.aliases.map((alias) => alias.normalizedAlias),
    externalIds: property.externalIdentifiers.map((identifier) => normalizeSurfaceForm(identifier.value)),
    dealIds: property.deals.map((deal) => deal.id),
  }));
  return { people: [], companies: [], properties: catalogProperties };
}

function toCatalogCompany(company: {
  id: string;
  workspaceId: string;
  canonicalName: string;
  legalName: string | null;
  primaryDomain: string | null;
  status: string;
  aliases: { normalizedAlias: string }[];
  identifiers: { normalizedValue: string }[];
  externalIdentifiers: { value: string }[];
  participations: { dealId: string }[];
}): CatalogCompany {
  return {
    id: company.id,
    workspaceId: company.workspaceId,
    canonicalName: company.canonicalName,
    legalName: company.legalName,
    primaryDomain: company.primaryDomain,
    status: company.status,
    aliases: company.aliases.map((alias) => alias.normalizedAlias),
    domains: company.identifiers.map((identifier) => identifier.normalizedValue),
    externalIds: company.externalIdentifiers.map((identifier) => normalizeSurfaceForm(identifier.value)),
    dealIds: company.participations.map((participation) => participation.dealId),
  };
}

function targetIds(proposal: ResolutionProposal) {
  return {
    candidatePersonId: proposal.entityType === "PERSON" ? proposal.entityId : null,
    candidateCompanyId: proposal.entityType === "COMPANY" ? proposal.entityId : null,
    candidatePropertyId: proposal.entityType === "PROPERTY" ? proposal.entityId : null,
  };
}

function sameTarget(
  row: { candidatePersonId: string | null; candidateCompanyId: string | null; candidatePropertyId: string | null },
  proposal: ResolutionProposal
): boolean {
  const target = targetIds(proposal);
  return (
    row.candidatePersonId === target.candidatePersonId &&
    row.candidateCompanyId === target.candidateCompanyId &&
    row.candidatePropertyId === target.candidatePropertyId
  );
}

async function persistProposals(
  prisma: PrismaClient,
  observation: ResolutionObservation,
  proposals: ResolutionProposal[]
) {
  const existing = await prisma.entityResolutionCandidate.findMany({
    where: { entityObservationId: observation.id, workspaceId: observation.workspaceId },
  });
  for (const proposal of proposals) {
    const match = existing.find((row) => sameTarget(row, proposal));
    const data = {
      score: proposal.score,
      features: proposal.features as unknown as Prisma.InputJsonValue,
      positiveReasons: proposal.positiveReasons,
      negativeReasons: proposal.negativeReasons,
      temporalNotes: proposal.temporalNotes,
    };
    if (!match) {
      await prisma.entityResolutionCandidate.create({
        data: {
          workspaceId: observation.workspaceId,
          entityObservationId: observation.id,
          ...targetIds(proposal),
          ...data,
          decision: "PENDING",
        },
      });
    } else if (match.decision === "PENDING") {
      await prisma.entityResolutionCandidate.update({
        where: { id: match.id },
        data,
      });
    }
  }
  for (const row of existing) {
    if (row.decision !== "PENDING") continue;
    const stillProposed = proposals.some((proposal) => sameTarget(row, proposal));
    if (!stillProposed) {
      await prisma.entityResolutionCandidate.update({
        where: { id: row.id },
        data: {
          decision: "REJECTED",
          decidedAt: new Date(),
          decisionReason: "Blocking no longer proposes this candidate",
        },
      });
    }
  }
}

function createNewLabel(type: ResolutionObservation["observedType"]): string {
  if (type === "PERSON") return "Create Person";
  if (type === "COMPANY") return "Create Company";
  return "Create Property";
}

function toView(
  row: {
    id: string;
    decision: "PENDING" | "ACCEPTED" | "REJECTED";
    score: number;
    positiveReasons: unknown;
    negativeReasons: unknown;
    temporalNotes: unknown;
    decisionReason: string | null;
    decidedAt: Date | null;
    person: { id: string; canonicalName: string } | null;
    company: { id: string; canonicalName: string; primaryDomain: string | null } | null;
    property: { id: string; canonicalName: string; city: string | null; region: string | null } | null;
  },
  contextById: Map<string, string>
): ResolutionCandidateView | null {
  const candidate = row.person
    ? { type: "PERSON" as const, id: row.person.id, name: row.person.canonicalName }
    : row.company
      ? { type: "COMPANY" as const, id: row.company.id, name: row.company.canonicalName }
      : row.property
        ? { type: "PROPERTY" as const, id: row.property.id, name: row.property.canonicalName }
        : null;
  if (!candidate) return null;
  return {
    id: row.id,
    decision: row.decision,
    score: row.score,
    positiveReasons: asStrings(row.positiveReasons),
    negativeReasons: asStrings(row.negativeReasons),
    temporalNotes: asStrings(row.temporalNotes),
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    candidate: {
      ...candidate,
      context: contextById.get(candidate.id) ?? "",
    },
  };
}

export async function listResolutionCandidates(
  prisma: PrismaClient,
  observationId: string
): Promise<ObservationResolutionView | null> {
  const observation = await loadObservation(prisma, observationId);
  if (!observation) return null;
  const stored = await prisma.entityObservation.findUnique({
    where: { id: observationId },
    select: { evidenceQuote: true, workspaceId: true },
  });
  if (!stored || stored.workspaceId !== observation.workspaceId) return null;
  const catalog = await loadBlockedCatalog(prisma, observation);
  const proposals = proposeResolution(observation, catalog);
  await persistProposals(prisma, observation, proposals);
  const contextById = new Map(proposals.map((proposal) => [proposal.entityId, proposal.contextLabel]));
  const rows = await prisma.entityResolutionCandidate.findMany({
    where: { entityObservationId: observation.id, workspaceId: observation.workspaceId },
    include: {
      person: { select: { id: true, canonicalName: true } },
      company: { select: { id: true, canonicalName: true, primaryDomain: true } },
      property: { select: { id: true, canonicalName: true, city: true, region: true } },
    },
    orderBy: [{ score: "desc" }, { createdAt: "asc" }],
  });
  return {
    observationId: observation.id,
    workspaceId: observation.workspaceId,
    observedType: observation.observedType,
    surfaceForm: observation.surfaceForm,
    evidenceQuote: stored.evidenceQuote,
    createNew: {
      enabled: true,
      label: createNewLabel(observation.observedType),
      reason: CREATE_NEW_REASON,
    },
    candidates: rows
      .map((row) => toView(row, contextById))
      .filter((row): row is ResolutionCandidateView => row != null),
  };
}

function assertOneTarget(row: {
  candidatePersonId: string | null;
  candidateCompanyId: string | null;
  candidatePropertyId: string | null;
}) {
  const count = [row.candidatePersonId, row.candidateCompanyId, row.candidatePropertyId].filter(Boolean).length;
  if (count !== 1) {
    throw new GraphInvariantError("A resolution candidate must name exactly one canonical entity");
  }
}

export async function acceptResolutionCandidate(
  prisma: PrismaClient,
  candidateId: string,
  decisionReason?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.entityResolutionCandidate.findUnique({
      where: { id: candidateId },
      include: { observation: true, person: true, company: true, property: true, resolutionLink: true },
    });
    if (!candidate) return null;
    if (candidate.workspaceId !== candidate.observation.workspaceId) {
      throw new GraphInvariantError("Resolution candidate is outside the observation workspace");
    }
    assertOneTarget(candidate);
    const person = candidate.person;
    const company = candidate.company;
    const property = candidate.property;
    if (candidate.observation.observedType === "PERSON") {
      if (!person || person.workspaceId !== candidate.workspaceId) {
        throw new GraphInvariantError("Person candidate is missing or belongs to another workspace");
      }
      if (person.status === "MERGED") throw new GraphInvariantError("Cannot resolve to a merged person");
    } else if (candidate.observation.observedType === "COMPANY") {
      if (!company || company.workspaceId !== candidate.workspaceId) {
        throw new GraphInvariantError("Company candidate is missing or belongs to another workspace");
      }
      if (company.status === "MERGED") throw new GraphInvariantError("Cannot resolve to a merged company");
    } else if (candidate.observation.observedType === "PROPERTY") {
      if (!property || property.workspaceId !== candidate.workspaceId) {
        throw new GraphInvariantError("Property candidate is missing or belongs to another workspace");
      }
      if (property.status === "MERGED") throw new GraphInvariantError("Cannot resolve to a merged property");
    } else {
      throw new GraphInvariantError("Only person, company, and property observations can be resolved");
    }
    if (candidate.decision === "REJECTED") {
      throw new GraphInvariantError("A rejected candidate stays closed");
    }
    if (
      candidate.decision === "ACCEPTED" &&
      candidate.resolutionLink &&
      candidate.resolutionLink.status === "ACCEPTED"
    ) {
      return { candidateId: candidate.id, decision: "ACCEPTED" as const, resolutionLinkId: candidate.resolutionLink.id, idempotent: true };
    }

    const currentLinks = await tx.entityResolutionLink.findMany({
      where: { entityObservationId: candidate.entityObservationId, status: "ACCEPTED" },
    });
    const sameLink = currentLinks.find(
      (link) =>
        link.personId === candidate.candidatePersonId &&
        link.companyId === candidate.candidateCompanyId &&
        link.propertyId === candidate.candidatePropertyId &&
        link.workspaceId === candidate.workspaceId
    );
    let resolutionLinkId = sameLink?.id ?? null;
    if (!resolutionLinkId) {
      const now = new Date();
      for (const link of currentLinks) {
        await tx.entityResolutionLink.update({
          where: { id: link.id },
          data: { status: "SUPERSEDED", supersededAt: now },
        });
      }
      const created = await tx.entityResolutionLink.create({
        data: {
          workspaceId: candidate.workspaceId,
          entityObservationId: candidate.entityObservationId,
          personId: candidate.candidatePersonId,
          companyId: candidate.candidateCompanyId,
          propertyId: candidate.candidatePropertyId,
          method: "DETERMINISTIC",
          resolutionConfidence: candidate.score,
          status: "ACCEPTED",
        },
      });
      resolutionLinkId = created.id;
    }
    await tx.entityResolutionCandidate.update({
      where: { id: candidate.id },
      data: {
        decision: "ACCEPTED",
        decidedAt: candidate.decidedAt ?? new Date(),
        decisionReason: decisionReason ?? candidate.decisionReason,
        resolutionLinkId,
      },
    });
    await releaseEntityClosureOnResolve(tx, candidate.entityObservationId);
    await tx.entityResolutionCandidate.updateMany({
      where: {
        entityObservationId: candidate.entityObservationId,
        workspaceId: candidate.workspaceId,
        id: { not: candidate.id },
        decision: "PENDING",
      },
      data: {
        decision: "REJECTED",
        decidedAt: new Date(),
        decisionReason: "Another candidate for this observation was accepted",
      },
    });
    return { candidateId: candidate.id, decision: "ACCEPTED" as const, resolutionLinkId, idempotent: false };
  });
}

export async function rejectResolutionCandidate(
  prisma: PrismaClient,
  candidateId: string,
  decisionReason?: string | null
) {
  const candidate = await prisma.entityResolutionCandidate.findUnique({
    where: { id: candidateId },
    include: { observation: true },
  });
  if (!candidate) return null;
  if (candidate.workspaceId !== candidate.observation.workspaceId) {
    throw new GraphInvariantError("Resolution candidate is outside the observation workspace");
  }
  if (candidate.decision === "ACCEPTED") {
    throw new GraphInvariantError(
      "An accepted resolution stays in history. Choosing another pending candidate supersedes its link. Un-accepting without a replacement is deferred."
    );
  }
  if (candidate.decision === "REJECTED") {
    return { candidateId: candidate.id, decision: "REJECTED" as const, resolutionLinkId: candidate.resolutionLinkId, idempotent: true };
  }
  const updated = await prisma.entityResolutionCandidate.update({
    where: { id: candidate.id },
    data: {
      decision: "REJECTED",
      decidedAt: new Date(),
      decisionReason: decisionReason ?? "Rejected by a reviewer",
    },
  });
  return { candidateId: updated.id, decision: "REJECTED" as const, resolutionLinkId: updated.resolutionLinkId, idempotent: false };
}
