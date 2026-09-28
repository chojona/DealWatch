import assert from "node:assert/strict";
import test from "node:test";
import { GraphInvariantError } from "./errors";
import { listGraphEdges } from "./graphEdge";
import { seedClarendonGraph } from "./seedClarendonGraph";
import {
  addCompanyIdentifier,
  addPersonIdentifier,
  addPropertyAlias,
  attachObservationSupport,
  createCompany,
  createDealParticipation,
  createEmployment,
  createPerson,
  createProperty,
  createPropertyStake,
  createWorkspace,
  deleteDocumentPreservingEvidence,
  getDealParticipants,
  getEntityRelationships,
  getRelationshipEvidence,
  linkDealProperty,
  recordEntityObservation,
  recordObservationDisposition,
  recordRelationshipObservation,
  retireEmployment,
} from "./service";
import { createTestDatabase } from "@/lib/documents/testDb";

const manualEvidence = {
  sourceKind: "MANUAL" as const,
  evidenceQuote: "Recorded by an analyst from a conversation.",
  extractor: "manual",
  extractorVersion: "test",
};

let db: Awaited<ReturnType<typeof createTestDatabase>>;

test.before(async () => {
  db = await createTestDatabase();
});

test.after(async () => {
  await db.cleanup();
});

async function freshWorkspace(name: string) {
  return createWorkspace(db.prisma, { name });
}

async function freshDeal(
  workspaceId: string,
  property = "200 Clarendon Street, Boston MA"
) {
  return db.prisma.deal.create({
    data: {
      name: "200 Clarendon Lease — Acme Corp",
      company: "Acme Corp",
      property,
      stage: "Negotiation",
      status: "ACTIVE",
      workspaceId,
    },
  });
}

test("create workspace", async () => {
  const workspace = await freshWorkspace("Northbridge Realty");
  assert.equal(workspace.name, "Northbridge Realty");
  assert.equal(workspace.firmCompanyId, null);
});

test("create person, company, and property", async () => {
  const workspace = await freshWorkspace("Entity basics");
  const person = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
    firstName: "Sarah",
    lastName: "Chen",
  });
  const company = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Acme Corp",
    legalName: "Acme Corporation",
  });
  const property = await createProperty(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "200 Clarendon",
    addressLine1: "200 Clarendon Street",
    city: "Boston",
    region: "MA",
    assetType: "OFFICE",
  });
  assert.equal(person.canonicalName, "Sarah Chen");
  assert.equal(company.legalName, "Acme Corporation");
  assert.equal(property.city, "Boston");
  assert.equal(property.workspaceId, workspace.id);
});

test("existing deal participates directly and no duplicate deal entity exists", async () => {
  const workspace = await freshWorkspace("Deal node");
  const before = await db.prisma.deal.count();
  const deal = await freshDeal(workspace.id);
  const company = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Acme Corp",
  });
  const participation = await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT",
    companyId: company.id,
    assertionSource: "MANUAL",
  });
  assert.equal(participation.dealId, deal.id);
  assert.equal(await db.prisma.deal.count(), before + 1);
  assert.equal("entity" in db.prisma, false);
});

test("workspace isolation and the same company name in separate workspaces", async () => {
  const left = await freshWorkspace("Firm A");
  const right = await freshWorkspace("Firm B");
  const leftCompany = await createCompany(db.prisma, {
    workspaceId: left.id,
    canonicalName: "CBRE",
  });
  const rightCompany = await createCompany(db.prisma, {
    workspaceId: right.id,
    canonicalName: "CBRE",
  });
  assert.notEqual(leftCompany.id, rightCompany.id);
  const person = await createPerson(db.prisma, {
    workspaceId: left.id,
    canonicalName: "Alex Kim",
  });
  await assert.rejects(
    () =>
      createEmployment(db.prisma, {
        workspaceId: left.id,
        personId: person.id,
        companyId: rightCompany.id,
        assertionSource: "MANUAL",
      }),
    GraphInvariantError
  );
});

test("person identifier behavior and shared inbox does not force identity collision", async () => {
  const workspace = await freshWorkspace("Inboxes");
  const first = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Alex Kim",
    identifiers: [{ kind: "EMAIL", value: "Alex.Kim@firm.com" }],
  });
  const second = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Alex Kim",
  });
  const stored = await db.prisma.personIdentifier.findFirstOrThrow({
    where: { personId: first.id },
  });
  assert.equal(stored.normalizedValue, "alex.kim@firm.com");
  await assert.rejects(
    () =>
      addPersonIdentifier(db.prisma, {
        workspaceId: workspace.id,
        personId: second.id,
        kind: "EMAIL",
        value: "leasing@firm.com",
      }).then(() =>
        addPersonIdentifier(db.prisma, {
          workspaceId: workspace.id,
          personId: first.id,
          kind: "EMAIL",
          value: "leasing@firm.com",
        })
      ),
    GraphInvariantError
  );
  assert.equal(
    await db.prisma.person.count({ where: { workspaceId: workspace.id } }),
    2
  );
  await recordEntityObservation(db.prisma, {
    ...manualEvidence,
    workspaceId: workspace.id,
    observedType: "PERSON",
    surfaceForm: "Leasing Desk",
    email: "leasing@firm.com",
  });
  await recordEntityObservation(db.prisma, {
    ...manualEvidence,
    workspaceId: workspace.id,
    observedType: "PERSON",
    surfaceForm: "Another Leasing Desk",
    email: "leasing@firm.com",
  });
  assert.equal(
    await db.prisma.person.count({ where: { workspaceId: workspace.id } }),
    2
  );
});

test("company domain identifier behavior", async () => {
  const workspace = await freshWorkspace("Domains");
  const other = await freshWorkspace("Domains other");
  const company = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "CBRE",
    primaryDomain: "HTTPS://www.CBRE.com/about",
  });
  const identifier = await db.prisma.companyIdentifier.findFirstOrThrow({
    where: { companyId: company.id, kind: "DOMAIN" },
  });
  assert.equal(identifier.normalizedValue, "cbre.com");
  assert.equal(
    (await db.prisma.company.findUniqueOrThrow({ where: { id: company.id } }))
      .primaryDomain,
    "cbre.com"
  );
  await assert.rejects(
    () =>
      createCompany(db.prisma, {
        workspaceId: workspace.id,
        canonicalName: "CBRE Group",
        primaryDomain: "cbre.com",
      }),
    GraphInvariantError
  );
  const elsewhere = await createCompany(db.prisma, {
    workspaceId: other.id,
    canonicalName: "CBRE",
    primaryDomain: "cbre.com",
  });
  assert.notEqual(elsewhere.id, company.id);
  await addCompanyIdentifier(db.prisma, {
    workspaceId: workspace.id,
    companyId: company.id,
    kind: "EMAIL_DOMAIN",
    value: "jllboston.com",
  });
});

test("property alias and external identifier behavior", async () => {
  const workspace = await freshWorkspace("Properties");
  const other = await freshWorkspace("Properties other");
  const property = await createProperty(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "200 Clarendon",
    aliases: ["John Hancock Tower"],
    externalIdentifiers: [{ scheme: "COST_AR", value: "parcel-1" }],
  });
  const alias = await db.prisma.propertyAlias.findFirstOrThrow({
    where: { propertyId: property.id },
  });
  assert.equal(alias.normalizedAlias, "john hancock tower");
  await addPropertyAlias(db.prisma, {
    workspaceId: workspace.id,
    propertyId: (
      await createProperty(db.prisma, {
        workspaceId: workspace.id,
        canonicalName: "100 Federal",
      })
    ).id,
    alias: "Federal Street",
  });
  await assert.rejects(
    () =>
      createProperty(db.prisma, {
        workspaceId: workspace.id,
        canonicalName: "Other Tower",
        externalIdentifiers: [{ scheme: "COST_AR", value: "parcel-1" }],
      }),
    GraphInvariantError
  );
  const elsewhere = await createProperty(db.prisma, {
    workspaceId: other.id,
    canonicalName: "200 Clarendon",
    externalIdentifiers: [{ scheme: "COST_AR", value: "parcel-1" }],
  });
  assert.notEqual(elsewhere.id, property.id);
});

test("normalization does not merge CBRE with CBRE Group or JLL Boston with JLL", async () => {
  const workspace = await freshWorkspace("Unresolved names");
  const cbre = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "CBRE",
  });
  const group = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "CBRE Group",
  });
  const jllBoston = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL Boston",
  });
  const jll = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL",
  });
  assert.equal(new Set([cbre.id, group.id, jllBoston.id, jll.id]).size, 4);
});

test("employment temporal bounds and a second employer does not auto-close the first", async () => {
  const workspace = await freshWorkspace("Employment");
  const person = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
  });
  const jll = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL Boston",
  });
  const cbre = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "CBRE",
  });
  const first = await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: person.id,
    companyId: jll.id,
    affiliationKind: "BROKER",
    validFrom: new Date("2024-01-01"),
    validTo: new Date("2024-12-31"),
    validFromPrecision: "DAY",
    validToPrecision: "DAY",
    assertionSource: "MANUAL",
  });
  assert.equal(first.validFrom?.toISOString().slice(0, 10), "2024-01-01");
  await assert.rejects(
    () =>
      createEmployment(db.prisma, {
        workspaceId: workspace.id,
        personId: person.id,
        companyId: jll.id,
        validFrom: new Date("2025-02-01"),
        validTo: new Date("2025-01-01"),
        assertionSource: "MANUAL",
      }),
    /validTo/
  );
  const second = await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: person.id,
    companyId: cbre.id,
    affiliationKind: "BROKER",
    assertionSource: "MANUAL",
  });
  const stillOpen = await db.prisma.employment.findUniqueOrThrow({
    where: { id: first.id },
  });
  assert.equal(stillOpen.status, "ASSERTED");
  assert.equal(stillOpen.validTo?.toISOString().slice(0, 10), "2024-12-31");
  assert.equal(second.validTo, null);
  assert.equal(
    await db.prisma.employment.count({
      where: { personId: person.id, status: "ASSERTED" },
    }),
    2
  );
});

test("a retired employment can be followed by a new open row for the same firm", async () => {
  const workspace = await freshWorkspace("Rehire");
  const person = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
  });
  const company = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL Boston",
  });
  const first = await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: person.id,
    companyId: company.id,
    affiliationKind: "STAFF",
    assertionSource: "MANUAL",
  });
  await retireEmployment(db.prisma, {
    workspaceId: workspace.id,
    employmentId: first.id,
  });
  const again = await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: person.id,
    companyId: company.id,
    affiliationKind: "STAFF",
    assertionSource: "MANUAL",
  });
  assert.notEqual(again.id, first.id);
  await assert.rejects(
    () =>
      db.prisma.employment.create({
        data: {
          workspaceId: workspace.id,
          personId: person.id,
          companyId: company.id,
          affiliationKind: "STAFF",
          assertionSource: "MANUAL",
        },
      }),
    /Unique constraint/
  );
});

test("property stakes record OWNS and MANAGES and do not infer OCCUPIES from a deal", async () => {
  const workspace = await freshWorkspace("Stakes");
  const deal = await freshDeal(workspace.id);
  const owner = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Boston Properties",
  });
  const manager = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Harborline Management",
  });
  const tenant = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Acme Corp",
  });
  const property = await createProperty(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "200 Clarendon",
  });
  const owns = await createPropertyStake(db.prisma, {
    workspaceId: workspace.id,
    companyId: owner.id,
    propertyId: property.id,
    predicate: "OWNS",
    assertionSource: "MANUAL",
  });
  const manages = await createPropertyStake(db.prisma, {
    workspaceId: workspace.id,
    companyId: manager.id,
    propertyId: property.id,
    predicate: "MANAGES",
    assertionSource: "MANUAL",
  });
  await linkDealProperty(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    propertyId: property.id,
  });
  await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT",
    companyId: tenant.id,
    assertionSource: "MANUAL",
  });
  assert.equal(owns.predicate, "OWNS");
  assert.equal(manages.predicate, "MANAGES");
  assert.equal(
    await db.prisma.propertyStake.count({
      where: { propertyId: property.id, predicate: "OCCUPIES" },
    }),
    0
  );
});

test("deal participation keeps representation on the deal and does not create WORKS_AT", async () => {
  const workspace = await freshWorkspace("Participation");
  const deal = await freshDeal(workspace.id);
  const acme = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Acme Corp",
  });
  const owner = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Boston Properties",
  });
  const jll = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL Boston",
  });
  const sarah = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
  });
  const priya = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Priya Shah",
  });
  await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT",
    companyId: acme.id,
    assertionSource: "MANUAL",
  });
  await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "LANDLORD",
    companyId: owner.id,
    assertionSource: "MANUAL",
  });
  const tenantBroker = await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT_BROKER",
    personId: sarah.id,
    representsCompanyId: acme.id,
    assertionSource: "MANUAL",
  });
  const landlordBroker = await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "LANDLORD_BROKER",
    personId: priya.id,
    representsCompanyId: owner.id,
    assertionSource: "MANUAL",
  });
  await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: sarah.id,
    companyId: jll.id,
    affiliationKind: "BROKER",
    assertionSource: "MANUAL",
  });
  assert.equal(tenantBroker.representsCompanyId, acme.id);
  assert.equal(tenantBroker.dealId, deal.id);
  assert.equal(landlordBroker.role, "LANDLORD_BROKER");
  assert.equal(
    await db.prisma.employment.count({
      where: { personId: sarah.id, companyId: acme.id },
    }),
    0
  );
  assert.equal(
    await db.prisma.employment.count({
      where: { personId: priya.id },
    }),
    0
  );
  const participants = await getDealParticipants(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
  });
  assert.equal(participants.length, 4);
  await assert.rejects(
    () =>
      createDealParticipation(db.prisma, {
        workspaceId: workspace.id,
        dealId: deal.id,
        role: "TENANT_BROKER",
        personId: sarah.id,
        companyId: jll.id,
        assertionSource: "MANUAL",
      }),
    /exactly one/
  );
});

test("observations stay immutable, can conflict, and many can support one employment", async () => {
  const workspace = await freshWorkspace("Observations");
  const deal = await freshDeal(workspace.id);
  const person = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
  });
  const jll = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL Boston",
  });
  const cbre = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "CBRE",
  });
  const sarah = await recordEntityObservation(db.prisma, {
    ...manualEvidence,
    workspaceId: workspace.id,
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    title: "Senior Vice President",
    email: "sarah@example.com",
    dealId: deal.id,
  });
  const jllMention = await recordEntityObservation(db.prisma, {
    ...manualEvidence,
    workspaceId: workspace.id,
    observedType: "COMPANY",
    surfaceForm: "JLL Boston",
    dealId: deal.id,
  });
  const cbreMention = await recordEntityObservation(db.prisma, {
    ...manualEvidence,
    workspaceId: workspace.id,
    observedType: "COMPANY",
    surfaceForm: "CBRE",
    dealId: deal.id,
  });
  assert.equal(sarah.normalizedName, "sarah chen");
  assert.equal(sarah.email, "sarah@example.com");
  assert.equal("personId" in sarah, false);
  const before = sarah.surfaceForm;
  await recordObservationDisposition(db.prisma, {
    entityObservationId: sarah.id,
    disposition: "ACCEPTED",
    actor: "USER",
  });
  const reread = await db.prisma.entityObservation.findUniqueOrThrow({
    where: { id: sarah.id },
  });
  assert.equal(reread.surfaceForm, before);
  assert.equal(reread.createdAt.getTime(), sarah.createdAt.getTime());

  const employment = await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: person.id,
    companyId: jll.id,
    affiliationKind: "BROKER",
    assertionSource: "MANUAL",
  });
  const supports = [];
  for (let index = 0; index < 17; index += 1) {
    const observation = await recordRelationshipObservation(db.prisma, {
      ...manualEvidence,
      evidenceQuote: `Analyst note ${index} that Sarah Chen works at JLL Boston.`,
      workspaceId: workspace.id,
      predicate: "WORKS_AT",
      subjectObservationId: sarah.id,
      objectObservationId: jllMention.id,
      affiliationKind: "BROKER",
      contextDealId: deal.id,
      dealId: deal.id,
    });
    supports.push(
      await attachObservationSupport(db.prisma, {
        workspaceId: workspace.id,
        employmentId: employment.id,
        relationshipObservationId: observation.id,
      })
    );
  }
  const conflicting = await recordRelationshipObservation(db.prisma, {
    ...manualEvidence,
    evidenceQuote: "A later note says Sarah Chen works at CBRE.",
    workspaceId: workspace.id,
    predicate: "WORKS_AT",
    subjectObservationId: sarah.id,
    objectObservationId: cbreMention.id,
    contextDealId: deal.id,
    dealId: deal.id,
  });
  assert.equal(supports.length, 17);
  assert.equal(
    await db.prisma.employment.count({ where: { personId: person.id } }),
    1
  );
  assert.equal(
    await db.prisma.employment.count({
      where: { personId: person.id, companyId: cbre.id },
    }),
    0
  );
  assert.equal(
    (
      await db.prisma.employment.findUniqueOrThrow({ where: { id: employment.id } })
    ).validTo,
    null
  );
  assert.ok(conflicting.id);
  assert.equal(
    await db.prisma.relationshipObservation.count({
      where: { workspaceId: workspace.id, predicate: "WORKS_AT" },
    }),
    18
  );
  await assert.rejects(
    () =>
      recordRelationshipObservation(db.prisma, {
        ...manualEvidence,
        workspaceId: workspace.id,
        predicate: "WORKS_AT",
        subjectObservationId: jllMention.id,
        objectObservationId: cbreMention.id,
        dealId: deal.id,
      }),
    /person subject/
  );
});

test("provenance reaches DocumentPage and deleting that evidence is refused", async () => {
  const workspace = await freshWorkspace("Provenance");
  const deal = await freshDeal(workspace.id);
  const quote = "Sarah Chen | Senior Vice President | JLL Boston";
  const text = `Letterhead\n${quote}\nend`;
  const document = await db.prisma.document.create({
    data: {
      dealId: deal.id,
      filename: "loi.pdf",
      originalFilename: "loi.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: `prov-${workspace.id}`,
      documentType: "LOI",
      storageKey: `prov-${workspace.id}.pdf`,
      pages: { create: [{ pageNumber: 1, text }] },
    },
  });
  const bare = await db.prisma.document.create({
    data: {
      dealId: deal.id,
      filename: "empty.pdf",
      originalFilename: "empty.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
      sha256: `bare-${workspace.id}`,
      documentType: "OTHER",
      storageKey: `bare-${workspace.id}.pdf`,
      pages: { create: [{ pageNumber: 1, text: "No parties named." }] },
    },
  });
  const subject = await recordEntityObservation(db.prisma, {
    workspaceId: workspace.id,
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    sourceKind: "DOCUMENT_PAGE",
    dealId: deal.id,
    documentId: document.id,
    evidenceQuote: "Sarah Chen",
    extractor: "manual",
    extractorVersion: "test",
  });
  const object = await recordEntityObservation(db.prisma, {
    workspaceId: workspace.id,
    observedType: "COMPANY",
    surfaceForm: "JLL Boston",
    sourceKind: "DOCUMENT_PAGE",
    dealId: deal.id,
    documentId: document.id,
    evidenceQuote: "JLL Boston",
    extractor: "manual",
    extractorVersion: "test",
  });
  assert.equal(subject.provenanceStatus, "EXACT");
  assert.ok(subject.documentPageId);
  const page = await db.prisma.documentPage.findUniqueOrThrow({
    where: { id: subject.documentPageId! },
  });
  assert.equal(
    page.text.slice(subject.evidenceStartOffset!, subject.evidenceEndOffset!),
    "Sarah Chen"
  );
  const person = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
  });
  const company = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL Boston",
  });
  const employment = await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: person.id,
    companyId: company.id,
    affiliationKind: "BROKER",
    assertionSource: "MANUAL",
  });
  const relationship = await recordRelationshipObservation(db.prisma, {
    workspaceId: workspace.id,
    predicate: "WORKS_AT",
    subjectObservationId: subject.id,
    objectObservationId: object.id,
    affiliationKind: "BROKER",
    statedTitle: "Senior Vice President",
    contextDealId: deal.id,
    sourceKind: "DOCUMENT_PAGE",
    dealId: deal.id,
    documentId: document.id,
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  await attachObservationSupport(db.prisma, {
    workspaceId: workspace.id,
    employmentId: employment.id,
    relationshipObservationId: relationship.id,
  });
  const evidence = await getRelationshipEvidence(db.prisma, {
    workspaceId: workspace.id,
    assertionType: "EMPLOYMENT",
    assertionId: employment.id,
  });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.documentPage?.id, relationship.documentPageId);
  assert.equal(evidence[0]?.document?.id, document.id);
  assert.equal(
    evidence[0]?.documentPage?.text.slice(
      relationship.evidenceStartOffset!,
      relationship.evidenceEndOffset!
    ),
    quote
  );
  await assert.rejects(
    () => deleteDocumentPreservingEvidence(db.prisma, document.id),
    /cannot be deleted/
  );
  await assert.rejects(
    () => db.prisma.document.delete({ where: { id: document.id } }),
    /foreign key/i
  );
  await deleteDocumentPreservingEvidence(db.prisma, bare.id);
  assert.equal(
    await db.prisma.document.count({ where: { id: bare.id } }),
    0
  );
});

test("seeded mini graph does not fabricate page provenance", async () => {
  const workspace = await freshWorkspace("Seed graph");
  const deal = await freshDeal(workspace.id);
  const tenantBody = `Best,\nSarah Chen\nSenior VP, Tenant Representation | JLL Boston`;
  const landlordBody = `Derek Hollis\nDirector of Leasing | Boston Properties`;
  const thread = await db.prisma.thread.create({
    data: {
      dealId: deal.id,
      subject: "200 Clarendon",
      participants: "[]",
    },
  });
  const tenantMessage = await db.prisma.message.create({
    data: {
      threadId: thread.id,
      sender: "Sarah Chen <s.chen@jllboston.com>",
      recipients: "[]",
      sentAt: new Date("2026-09-16T00:00:00Z"),
      body: tenantBody,
    },
  });
  const landlordMessage = await db.prisma.message.create({
    data: {
      threadId: thread.id,
      sender: "Derek Hollis <d.hollis@bostonproperties.com>",
      recipients: "[]",
      sentAt: new Date("2026-09-22T00:00:00Z"),
      body: landlordBody,
    },
  });
  await seedClarendonGraph(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    tenantMessage,
    landlordMessage,
  });
  const linked = await db.prisma.deal.findUniqueOrThrow({
    where: { id: deal.id },
    include: { canonicalProperty: true },
  });
  assert.equal(linked.property, "200 Clarendon Street, Boston MA");
  assert.equal(linked.company, "Acme Corp");
  assert.equal(linked.canonicalProperty?.canonicalName, "200 Clarendon");
  assert.equal(workspace.firmCompanyId, null);
  const observations = await db.prisma.entityObservation.findMany({
    where: { workspaceId: workspace.id },
  });
  const relationships = await db.prisma.relationshipObservation.findMany({
    where: { workspaceId: workspace.id },
    include: { message: true },
  });
  assert.ok(observations.length > 0);
  for (const observation of [...observations, ...relationships]) {
    assert.equal(observation.documentPageId, null);
    assert.equal(observation.documentId, null);
    assert.equal(observation.provenanceStatus, null);
    assert.ok(observation.messageId);
    const message = await db.prisma.message.findUniqueOrThrow({
      where: { id: observation.messageId! },
    });
    assert.equal(
      message.body.slice(
        observation.evidenceStartOffset!,
        observation.evidenceEndOffset!
      ),
      observation.evidenceQuote
    );
  }
  assert.equal(
    await db.prisma.propertyStake.count({
      where: { workspaceId: workspace.id, predicate: "OCCUPIES" },
    }),
    0
  );
  const unsupported = await db.prisma.dealParticipation.findMany({
    where: {
      workspaceId: workspace.id,
      role: { in: ["TENANT", "LANDLORD", "LANDLORD_BROKER", "LANDLORD_BROKERAGE"] },
    },
    include: { supports: true },
  });
  assert.ok(unsupported.length >= 4);
  for (const participation of unsupported) {
    assert.equal(participation.supports.length, 0);
    assert.equal(participation.assertionSource, "MANUAL");
  }
});

test("graph_edge projection stays inside the workspace", async () => {
  const workspace = await freshWorkspace("Projection");
  const other = await freshWorkspace("Projection other");
  const deal = await freshDeal(workspace.id);
  const acme = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Acme Corp",
  });
  const owner = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Boston Properties",
  });
  const jll = await createCompany(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "JLL Boston",
  });
  const sarah = await createPerson(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
  });
  const property = await createProperty(db.prisma, {
    workspaceId: workspace.id,
    canonicalName: "200 Clarendon",
  });
  await createEmployment(db.prisma, {
    workspaceId: workspace.id,
    personId: sarah.id,
    companyId: jll.id,
    affiliationKind: "BROKER",
    assertionSource: "MANUAL",
  });
  await createPropertyStake(db.prisma, {
    workspaceId: workspace.id,
    companyId: owner.id,
    propertyId: property.id,
    predicate: "OWNS",
    assertionSource: "MANUAL",
  });
  await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT",
    companyId: acme.id,
    assertionSource: "MANUAL",
  });
  await createDealParticipation(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT_BROKER",
    personId: sarah.id,
    representsCompanyId: acme.id,
    assertionSource: "MANUAL",
  });
  await linkDealProperty(db.prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    propertyId: property.id,
  });
  const outsider = await createPerson(db.prisma, {
    workspaceId: other.id,
    canonicalName: "Other Person",
  });
  const outsiderCompany = await createCompany(db.prisma, {
    workspaceId: other.id,
    canonicalName: "Other Co",
  });
  await createEmployment(db.prisma, {
    workspaceId: other.id,
    personId: outsider.id,
    companyId: outsiderCompany.id,
    assertionSource: "MANUAL",
  });

  const edges = await listGraphEdges(db.prisma, workspace.id);
  const predicates = edges.map((edge) => edge.predicate);
  assert.ok(predicates.includes("WORKS_AT"));
  assert.ok(predicates.includes("OWNS"));
  assert.ok(predicates.includes("TENANT"));
  assert.ok(predicates.includes("TENANT_BROKER"));
  assert.ok(predicates.includes("REPRESENTS_ON_DEAL"));
  assert.ok(predicates.includes("CONCERNS_PROPERTY"));
  assert.equal(
    edges.some((edge) => edge.fromId === outsider.id || edge.toId === outsider.id),
    false
  );
  const concerns = edges.find((edge) => edge.predicate === "CONCERNS_PROPERTY");
  assert.equal(concerns?.fromId, deal.id);
  assert.equal(concerns?.toId, property.id);
  const relationships = await getEntityRelationships(db.prisma, {
    workspaceId: workspace.id,
    entityType: "PERSON",
    entityId: sarah.id,
  });
  assert.equal(relationships.employments.length, 1);
  await assert.rejects(
    () =>
      getEntityRelationships(db.prisma, {
        workspaceId: other.id,
        entityType: "PERSON",
        entityId: sarah.id,
      }),
    GraphInvariantError
  );
  const otherEdges = await listGraphEdges(db.prisma, other.id);
  assert.equal(otherEdges.length, 1);
  assert.equal(otherEdges[0]?.predicate, "WORKS_AT");
});
