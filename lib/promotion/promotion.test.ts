import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import { GraphInvariantError } from "@/lib/entities/errors";
import {
  createPerson,
  createWorkspace,
  recordEntityObservation,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import { acceptResolutionCandidate, listResolutionCandidates } from "@/lib/resolution/service";
import {
  approveRelationshipObservation,
  createCanonicalEntityFromObservation,
  getDealKnowledge,
  getRelationshipEvidence,
  previewCanonicalEntity,
  previewRelationshipPromotion,
  rejectRelationshipObservation,
} from "./service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

const manual = {
  sourceKind: "MANUAL" as const,
  evidenceQuote: "Recorded by an analyst from a conversation.",
  extractor: "manual",
  extractorVersion: "test",
};

test.before(async () => {
  const db = await createTestDatabase();
  prisma = db.prisma;
  cleanup = db.cleanup;
});

test.after(async () => {
  await cleanup();
});

async function workspaceDeal(name: string) {
  const workspace = await createWorkspace(prisma, { name });
  const deal = await prisma.deal.create({
    data: {
      name,
      company: "Acme Corp",
      property: "200 Clarendon",
      stage: "LOI",
      status: "ACTIVE",
      workspaceId: workspace.id,
    },
  });
  return { workspace, deal };
}

async function resolveToExisting(observationId: string, entityId: string) {
  const review = await listResolutionCandidates(prisma, observationId);
  const match = review?.candidates.find((candidate) => candidate.candidate.id === entityId);
  assert.ok(match, `expected candidate ${entityId}`);
  await acceptResolutionCandidate(prisma, match.id);
}

async function observePerson(
  workspaceId: string,
  dealId: string,
  surfaceForm: string,
  extra: Record<string, unknown> = {}
) {
  return recordEntityObservation(prisma, {
    ...manual,
    workspaceId,
    dealId,
    observedType: "PERSON",
    surfaceForm,
    ...extra,
  });
}

test("A/D/E create a person from an observation without changing it or adding an alias", async () => {
  const { workspace, deal } = await workspaceDeal("Person");
  const observation = await observePerson(workspace.id, deal.id, "Sarah Chen", {
    title: "Senior Vice President",
    email: "sarah.chen@jll.com",
    phone: "+1 (617) 555-0100",
    rawAttributes: { observedLinkedIn: "https://www.linkedin.com/in/sarahchen" },
  });
  const before = await prisma.entityObservation.findUniqueOrThrow({ where: { id: observation.id } });
  const preview = await previewCanonicalEntity(prisma, observation.id);
  assert.equal(preview?.actionLabel, "Create Person");
  assert.equal(preview?.fields.find((field) => field.label === "Name")?.value, "Sarah Chen");
  assert.equal(preview?.fields.find((field) => field.label === "Email")?.value, "sarah.chen@jll.com");
  assert.equal(preview?.blockedReason, null);

  const created = await createCanonicalEntityFromObservation(prisma, observation.id);
  assert.ok(created);
  assert.equal(created.idempotent, false);
  assert.equal(created.workspaceId, workspace.id);
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: created.entityId },
    include: { identifiers: true, aliases: true },
  });
  assert.equal(person.workspaceId, workspace.id);
  assert.equal(person.canonicalName, "Sarah Chen");
  assert.equal(person.primaryTitle, "Senior Vice President");
  assert.equal(person.aliases.length, 0);
  assert.deepEqual(
    person.identifiers.map((identifier) => identifier.kind).sort(),
    ["EMAIL", "LINKEDIN", "PHONE"]
  );
  const link = await prisma.entityResolutionLink.findUniqueOrThrow({
    where: { id: created.resolutionLinkId },
  });
  assert.equal(link.entityObservationId, observation.id);
  assert.equal(link.personId, person.id);
  assert.equal(link.method, "MANUAL");
  assert.equal(link.status, "ACCEPTED");
  assert.equal(link.companyId, null);
  assert.equal(link.propertyId, null);
  const after = await prisma.entityObservation.findUniqueOrThrow({ where: { id: observation.id } });
  assert.deepEqual(after, before);
  assert.equal(await prisma.employment.count({ where: { workspaceId: workspace.id } }), 0);
  const again = await createCanonicalEntityFromObservation(prisma, observation.id);
  assert.equal(again?.idempotent, true);
  assert.equal(again?.entityId, person.id);
  assert.equal(await prisma.person.count({ where: { workspaceId: workspace.id } }), 1);
});

test("B creates a company from an explicit domain and does not infer one from the name", async () => {
  const { workspace, deal } = await workspaceDeal("Company");
  const namedOnly = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "Boston Properties",
  });
  const named = await createCanonicalEntityFromObservation(prisma, namedOnly.id);
  const bare = await prisma.company.findUniqueOrThrow({
    where: { id: named!.entityId },
    include: { identifiers: true, aliases: true },
  });
  assert.equal(bare.primaryDomain, null);
  assert.equal(bare.identifiers.length, 0);
  assert.equal(bare.aliases.length, 0);

  const observation = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "JLL",
    domain: "https://www.jll.com",
    rawAttributes: { observedWebsite: "https://www.jll.com" },
  });
  const created = await createCanonicalEntityFromObservation(prisma, observation.id);
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: created!.entityId },
    include: { identifiers: true },
  });
  assert.equal(company.canonicalName, "JLL");
  assert.equal(company.primaryDomain, "jll.com");
  assert.equal(company.website, "https://www.jll.com");
  assert.deepEqual(
    company.identifiers.map((identifier) => [identifier.kind, identifier.normalizedValue]),
    [["DOMAIN", "jll.com"]]
  );
  assert.equal(
    company.identifiers.some((identifier) => identifier.kind === "EMAIL_DOMAIN"),
    false
  );
});

test("C creates a property with its address and an explicit external identifier", async () => {
  const { workspace, deal } = await workspaceDeal("Property");
  const observation = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PROPERTY",
    surfaceForm: "200 Clarendon",
    addressLine1: "200 Clarendon Street",
    city: "Boston",
    region: "MA",
    postalCode: "02116",
    country: "US",
    rawAttributes: { externalScheme: "COST_AR", externalId: "parcel-200" },
  });
  const created = await createCanonicalEntityFromObservation(prisma, observation.id);
  const property = await prisma.property.findUniqueOrThrow({
    where: { id: created!.entityId },
    include: { aliases: true, externalIdentifiers: true },
  });
  assert.equal(property.canonicalName, "200 Clarendon");
  assert.equal(property.addressLine1, "200 Clarendon Street");
  assert.equal(property.city, "Boston");
  assert.equal(property.region, "MA");
  assert.equal(property.postalCode, "02116");
  assert.equal(property.country, "US");
  assert.equal(property.aliases.length, 0);
  assert.equal(property.externalIdentifiers[0]?.scheme, "COST_AR");
  assert.equal(property.externalIdentifiers[0]?.value, "parcel-200");
  const link = await prisma.entityResolutionLink.findFirstOrThrow({
    where: { entityObservationId: observation.id, status: "ACCEPTED" },
  });
  assert.equal(link.propertyId, property.id);
});

test("F a promoted entity stays in the observation workspace", async () => {
  const left = await workspaceDeal("Left firm");
  const right = await workspaceDeal("Right firm");
  await createPerson(prisma, {
    workspaceId: right.workspace.id,
    canonicalName: "Sarah Chen",
    identifiers: [{ kind: "EMAIL", value: "sarah.chen@jll.com" }],
  });
  const observation = await observePerson(left.workspace.id, left.deal.id, "Sarah Chen", {
    email: "sarah.chen@jll.com",
  });
  const created = await createCanonicalEntityFromObservation(prisma, observation.id);
  const person = await prisma.person.findUniqueOrThrow({ where: { id: created!.entityId } });
  assert.equal(person.workspaceId, left.workspace.id);
  assert.notEqual(person.workspaceId, right.workspace.id);
  assert.equal(await prisma.person.count({ where: { workspaceId: right.workspace.id } }), 1);
  const link = await prisma.entityResolutionLink.findUniqueOrThrow({
    where: { id: created!.resolutionLinkId },
  });
  assert.equal(link.workspaceId, left.workspace.id);
});

test("G a shared inbox is not stored as a person identifier", async () => {
  const { workspace, deal } = await workspaceDeal("Inbox");
  const observation = await observePerson(workspace.id, deal.id, "Leasing Desk", {
    email: "leasing@jll.com",
  });
  const preview = await previewCanonicalEntity(prisma, observation.id);
  assert.match(preview?.fields.find((field) => field.label === "Email")?.note ?? "", /Shared inbox/);
  const created = await createCanonicalEntityFromObservation(prisma, observation.id);
  const identifiers = await prisma.personIdentifier.count({ where: { personId: created!.entityId } });
  assert.equal(identifiers, 0);
});

test("H a conflicting unique identifier blocks promotion", async () => {
  const { workspace, deal } = await workspaceDeal("Conflict");
  await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Existing Sarah",
    identifiers: [{ kind: "EMAIL", value: "sarah.chen@jll.com" }],
  });
  const observation = await observePerson(workspace.id, deal.id, "Sarah Chen", {
    email: "sarah.chen@jll.com",
  });
  const beforePeople = await prisma.person.count({ where: { workspaceId: workspace.id } });
  await assert.rejects(
    () => createCanonicalEntityFromObservation(prisma, observation.id),
    (error: unknown) => error instanceof GraphInvariantError && /Conflicting/.test(error.message)
  );
  assert.equal(await prisma.person.count({ where: { workspaceId: workspace.id } }), beforePeople);
  assert.equal(
    await prisma.entityResolutionLink.count({ where: { entityObservationId: observation.id } }),
    0
  );
});

test("creating a canonical entity supersedes competing resolution candidates", async () => {
  const { workspace, deal } = await workspaceDeal("Candidates");
  const other = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Someone Else",
  });
  const observation = await observePerson(workspace.id, deal.id, "Dana Cho");
  await prisma.entityResolutionCandidate.create({
    data: {
      workspaceId: workspace.id,
      entityObservationId: observation.id,
      candidatePersonId: other.id,
      score: 0.4,
      features: {},
      positiveReasons: [],
      negativeReasons: [],
      temporalNotes: [],
    },
  });
  await createCanonicalEntityFromObservation(prisma, observation.id);
  const candidate = await prisma.entityResolutionCandidate.findFirstOrThrow({
    where: { entityObservationId: observation.id },
  });
  assert.equal(candidate.decision, "REJECTED");
});

async function linkedPair(name: string) {
  const { workspace, deal } = await workspaceDeal(name);
  const personObservation = await observePerson(workspace.id, deal.id, "Sarah Chen", {
    email: `sarah.${name.replace(/\s+/g, "")}@jll.com`,
  });
  const companyObservation = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "JLL",
    domain: `${name.replace(/\s+/g, "").toLowerCase()}.example`,
  });
  const person = await createCanonicalEntityFromObservation(prisma, personObservation.id);
  const company = await createCanonicalEntityFromObservation(prisma, companyObservation.id);
  return { workspace, deal, personObservation, companyObservation, person, company };
}

test("I WORKS_AT stays blocked until both endpoints resolve", async () => {
  const { workspace, deal } = await workspaceDeal("Blocked");
  const person = await observePerson(workspace.id, deal.id, "Sarah Chen");
  const company = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "JLL",
  });
  const relationship = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "WORKS_AT",
    subjectObservationId: person.id,
    objectObservationId: company.id,
    extractionConfidence: 0.99,
  });
  const preview = await previewRelationshipPromotion(prisma, relationship.id);
  assert.equal(preview?.status, "BLOCKED_UNRESOLVED_ENTITY");
  assert.equal(preview?.canApprove, false);
  await assert.rejects(
    () => approveRelationshipObservation(prisma, relationship.id),
    /unresolved/
  );
  assert.equal(await prisma.employment.count({ where: { workspaceId: workspace.id } }), 0);
});

test("J/O/P/S/T WORKS_AT creates one employment and extra support, and keeps exact provenance", async () => {
  const { workspace, deal } = await workspaceDeal("Employment");
  const quote = "Sarah Chen of JLL represented Acme Corp in the negotiations.";
  const document = await prisma.document.create({
    data: {
      dealId: deal.id,
      filename: "loi.pdf",
      originalFilename: "200 Clarendon LOI",
      mimeType: "application/pdf",
      sizeBytes: 20,
      sha256: `emp-${deal.id}`,
      documentType: "LOI",
      storageKey: `emp-${deal.id}.pdf`,
      pages: {
        create: [
          { pageNumber: 1, text: "Cover" },
          { pageNumber: 2, text: quote },
        ],
      },
    },
  });
  const person = await recordEntityObservation(prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    documentId: document.id,
    sourceKind: "DOCUMENT_PAGE",
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  const company = await recordEntityObservation(prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    documentId: document.id,
    sourceKind: "DOCUMENT_PAGE",
    observedType: "COMPANY",
    surfaceForm: "JLL",
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  await createCanonicalEntityFromObservation(prisma, person.id);
  await createCanonicalEntityFromObservation(prisma, company.id);
  const first = await recordRelationshipObservation(prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    documentId: document.id,
    contextDealId: deal.id,
    sourceKind: "DOCUMENT_PAGE",
    predicate: "WORKS_AT",
    subjectObservationId: person.id,
    objectObservationId: company.id,
    affiliationKind: "BROKER",
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
    extractionConfidence: 0.99,
  });
  const beforeRelationship = await prisma.relationshipObservation.findUniqueOrThrow({
    where: { id: first.id },
  });
  const approved = await approveRelationshipObservation(prisma, first.id);
  assert.equal(approved?.canonicalKind, "Employment");
  const employment = await prisma.employment.findUniqueOrThrow({ where: { id: approved!.canonicalId } });
  assert.equal(employment.affiliationKind, "BROKER");
  assert.equal(employment.validFrom, null);
  assert.equal(employment.validTo, null);
  assert.equal(employment.assertionSource, "OBSERVATION");
  assert.equal(await prisma.employment.count({ where: { workspaceId: workspace.id } }), 1);
  const afterRelationship = await prisma.relationshipObservation.findUniqueOrThrow({
    where: { id: first.id },
  });
  assert.deepEqual(afterRelationship, beforeRelationship);

  const secondPerson = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    evidenceQuote: "Sarah Chen remains at JLL.",
  });
  const secondCompany = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "JLL",
    evidenceQuote: "Sarah Chen remains at JLL.",
  });
  const sarah = await prisma.entityResolutionLink.findFirstOrThrow({
    where: { entityObservationId: person.id, status: "ACCEPTED" },
  });
  const jll = await prisma.entityResolutionLink.findFirstOrThrow({
    where: { entityObservationId: company.id, status: "ACCEPTED" },
  });
  await resolveToExisting(secondPerson.id, sarah.personId!);
  await resolveToExisting(secondCompany.id, jll.companyId!);
  const second = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "WORKS_AT",
    subjectObservationId: secondPerson.id,
    objectObservationId: secondCompany.id,
    affiliationKind: "BROKER",
    evidenceQuote: "Sarah Chen remains at JLL.",
  });
  const again = await approveRelationshipObservation(prisma, second.id);
  assert.equal(again?.canonicalId, employment.id);
  assert.equal(await prisma.employment.count({ where: { workspaceId: workspace.id } }), 1);
  assert.equal(await prisma.employmentSupport.count({ where: { employmentId: employment.id } }), 2);

  const evidence = await getRelationshipEvidence(prisma, { employmentId: employment.id });
  assert.equal(evidence?.supportCount, 2);
  const exact = evidence?.supports.find((support) => support.observationId === first.id);
  assert.equal(exact?.provenanceStatus, "EXACT");
  assert.equal(exact?.pageNumber, 2);
  assert.equal(exact?.documentName, "200 Clarendon LOI");
  assert.equal(exact?.quote, quote);
  assert.equal(exact?.href, `/api/documents/${document.id}/file#page=2`);
});

test("K/L/V OWNS and MANAGES create stakes and do not replace a competing owner", async () => {
  const { workspace, deal } = await workspaceDeal("Stakes");
  async function company(name: string) {
    const observation = await recordEntityObservation(prisma, {
      ...manual,
      workspaceId: workspace.id,
      dealId: deal.id,
      observedType: "COMPANY",
      surfaceForm: name,
    });
    const created = await createCanonicalEntityFromObservation(prisma, observation.id);
    return { observation, entityId: created!.entityId };
  }
  const boston = await company("Boston Properties");
  const acme = await company("Acme Properties");
  const propertyObservation = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PROPERTY",
    surfaceForm: "200 Clarendon",
    addressLine1: "200 Clarendon Street",
    city: "Boston",
  });
  const property = await createCanonicalEntityFromObservation(prisma, propertyObservation.id);
  async function stake(predicate: "OWNS" | "MANAGES", companyObservationId: string) {
    return recordRelationshipObservation(prisma, {
      ...manual,
      workspaceId: workspace.id,
      dealId: deal.id,
      contextDealId: deal.id,
      predicate,
      subjectObservationId: companyObservationId,
      objectObservationId: propertyObservation.id,
    });
  }
  const owns = await approveRelationshipObservation(prisma, (await stake("OWNS", boston.observation.id)).id);
  const manages = await approveRelationshipObservation(
    prisma,
    (await stake("MANAGES", acme.observation.id)).id
  );
  assert.equal(owns?.canonicalKind, "PropertyStake");
  assert.equal(manages?.canonicalKind, "PropertyStake");
  const ownsRow = await prisma.propertyStake.findUniqueOrThrow({ where: { id: owns!.canonicalId } });
  const managesRow = await prisma.propertyStake.findUniqueOrThrow({ where: { id: manages!.canonicalId } });
  assert.equal(ownsRow.predicate, "OWNS");
  assert.equal(ownsRow.propertyId, property!.entityId);
  assert.equal(managesRow.predicate, "MANAGES");

  const later = await stake("OWNS", acme.observation.id);
  const preview = await previewRelationshipPromotion(prisma, later.id);
  assert.ok(preview?.conflicts.some((conflict) => /Competing OWNS/.test(conflict.message)));
  const competing = await approveRelationshipObservation(prisma, later.id);
  const rows = await prisma.propertyStake.findMany({
    where: { workspaceId: workspace.id, predicate: "OWNS", status: "ASSERTED" },
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.validTo == null && row.status === "ASSERTED"));
  assert.notEqual(competing?.canonicalId, ownsRow.id);
});

test("M/N PARTICIPATES_AS keeps representation on one participation", async () => {
  const { workspace, deal, person, company, personObservation } = await linkedPair("Participation");
  const principalObservation = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "Acme Corp",
  });
  const principal = await createCanonicalEntityFromObservation(prisma, principalObservation.id);
  const created = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "PARTICIPATES_AS",
    subjectObservationId: personObservation.id,
    participationRole: "TENANT_BROKER",
    principalObservationId: principalObservation.id,
    evidenceQuote: "Sarah Chen of JLL represented Acme Corp.",
  });
  const approved = await approveRelationshipObservation(prisma, created.id);
  const participation = await prisma.dealParticipation.findUniqueOrThrow({
    where: { id: approved!.canonicalId },
  });
  assert.equal(participation.role, "TENANT_BROKER");
  assert.equal(participation.personId, person!.entityId);
  assert.equal(participation.representsCompanyId, principal!.entityId);
  assert.equal(participation.companyId, null);
  assert.equal(company!.entityId.length > 0, true);

  const repeatSubject = await observePerson(workspace.id, deal.id, "Sarah Chen");
  await resolveToExisting(repeatSubject.id, person!.entityId);
  const repeatPrincipal = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "Acme Corp",
  });
  await resolveToExisting(repeatPrincipal.id, principal!.entityId);
  const repeat = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "PARTICIPATES_AS",
    subjectObservationId: repeatSubject.id,
    participationRole: "TENANT_BROKER",
    principalObservationId: repeatPrincipal.id,
    evidenceQuote: "Sarah Chen still represents Acme Corp.",
  });
  const second = await approveRelationshipObservation(prisma, repeat.id);
  assert.equal(second?.canonicalId, participation.id);
  assert.equal(
    await prisma.dealParticipation.count({ where: { workspaceId: workspace.id } }),
    1
  );
  assert.equal(
    await prisma.dealParticipationSupport.count({ where: { dealParticipationId: participation.id } }),
    2
  );
});

test("Q/R reject creates no canonical row and leaves the observation immutable", async () => {
  const { workspace, deal, personObservation, companyObservation } = await linkedPair("Reject");
  const relationship = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "WORKS_AT",
    subjectObservationId: personObservation.id,
    objectObservationId: companyObservation.id,
  });
  const before = await prisma.relationshipObservation.findUniqueOrThrow({
    where: { id: relationship.id },
  });
  const rejected = await rejectRelationshipObservation(prisma, relationship.id, "Not our graph");
  assert.equal(rejected?.decision, "REJECTED");
  assert.equal(await prisma.employment.count({ where: { workspaceId: workspace.id } }), 0);
  assert.equal(
    await prisma.employmentSupport.count({
      where: { relationshipObservation: { workspaceId: workspace.id } },
    }),
    0
  );
  const after = await prisma.relationshipObservation.findUniqueOrThrow({
    where: { id: relationship.id },
  });
  assert.deepEqual(after, before);
  const stored = await prisma.relationshipPromotion.findUniqueOrThrow({
    where: { relationshipObservationId: relationship.id },
  });
  assert.equal(stored.actor, "MANUAL_REVIEW");
  assert.equal(stored.decision, "REJECTED");
});

test("U competing employers both stay open", async () => {
  const { workspace, deal } = await workspaceDeal("Two employers");
  const person = await observePerson(workspace.id, deal.id, "Sarah Chen", {
    email: "sarah.two@jll.com",
  });
  await createCanonicalEntityFromObservation(prisma, person.id);
  async function employer(name: string, domain: string) {
    const observation = await recordEntityObservation(prisma, {
      ...manual,
      workspaceId: workspace.id,
      dealId: deal.id,
      observedType: "COMPANY",
      surfaceForm: name,
      domain,
    });
    await createCanonicalEntityFromObservation(prisma, observation.id);
    const relationship = await recordRelationshipObservation(prisma, {
      ...manual,
      workspaceId: workspace.id,
      dealId: deal.id,
      contextDealId: deal.id,
      predicate: "WORKS_AT",
      subjectObservationId: person.id,
      objectObservationId: observation.id,
      affiliationKind: "BROKER",
    });
    return relationship.id;
  }
  await approveRelationshipObservation(prisma, await employer("JLL", "jll-two.example"));
  const secondPreview = await previewRelationshipPromotion(
    prisma,
    await employer("CBRE", "cbre-two.example")
  );
  assert.ok(secondPreview?.conflicts.some((conflict) => /temporal change/.test(conflict.message)));
  await approveRelationshipObservation(prisma, secondPreview!.relationshipObservationId);
  const rows = await prisma.employment.findMany({
    where: { workspaceId: workspace.id, status: "ASSERTED" },
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.validTo == null));
});

test("W high confidence alone does not promote", async () => {
  const { workspace, deal } = await workspaceDeal("No auto");
  const person = await observePerson(workspace.id, deal.id, "Sarah Chen", {
    email: "sarah.auto@jll.com",
    extractionConfidence: 0.99,
  });
  const company = await recordEntityObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "JLL",
    extractionConfidence: 0.99,
  });
  const relationship = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "WORKS_AT",
    subjectObservationId: person.id,
    objectObservationId: company.id,
    extractionConfidence: 0.99,
  });
  await previewCanonicalEntity(prisma, person.id);
  await previewRelationshipPromotion(prisma, relationship.id);
  assert.equal(await prisma.person.count({ where: { workspaceId: workspace.id } }), 0);
  assert.equal(await prisma.company.count({ where: { workspaceId: workspace.id } }), 0);
  assert.equal(await prisma.employment.count({ where: { workspaceId: workspace.id } }), 0);
  assert.equal(await prisma.entityResolutionLink.count({ where: { workspaceId: workspace.id } }), 0);
  assert.equal(await prisma.relationshipPromotion.count({ where: { workspaceId: workspace.id } }), 0);
});

test("CONCERNS_PROPERTY links a deal once and does not replace a different property", async () => {
  const { workspace, deal } = await workspaceDeal("Concerns");
  async function property(name: string) {
    const observation = await recordEntityObservation(prisma, {
      ...manual,
      workspaceId: workspace.id,
      dealId: deal.id,
      observedType: "PROPERTY",
      surfaceForm: name,
      addressLine1: `${name} Street`,
      city: "Boston",
    });
    await createCanonicalEntityFromObservation(prisma, observation.id);
    return observation;
  }
  const first = await property("200 Clarendon");
  const second = await property("One Congress");
  const concern = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "CONCERNS_PROPERTY",
    subjectObservationId: first.id,
  });
  await approveRelationshipObservation(prisma, concern.id);
  const linked = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  const firstEntity = await prisma.entityResolutionLink.findFirstOrThrow({
    where: { entityObservationId: first.id, status: "ACCEPTED" },
  });
  assert.equal(linked.propertyId, firstEntity.propertyId);
  const other = await recordRelationshipObservation(prisma, {
    ...manual,
    workspaceId: workspace.id,
    dealId: deal.id,
    contextDealId: deal.id,
    predicate: "CONCERNS_PROPERTY",
    subjectObservationId: second.id,
    evidenceQuote: "The deal later moved to One Congress.",
  });
  await assert.rejects(() => approveRelationshipObservation(prisma, other.id), /not replaced/);
  const still = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
  assert.equal(still.propertyId, firstEntity.propertyId);
});

test("X deal knowledge returns the canonical graph and pending observations", async () => {
  const { workspace, deal } = await workspaceDeal("Knowledge");
  async function entity(
    type: "PERSON" | "COMPANY" | "PROPERTY",
    surfaceForm: string,
    extra: Record<string, unknown> = {}
  ) {
    const observation = await recordEntityObservation(prisma, {
      ...manual,
      workspaceId: workspace.id,
      dealId: deal.id,
      observedType: type,
      surfaceForm,
      ...extra,
    });
    const created = await createCanonicalEntityFromObservation(prisma, observation.id);
    return { observation, created };
  }
  const sarah = await entity("PERSON", "Sarah Chen", { email: "sarah.knowledge@jll.com", title: "Tenant Broker" });
  const priya = await entity("PERSON", "Priya Shah", { email: "priya.knowledge@cbre.com" });
  const jll = await entity("COMPANY", "JLL", { domain: "knowledge-jll.example" });
  const cbre = await entity("COMPANY", "CBRE", { domain: "knowledge-cbre.example" });
  const boston = await entity("COMPANY", "Boston Properties", { domain: "knowledge-bp.example" });
  const harbor = await entity("COMPANY", "Harborline Management", { domain: "knowledge-harbor.example" });
  const acme = await entity("COMPANY", "Acme Corp", { domain: "knowledge-acme.example" });
  const clarendon = await entity("PROPERTY", "200 Clarendon", {
    addressLine1: "200 Clarendon Street",
    city: "Boston",
    region: "MA",
  });
  const pending = await observePerson(workspace.id, deal.id, "Unresolved Alex");

  async function relate(
    predicate: "WORKS_AT" | "OWNS" | "MANAGES" | "OCCUPIES" | "PARTICIPATES_AS" | "CONCERNS_PROPERTY",
    subjectId: string,
    extra: Record<string, unknown> = {}
  ) {
    const relationship = await recordRelationshipObservation(prisma, {
      ...manual,
      workspaceId: workspace.id,
      dealId: deal.id,
      contextDealId: deal.id,
      predicate,
      subjectObservationId: subjectId,
      ...extra,
    });
    await approveRelationshipObservation(prisma, relationship.id);
  }
  await relate("WORKS_AT", sarah.observation.id, {
    objectObservationId: jll.observation.id,
    affiliationKind: "BROKER",
  });
  await relate("WORKS_AT", priya.observation.id, {
    objectObservationId: cbre.observation.id,
    affiliationKind: "BROKER",
  });
  await relate("OWNS", boston.observation.id, { objectObservationId: clarendon.observation.id });
  await relate("MANAGES", harbor.observation.id, { objectObservationId: clarendon.observation.id });
  await relate("OCCUPIES", acme.observation.id, { objectObservationId: clarendon.observation.id });
  await relate("CONCERNS_PROPERTY", clarendon.observation.id);
  await relate("PARTICIPATES_AS", sarah.observation.id, {
    participationRole: "TENANT_BROKER",
    principalObservationId: acme.observation.id,
  });
  await relate("PARTICIPATES_AS", priya.observation.id, {
    participationRole: "LANDLORD_BROKER",
    principalObservationId: boston.observation.id,
  });

  const knowledge = await getDealKnowledge(prisma, deal.id);
  assert.ok(knowledge);
  assert.equal(knowledge.canonical.property?.name, "200 Clarendon");
  assert.deepEqual(
    knowledge.canonical.stakes.map((stake) => `${stake.predicate}:${stake.companyName}`).sort(),
    ["MANAGES:Harborline Management", "OCCUPIES:Acme Corp", "OWNS:Boston Properties"]
  );
  const sarahRow = knowledge.canonical.people.find((person) => person.name === "Sarah Chen");
  assert.ok(sarahRow);
  assert.ok(sarahRow.roles.includes("Tenant Broker"));
  assert.equal(sarahRow.employers[0]?.companyName, "JLL");
  const priyaRow = knowledge.canonical.people.find((person) => person.name === "Priya Shah");
  assert.equal(priyaRow?.employers[0]?.companyName, "CBRE");
  assert.ok(priyaRow?.roles.includes("Landlord Broker"));
  const participation = knowledge.canonical.participations.find((row) => row.actorName === "Sarah Chen");
  assert.equal(participation?.representsCompanyName, "Acme Corp");
  assert.equal(participation?.evidence.supportCount, 1);
  assert.ok(knowledge.pending.entities.some((entity) => entity.id === pending.id));
  assert.equal(
    knowledge.pending.relationships.some((row) => row.status === "APPROVED"),
    false
  );
});

test("ambiguous provenance is reported without a page number", async () => {
  const { workspace, deal } = await workspaceDeal("Ambiguous");
  const quote = "Shared sentence.";
  const document = await prisma.document.create({
    data: {
      dealId: deal.id,
      filename: "split.pdf",
      originalFilename: "split.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: `amb-${deal.id}`,
      documentType: "OTHER",
      storageKey: `amb-${deal.id}.pdf`,
      pages: {
        create: [
          { pageNumber: 1, text: quote },
          { pageNumber: 2, text: quote },
        ],
      },
    },
  });
  const person = await recordEntityObservation(prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    documentId: document.id,
    sourceKind: "DOCUMENT_PAGE",
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  const company = await recordEntityObservation(prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    documentId: document.id,
    sourceKind: "DOCUMENT_PAGE",
    observedType: "COMPANY",
    surfaceForm: "JLL",
    domain: "ambiguous.example",
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  await createCanonicalEntityFromObservation(prisma, person.id);
  await createCanonicalEntityFromObservation(prisma, company.id);
  const relationship = await recordRelationshipObservation(prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    documentId: document.id,
    contextDealId: deal.id,
    sourceKind: "DOCUMENT_PAGE",
    predicate: "WORKS_AT",
    subjectObservationId: person.id,
    objectObservationId: company.id,
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  assert.equal(relationship.provenanceStatus, "AMBIGUOUS");
  const approved = await approveRelationshipObservation(prisma, relationship.id);
  const evidence = await getRelationshipEvidence(prisma, { employmentId: approved!.canonicalId });
  assert.equal(evidence?.supports[0]?.provenanceStatus, "AMBIGUOUS");
  assert.equal(evidence?.supports[0]?.pageNumber, null);
});
