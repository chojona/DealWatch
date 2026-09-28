import type { GraphDb } from "./workspace";
import {
  addPersonIdentifier,
  createCompany,
  createDealParticipation,
  createEmployment,
  createPerson,
  createProperty,
  createPropertyStake,
  linkDealProperty,
  recordEntityObservation,
  recordRelationshipObservation,
  attachObservationSupport,
} from "./service";

/**
 * Explicit fictional graph for the seeded 200 Clarendon deal.
 * Message quotes are taken from the existing seed bodies. Assertions that
 * the message text does not state are stored with no observation support.
 */
export async function seedClarendonGraph(
  db: GraphDb,
  input: {
    workspaceId: string;
    dealId: string;
    tenantMessage: { id: string; body: string };
    landlordMessage: { id: string; body: string };
  }
) {
  const workspaceId = input.workspaceId;
  const manual = {
    workspaceId,
    assertionSource: "MANUAL" as const,
  };

  const property = await createProperty(db, {
    workspaceId,
    canonicalName: "200 Clarendon",
    addressLine1: "200 Clarendon Street",
    city: "Boston",
    region: "MA",
    country: "US",
    assetType: "OFFICE",
  });
  const deal = await linkDealProperty(db, {
    workspaceId,
    dealId: input.dealId,
    propertyId: property.id,
  });

  const acme = await createCompany(db, {
    workspaceId,
    canonicalName: "Acme Corp",
  });
  const bostonProperties = await createCompany(db, {
    workspaceId,
    canonicalName: "Boston Properties",
  });
  const jll = await createCompany(db, {
    workspaceId,
    canonicalName: "JLL Boston",
  });
  const cbre = await createCompany(db, {
    workspaceId,
    canonicalName: "CBRE",
  });
  const harborline = await createCompany(db, {
    workspaceId,
    canonicalName: "Harborline Management",
  });

  const sarah = await createPerson(db, {
    workspaceId,
    canonicalName: "Sarah Chen",
    primaryTitle: "Senior VP, Tenant Representation",
  });
  await addPersonIdentifier(db, {
    workspaceId,
    personId: sarah.id,
    kind: "EMAIL",
    value: "s.chen@jllboston.com",
  });
  const derek = await createPerson(db, {
    workspaceId,
    canonicalName: "Derek Hollis",
    primaryTitle: "Director of Leasing",
  });
  await addPersonIdentifier(db, {
    workspaceId,
    personId: derek.id,
    kind: "EMAIL",
    value: "d.hollis@bostonproperties.com",
  });
  const priya = await createPerson(db, {
    workspaceId,
    canonicalName: "Priya Shah",
  });
  const elena = await createPerson(db, {
    workspaceId,
    canonicalName: "Elena Vasquez",
  });

  const sarahEmployment = await createEmployment(db, {
    ...manual,
    personId: sarah.id,
    companyId: jll.id,
    affiliationKind: "BROKER",
    titleAtTime: "Senior VP, Tenant Representation",
  });
  const derekEmployment = await createEmployment(db, {
    ...manual,
    personId: derek.id,
    companyId: bostonProperties.id,
    affiliationKind: "UNKNOWN",
    titleAtTime: "Director of Leasing",
  });
  await createEmployment(db, {
    ...manual,
    personId: priya.id,
    companyId: cbre.id,
    affiliationKind: "BROKER",
  });
  await createEmployment(db, {
    ...manual,
    personId: elena.id,
    companyId: harborline.id,
    affiliationKind: "PROPERTY_MANAGER",
  });

  await createPropertyStake(db, {
    ...manual,
    companyId: bostonProperties.id,
    propertyId: property.id,
    predicate: "OWNS",
  });
  await createPropertyStake(db, {
    ...manual,
    companyId: harborline.id,
    propertyId: property.id,
    predicate: "MANAGES",
  });

  await createDealParticipation(db, {
    ...manual,
    dealId: deal.id,
    role: "TENANT",
    companyId: acme.id,
  });
  await createDealParticipation(db, {
    ...manual,
    dealId: deal.id,
    role: "LANDLORD",
    companyId: bostonProperties.id,
  });
  await createDealParticipation(db, {
    ...manual,
    dealId: deal.id,
    role: "TENANT_BROKER",
    personId: sarah.id,
    representsCompanyId: acme.id,
  });
  await createDealParticipation(db, {
    ...manual,
    dealId: deal.id,
    role: "TENANT_BROKERAGE",
    companyId: jll.id,
    representsCompanyId: acme.id,
  });
  await createDealParticipation(db, {
    ...manual,
    dealId: deal.id,
    role: "LANDLORD_BROKER",
    personId: priya.id,
    representsCompanyId: bostonProperties.id,
  });
  await createDealParticipation(db, {
    ...manual,
    dealId: deal.id,
    role: "LANDLORD_BROKERAGE",
    companyId: cbre.id,
    representsCompanyId: bostonProperties.id,
  });

  const evidence = {
    extractor: "manual",
    extractorVersion: "phase6b.seed",
  };
  const sarahMention = await recordEntityObservation(db, {
    workspaceId,
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    title: "Senior VP, Tenant Representation",
    sourceKind: "MESSAGE",
    dealId: deal.id,
    messageId: input.tenantMessage.id,
    evidenceQuote: "Sarah Chen",
    ...evidence,
  });
  const jllMention = await recordEntityObservation(db, {
    workspaceId,
    observedType: "COMPANY",
    surfaceForm: "JLL Boston",
    sourceKind: "MESSAGE",
    dealId: deal.id,
    messageId: input.tenantMessage.id,
    evidenceQuote: "JLL Boston",
    ...evidence,
  });
  const sarahWorks = await recordRelationshipObservation(db, {
    workspaceId,
    predicate: "WORKS_AT",
    subjectObservationId: sarahMention.id,
    objectObservationId: jllMention.id,
    affiliationKind: "BROKER",
    statedTitle: "Senior VP, Tenant Representation",
    contextDealId: deal.id,
    sourceKind: "MESSAGE",
    dealId: deal.id,
    messageId: input.tenantMessage.id,
    evidenceQuote: "Senior VP, Tenant Representation | JLL Boston",
    ...evidence,
  });
  await attachObservationSupport(db, {
    workspaceId,
    employmentId: sarahEmployment.id,
    relationshipObservationId: sarahWorks.id,
  });

  const derekMention = await recordEntityObservation(db, {
    workspaceId,
    observedType: "PERSON",
    surfaceForm: "Derek Hollis",
    title: "Director of Leasing",
    sourceKind: "MESSAGE",
    dealId: deal.id,
    messageId: input.landlordMessage.id,
    evidenceQuote: "Derek Hollis",
    ...evidence,
  });
  const ownerMention = await recordEntityObservation(db, {
    workspaceId,
    observedType: "COMPANY",
    surfaceForm: "Boston Properties",
    sourceKind: "MESSAGE",
    dealId: deal.id,
    messageId: input.landlordMessage.id,
    evidenceQuote: "Boston Properties",
    ...evidence,
  });
  const derekWorks = await recordRelationshipObservation(db, {
    workspaceId,
    predicate: "WORKS_AT",
    subjectObservationId: derekMention.id,
    objectObservationId: ownerMention.id,
    affiliationKind: "UNKNOWN",
    statedTitle: "Director of Leasing",
    contextDealId: deal.id,
    sourceKind: "MESSAGE",
    dealId: deal.id,
    messageId: input.landlordMessage.id,
    evidenceQuote: "Director of Leasing | Boston Properties",
    ...evidence,
  });
  await attachObservationSupport(db, {
    workspaceId,
    employmentId: derekEmployment.id,
    relationshipObservationId: derekWorks.id,
  });

  return {
    propertyId: property.id,
    companyIds: {
      acme: acme.id,
      bostonProperties: bostonProperties.id,
      jll: jll.id,
      cbre: cbre.id,
      harborline: harborline.id,
    },
  };
}
