import type { GraphDb } from "@/lib/entities/workspace";
import {
  entityOriginView,
  graphEvidenceInclude,
  relationshipEvidenceInclude,
  relationshipEvidenceView,
  type ProvenanceObservation,
} from "@/lib/graph/provenance";
import type { EvidenceView } from "@/lib/promotion/types";
import type {
  CompanyIntelligence,
  IntelligenceAssertion,
  IntelligenceEntityRef,
  PersonIntelligence,
  PropertyIntelligence,
  ValidityView,
} from "./types";
import { canonicalEntityHref } from "./routes";

const evidenceInclude = relationshipEvidenceInclude;

type SupportObservation = ProvenanceObservation;

function ref(type: IntelligenceEntityRef["type"], row: { id: string; canonicalName?: string; name?: string }, subtitle?: string | null): IntelligenceEntityRef {
  return { id: row.id, type, name: row.canonicalName ?? row.name ?? "Unknown", href: canonicalEntityHref(type, row.id), subtitle };
}

function evidence(title: string, supports: Array<{ relationshipObservation: SupportObservation }>): EvidenceView {
  return relationshipEvidenceView(title, supports);
}

async function originFor(
  db: GraphDb,
  workspaceId: string,
  field: "personId" | "companyId" | "propertyId",
  entityId: string,
  title: string
): Promise<EvidenceView> {
  const links = await db.entityResolutionLink.findMany({
    where: {
      workspaceId,
      status: "ACCEPTED",
      supersededAt: null,
      [field]: entityId,
      observation: { workspaceId },
    },
    include: { observation: { include: graphEvidenceInclude } },
    orderBy: { createdAt: "asc" },
  });
  return entityOriginView(
    title,
    links
      .map((link) => link.observation)
      .filter((observation) => observation.workspaceId === workspaceId)
  );
}

function validity(row: {
  validFrom: Date | null;
  validTo: Date | null;
  validFromPrecision: string;
  validToPrecision: string;
}): ValidityView {
  return {
    validFrom: row.validFrom?.toISOString() ?? null,
    validTo: row.validTo?.toISOString() ?? null,
    validFromPrecision: row.validFromPrecision,
    validToPrecision: row.validToPrecision,
    current: !row.validTo || row.validTo.getTime() >= Date.now(),
  };
}

function roleLabel(role: string, custom: string | null): string {
  return custom?.trim() || role.toLowerCase().replaceAll("_", " ");
}

function stakeLabel(predicate: string): string {
  const labels: Record<string, string> = { OWNS: "Owns", MANAGES: "Manages", OCCUPIES: "Occupies", DEVELOPED: "Developed", LENDS_ON: "Lends on" };
  return labels[predicate] ?? predicate.toLowerCase().replaceAll("_", " ");
}

function dealPropertyEvidence(deal: { name: string }, supports: Array<{ relationshipObservation: SupportObservation }>): EvidenceView {
  return evidence(`${deal.name} concerns this property`, supports);
}

async function pendingForDeals(db: GraphDb, workspaceId: string, dealIds: string[]) {
  if (dealIds.length === 0) return { count: 0, reviewHrefs: [] as string[] };
  const unique = [...new Set(dealIds)];
  const [entities, relationships] = await Promise.all([
    db.entityObservation.count({
      where: {
        workspaceId,
        dealId: { in: unique },
        resolutionLinks: { none: { status: "ACCEPTED" } },
        dispositions: { none: { disposition: "REJECTED" } },
      },
    }),
    db.relationshipObservation.count({
      where: {
        workspaceId,
        OR: [{ dealId: { in: unique } }, { contextDealId: { in: unique } }],
        promotion: { is: null },
        dispositions: { none: { disposition: "REJECTED" } },
      },
    }),
  ]);
  return { count: entities + relationships, reviewHrefs: unique.map((id) => `/deals/${id}/knowledge`) };
}

export async function getPersonIntelligence(db: GraphDb, id: string): Promise<PersonIntelligence | null> {
  const person = await db.person.findFirst({
    where: { id, status: "ACTIVE", mergedIntoPersonId: null },
    select: {
      id: true,
      workspaceId: true,
      canonicalName: true,
      primaryTitle: true,
      identifiers: { select: { kind: true, value: true }, orderBy: { kind: "asc" } },
      externalIdentifiers: { select: { scheme: true, value: true }, orderBy: { scheme: "asc" } },
    },
  });
  if (!person) return null;
  const workspaceId = person.workspaceId;
  const [employmentRows, participationRows] = await Promise.all([
    db.employment.findMany({
      where: { workspaceId, personId: id, status: "ASSERTED", company: { workspaceId, status: "ACTIVE", mergedIntoCompanyId: null } },
      include: { company: true, supports: { where: { relationshipObservation: { workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.dealParticipation.findMany({
      where: { workspaceId, personId: id, status: "ASSERTED", deal: { workspaceId } },
      include: {
        deal: { include: { canonicalProperty: true } },
        represents: true,
        supports: { where: { relationshipObservation: { workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const personRef = ref("PERSON", person, person.primaryTitle);
  const employments: IntelligenceAssertion[] = employmentRows
    .filter((row) => row.company.workspaceId === workspaceId && row.company.status === "ACTIVE" && !row.company.mergedIntoCompanyId)
    .map((row) => ({
      id: row.id,
      kind: "Employment",
      label: "Works at",
      subject: personRef,
      object: ref("COMPANY", row.company),
      detail: [row.titleAtTime, row.affiliationKind !== "UNKNOWN" ? row.affiliationKind.toLowerCase().replaceAll("_", " ") : null].filter(Boolean).join(" · ") || null,
      validity: validity(row),
      evidence: evidence(`${person.canonicalName} works at ${row.company.canonicalName}`, row.supports),
    }));
  const deals: IntelligenceAssertion[] = participationRows
    .filter((row) => row.deal.workspaceId === workspaceId && (!row.represents || row.represents.workspaceId === workspaceId))
    .map((row) => ({
      id: row.id,
      kind: "DealParticipation",
      label: roleLabel(row.role, row.roleLabel),
      subject: personRef,
      object: ref("DEAL", row.deal, row.deal.stage),
      context: row.deal.canonicalProperty && row.deal.canonicalProperty.workspaceId === workspaceId && row.deal.canonicalProperty.status === "ACTIVE" ? ref("PROPERTY", row.deal.canonicalProperty) : null,
      representedCompany: row.represents && row.represents.workspaceId === workspaceId && row.represents.status === "ACTIVE" && !row.represents.mergedIntoCompanyId ? ref("COMPANY", row.represents) : null,
      validity: validity(row),
      evidence: evidence(`${person.canonicalName} · ${roleLabel(row.role, row.roleLabel)} on ${row.deal.name}`, row.supports),
    }));
  const pending = await pendingForDeals(db, workspaceId, participationRows.map((row) => row.dealId));
  const origin = await originFor(db, workspaceId, "personId", id, `Observations that established ${person.canonicalName}`);
  return {
    type: "PERSON",
    workspaceId,
    origin,
    person: { ...personRef, primaryTitle: person.primaryTitle, identifiers: person.identifiers, externalIdentifiers: person.externalIdentifiers },
    employments,
    deals,
    properties: [],
    relationships: [...employments, ...deals],
    pending,
    connectionsHref: `/people/${id}/connections`,
  };
}

export async function getCompanyIntelligence(db: GraphDb, id: string): Promise<CompanyIntelligence | null> {
  const company = await db.company.findFirst({
    where: { id, status: "ACTIVE", mergedIntoCompanyId: null },
    select: {
      id: true, workspaceId: true, canonicalName: true, legalName: true, website: true, primaryDomain: true,
      identifiers: { select: { kind: true, value: true }, orderBy: { kind: "asc" } },
      externalIdentifiers: { select: { scheme: true, value: true }, orderBy: { scheme: "asc" } },
    },
  });
  if (!company) return null;
  const workspaceId = company.workspaceId;
  const [employmentRows, stakeRows, participationRows] = await Promise.all([
    db.employment.findMany({
      where: { workspaceId, companyId: id, status: "ASSERTED", person: { workspaceId, status: "ACTIVE", mergedIntoPersonId: null } },
      include: { person: true, supports: { where: { relationshipObservation: { workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.propertyStake.findMany({
      where: { workspaceId, companyId: id, status: "ASSERTED", property: { workspaceId, status: "ACTIVE", mergedIntoPropertyId: null } },
      include: { property: true, supports: { where: { relationshipObservation: { workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.dealParticipation.findMany({
      where: { workspaceId, status: "ASSERTED", deal: { workspaceId }, OR: [{ companyId: id }, { representsCompanyId: id }] },
      include: {
        deal: { include: { canonicalProperty: true } }, person: true, company: true, represents: true,
        supports: { where: { relationshipObservation: { workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const companyRef = ref("COMPANY", company);
  const people: IntelligenceAssertion[] = employmentRows.map((row) => ({
    id: row.id, kind: "Employment", label: "Works at", subject: ref("PERSON", row.person, row.titleAtTime ?? row.person.primaryTitle), object: companyRef,
    detail: [row.titleAtTime, row.affiliationKind !== "UNKNOWN" ? row.affiliationKind.toLowerCase().replaceAll("_", " ") : null].filter(Boolean).join(" · ") || null,
    validity: validity(row), evidence: evidence(`${row.person.canonicalName} works at ${company.canonicalName}`, row.supports),
  }));
  const properties: IntelligenceAssertion[] = stakeRows.map((row) => ({
    id: row.id, kind: "PropertyStake", label: stakeLabel(row.predicate), subject: companyRef, object: ref("PROPERTY", row.property, [row.property.city, row.property.region].filter(Boolean).join(", ") || null),
    validity: validity(row), evidence: evidence(`${company.canonicalName} ${row.predicate} ${row.property.canonicalName}`, row.supports),
  }));
  const deals: IntelligenceAssertion[] = participationRows.filter((row) => row.companyId === id).map((row) => ({
    id: row.id, kind: "DealParticipation", label: roleLabel(row.role, row.roleLabel), subject: companyRef, object: ref("DEAL", row.deal, row.deal.stage),
    context: row.deal.canonicalProperty && row.deal.canonicalProperty.workspaceId === workspaceId && row.deal.canonicalProperty.status === "ACTIVE" && !row.deal.canonicalProperty.mergedIntoPropertyId ? ref("PROPERTY", row.deal.canonicalProperty) : null,
    representedCompany: row.representsCompanyId === id ? companyRef : row.represents && row.represents.workspaceId === workspaceId ? ref("COMPANY", row.represents) : null,
    validity: validity(row), evidence: evidence(`${company.canonicalName} · ${roleLabel(row.role, row.roleLabel)} on ${row.deal.name}`, row.supports),
  }));
  const representation: IntelligenceAssertion[] = participationRows.filter((row) => row.representsCompanyId === id).flatMap((row) => {
    const actor = row.person && row.person.workspaceId === workspaceId && row.person.status === "ACTIVE" && !row.person.mergedIntoPersonId ? ref("PERSON", row.person, row.person.primaryTitle) : row.company && row.company.workspaceId === workspaceId && row.company.status === "ACTIVE" && !row.company.mergedIntoCompanyId ? ref("COMPANY", row.company) : null;
    if (!actor) return [];
    return [{
      id: row.id, kind: "DealParticipation", label: "Represents on deal", subject: actor, object: companyRef, context: ref("DEAL", row.deal, row.deal.stage), representedCompany: companyRef,
      detail: roleLabel(row.role, row.roleLabel), validity: validity(row), evidence: evidence(`${actor.name} represents ${company.canonicalName} on ${row.deal.name}`, row.supports),
    }];
  });
  const pending = await pendingForDeals(db, workspaceId, participationRows.map((row) => row.dealId));
  const origin = await originFor(db, workspaceId, "companyId", id, `Observations that established ${company.canonicalName}`);
  return {
    type: "COMPANY", workspaceId, origin,
    company: { ...companyRef, legalName: company.legalName, website: company.website, primaryDomain: company.primaryDomain, identifiers: company.identifiers, externalIdentifiers: company.externalIdentifiers },
    people, deals, properties, representation,
    relationships: [...people, ...properties, ...deals, ...representation], pending,
    connectionsHref: `/companies/${id}/connections`,
  };
}

export async function getPropertyIntelligence(db: GraphDb, id: string): Promise<PropertyIntelligence | null> {
  const property = await db.property.findFirst({
    where: { id, status: "ACTIVE", mergedIntoPropertyId: null },
    select: {
      id: true, workspaceId: true, canonicalName: true, addressLine1: true, addressLine2: true, city: true, region: true, postalCode: true, country: true, assetType: true,
      externalIdentifiers: { select: { scheme: true, value: true }, orderBy: { scheme: "asc" } },
    },
  });
  if (!property) return null;
  const workspaceId = property.workspaceId;
  const [stakeRows, dealRows] = await Promise.all([
    db.propertyStake.findMany({
      where: { workspaceId, propertyId: id, status: "ASSERTED", company: { workspaceId, status: "ACTIVE", mergedIntoCompanyId: null } },
      include: { company: true, supports: { where: { relationshipObservation: { workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    db.deal.findMany({
      where: { workspaceId, propertyId: id },
      include: {
        relationshipPromotions: {
          where: { workspaceId, decision: "APPROVED" },
          include: { relationshipObservation: { include: evidenceInclude } },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const dealIds = dealRows.map((row) => row.id);
  const participationRows = dealIds.length ? await db.dealParticipation.findMany({
    where: { workspaceId, dealId: { in: dealIds }, status: "ASSERTED" },
    include: {
      deal: true, person: true, company: true, represents: true,
      supports: { where: { relationshipObservation: { workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  }) : [];
  const propertyRef = ref("PROPERTY", property, [property.city, property.region].filter(Boolean).join(", ") || null);
  const stakes: IntelligenceAssertion[] = stakeRows.map((row) => ({
    id: row.id, kind: "PropertyStake", label: stakeLabel(row.predicate), subject: ref("COMPANY", row.company), object: propertyRef,
    validity: validity(row), evidence: evidence(`${row.company.canonicalName} ${row.predicate} ${property.canonicalName}`, row.supports),
  }));
  const deals: IntelligenceAssertion[] = dealRows.map((row) => ({
    id: row.id, kind: "DealProperty", label: "Concerns property", subject: ref("DEAL", row, row.stage), object: propertyRef,
    evidence: dealPropertyEvidence(row, row.relationshipPromotions),
  }));
  const participants: IntelligenceAssertion[] = participationRows.flatMap((row) => {
    const actor = row.person && row.person.workspaceId === workspaceId && row.person.status === "ACTIVE" ? ref("PERSON", row.person, row.person.primaryTitle) : row.company && row.company.workspaceId === workspaceId && row.company.status === "ACTIVE" ? ref("COMPANY", row.company) : null;
    if (!actor) return [];
    return [{
      id: row.id, kind: "DealParticipation" as const, label: roleLabel(row.role, row.roleLabel), subject: actor, object: ref("DEAL", row.deal, row.deal.stage), context: propertyRef,
      representedCompany: row.represents && row.represents.workspaceId === workspaceId && row.represents.status === "ACTIVE" ? ref("COMPANY", row.represents) : null,
      detail: "Deal participant — not a direct property relationship", validity: validity(row), evidence: evidence(`${actor.name} · ${roleLabel(row.role, row.roleLabel)} on ${row.deal.name}`, row.supports),
    }];
  });
  const pending = await pendingForDeals(db, workspaceId, dealIds);
  const origin = await originFor(db, workspaceId, "propertyId", id, `Observations that established ${property.canonicalName}`);
  return {
    type: "PROPERTY", workspaceId, origin,
    property: { ...propertyRef, address: [property.addressLine1, property.addressLine2, property.city, property.region, property.postalCode, property.country].filter(Boolean).join(", "), assetType: property.assetType, externalIdentifiers: property.externalIdentifiers },
    stakes, deals, participants, relationships: [...stakes, ...deals], pending,
    connectionsHref: `/properties/${id}/connections`,
  };
}
