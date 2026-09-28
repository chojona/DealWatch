import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import { GraphInvariantError } from "@/lib/entities/errors";
import {
  addPersonIdentifier,
  createCompany,
  createEmployment,
  createPerson,
  createProperty,
  createWorkspace,
  recordEntityObservation,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import {
  acceptResolutionCandidate,
  listResolutionCandidates,
  rejectResolutionCandidate,
} from "./service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

const evidence = {
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
      company: "Acme",
      property: "Tower",
      stage: "LOI",
      status: "ACTIVE",
      workspaceId: workspace.id,
    },
  });
  return { workspace, deal };
}

async function counts(workspaceId: string) {
  const where = { workspaceId };
  return {
    people: await prisma.person.count({ where }),
    companies: await prisma.company.count({ where }),
    properties: await prisma.property.count({ where }),
    personAliases: await prisma.personAlias.count({ where }),
    companyAliases: await prisma.companyAlias.count({ where }),
    propertyAliases: await prisma.propertyAlias.count({ where }),
    links: await prisma.entityResolutionLink.count({ where }),
    employments: await prisma.employment.count({ where }),
    stakes: await prisma.propertyStake.count({ where }),
    participations: await prisma.dealParticipation.count({ where }),
  };
}

test("resolution stays inside the workspace and does not create canonical rows or links", async () => {
  const left = await workspaceDeal("Left");
  const right = await workspaceDeal("Right");
  await createPerson(prisma, {
    workspaceId: right.workspace.id,
    canonicalName: "Sarah Chen",
    identifiers: [{ kind: "EMAIL", value: "sarah.chen@jll.com" }],
  });
  const observation = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: left.workspace.id,
    dealId: left.deal.id,
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    email: "sarah.chen@jll.com",
  });
  const before = await counts(left.workspace.id);
  const review = await listResolutionCandidates(prisma, observation.id);
  assert.ok(review);
  assert.equal(review.workspaceId, left.workspace.id);
  assert.equal(review.candidates.length, 0);
  assert.equal(review.createNew.enabled, true);
  assert.deepEqual(await counts(left.workspace.id), before);
  assert.equal(await prisma.entityResolutionLink.count(), 0);
});

test("exact email, domain, and address propose the matching canonical entity", async () => {
  const { workspace, deal } = await workspaceDeal("Exact");
  const sarah = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
    identifiers: [{ kind: "EMAIL", value: "Sarah.Chen@jll.com" }],
  });
  const jll = await createCompany(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Jones Lang LaSalle",
    primaryDomain: "https://www.jll.com",
  });
  const tower = await createProperty(prisma, {
    workspaceId: workspace.id,
    canonicalName: "John Hancock Tower",
    addressLine1: "200 Clarendon Street",
    city: "Boston",
    region: "MA",
  });
  const personObservation = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PERSON",
    surfaceForm: "Sarah L. Chen",
    email: "sarah.chen@jll.com",
  });
  const companyObservation = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "JLL",
    domain: "JLL.com",
  });
  const propertyObservation = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PROPERTY",
    surfaceForm: "Hancock",
    addressLine1: "200 Clarendon Street",
    city: "Boston",
    region: "MA",
  });
  const before = await counts(workspace.id);
  const people = await listResolutionCandidates(prisma, personObservation.id);
  const companies = await listResolutionCandidates(prisma, companyObservation.id);
  const properties = await listResolutionCandidates(prisma, propertyObservation.id);
  assert.equal(people?.candidates[0]?.candidate.id, sarah.id);
  assert.ok(people?.candidates[0]?.positiveReasons.includes("Exact normalized email"));
  assert.equal(people?.candidates[0]?.decision, "PENDING");
  assert.equal(companies?.candidates[0]?.candidate.id, jll.id);
  assert.ok(companies?.candidates[0]?.positiveReasons.includes("Exact normalized domain"));
  assert.equal(properties?.candidates[0]?.candidate.id, tower.id);
  assert.ok(properties?.candidates[0]?.positiveReasons.includes("Exact normalized address"));
  assert.deepEqual(await counts(workspace.id), before);
});

test("same name alone stays pending and two John Smiths stay distinguishable", async () => {
  const { workspace, deal } = await workspaceDeal("Smiths");
  const cbre = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "CBRE" });
  const jll = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "JLL" });
  const smithCbre = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "John Smith",
    identifiers: [{ kind: "EMAIL", value: "john.smith@cbre.com" }],
  });
  const smithJll = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "John Smith",
    identifiers: [{ kind: "EMAIL", value: "john.smith@jll.com" }],
  });
  await createEmployment(prisma, {
    workspaceId: workspace.id,
    personId: smithCbre.id,
    companyId: cbre.id,
    assertionSource: "MANUAL",
  });
  await createEmployment(prisma, {
    workspaceId: workspace.id,
    personId: smithJll.id,
    companyId: jll.id,
    assertionSource: "MANUAL",
  });
  const nameOnly = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PERSON",
    surfaceForm: "John Smith",
  });
  const named = await listResolutionCandidates(prisma, nameOnly.id);
  assert.equal(named?.candidates.length, 2);
  assert.ok(named?.candidates.every((candidate) => candidate.decision === "PENDING"));
  assert.equal(await prisma.entityResolutionLink.count({ where: { entityObservationId: nameOnly.id } }), 0);

  const companyMention = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "COMPANY",
    surfaceForm: "CBRE",
  });
  const specific = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PERSON",
    surfaceForm: "John Smith",
    email: "john.smith@cbre.com",
  });
  await recordRelationshipObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    predicate: "WORKS_AT",
    subjectObservationId: specific.id,
    objectObservationId: companyMention.id,
  });
  const review = await listResolutionCandidates(prisma, specific.id);
  assert.equal(review?.candidates[0]?.candidate.id, smithCbre.id);
  const other = review?.candidates.find((candidate) => candidate.candidate.id === smithJll.id);
  assert.ok(other);
  assert.ok(other.negativeReasons.includes("Different known email"));
  assert.ok(other.score < (review?.candidates[0]?.score ?? 0));
  assert.equal(await prisma.entityResolutionLink.count({ where: { workspaceId: workspace.id } }), 0);
});

test("a shared inbox is not a strong person identifier", async () => {
  const { workspace, deal } = await workspaceDeal("Inbox");
  const alex = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Alex Kim",
  });
  await addPersonIdentifier(prisma, {
    workspaceId: workspace.id,
    personId: alex.id,
    kind: "EMAIL",
    value: "leasing@cbre.com",
  });
  const observation = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PERSON",
    surfaceForm: "Leasing Desk",
    email: "leasing@cbre.com",
  });
  const review = await listResolutionCandidates(prisma, observation.id);
  assert.equal(review?.candidates.length, 0);
});

test("accept is idempotent, reject keeps history, and canonical graph rows stay unchanged", async () => {
  const { workspace, deal } = await workspaceDeal("Decide");
  const sarah = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
    identifiers: [{ kind: "EMAIL", value: "sarah.chen@jll.com" }],
  });
  const other = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
    identifiers: [{ kind: "EMAIL", value: "sarah.chen@cbre.com" }],
  });
  const quote = "Sarah Chen signed the letter.";
  const document = await prisma.document.create({
    data: {
      dealId: deal.id,
      filename: "letter.pdf",
      originalFilename: "letter.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      sha256: `letter-${deal.id}`,
      documentType: "OTHER",
      storageKey: "letter.pdf",
      ingestionStatus: "READY",
      pages: { create: [{ pageNumber: 1, text: quote }] },
    },
  });
  const observation = await recordEntityObservation(prisma, {
    workspaceId: workspace.id,
    dealId: deal.id,
    documentId: document.id,
    sourceKind: "DOCUMENT_PAGE",
    observedType: "PERSON",
    surfaceForm: "Sarah Chen",
    email: "sarah.chen@jll.com",
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  const beforeObservation = await prisma.entityObservation.findUniqueOrThrow({
    where: { id: observation.id },
  });
  const before = await counts(workspace.id);
  const review = await listResolutionCandidates(prisma, observation.id);
  const match = review?.candidates.find((candidate) => candidate.candidate.id === sarah.id);
  const decoy = review?.candidates.find((candidate) => candidate.candidate.id === other.id);
  assert.ok(match && decoy);
  const accepted = await acceptResolutionCandidate(prisma, match.id);
  const again = await acceptResolutionCandidate(prisma, match.id);
  assert.equal(accepted?.decision, "ACCEPTED");
  assert.equal(again?.idempotent, true);
  assert.equal(again?.resolutionLinkId, accepted?.resolutionLinkId);
  assert.equal(await prisma.entityResolutionLink.count({ where: { entityObservationId: observation.id, status: "ACCEPTED" } }), 1);
  const closed = await prisma.entityResolutionCandidate.findUniqueOrThrow({ where: { id: decoy.id } });
  assert.equal(closed.decision, "REJECTED");
  const after = await counts(workspace.id);
  assert.equal(after.people, before.people);
  assert.equal(after.personAliases, before.personAliases);
  assert.equal(after.companyAliases, before.companyAliases);
  assert.equal(after.propertyAliases, before.propertyAliases);
  assert.equal(after.employments, before.employments);
  assert.equal(after.stakes, before.stakes);
  assert.equal(after.participations, before.participations);
  assert.equal(after.links, before.links + 1);
  const afterObservation = await prisma.entityObservation.findUniqueOrThrow({
    where: { id: observation.id },
  });
  assert.equal(afterObservation.surfaceForm, beforeObservation.surfaceForm);
  assert.equal(afterObservation.email, beforeObservation.email);
  assert.equal(afterObservation.evidenceQuote, beforeObservation.evidenceQuote);
  assert.equal(afterObservation.documentPageId, beforeObservation.documentPageId);
  assert.equal(afterObservation.provenanceStatus, "EXACT");
  assert.equal(afterObservation.evidenceStartOffset, beforeObservation.evidenceStartOffset);
  const link = await prisma.entityResolutionLink.findUniqueOrThrow({
    where: { id: accepted!.resolutionLinkId! },
  });
  assert.equal(link.personId, sarah.id);
  assert.equal(link.companyId, null);
  assert.equal(link.method, "DETERMINISTIC");

  const property = await createProperty(prisma, {
    workspaceId: workspace.id,
    canonicalName: "200 Clarendon",
    aliases: ["Hancock"],
  });
  const aliasCount = await prisma.propertyAlias.count({ where: { workspaceId: workspace.id } });
  const propertyObservation = await recordEntityObservation(prisma, {
    ...evidence,
    workspaceId: workspace.id,
    dealId: deal.id,
    observedType: "PROPERTY",
    surfaceForm: "Hancock",
  });
  const propertyReview = await listResolutionCandidates(prisma, propertyObservation.id);
  const propertyCandidate = propertyReview?.candidates.find((candidate) => candidate.candidate.id === property.id);
  assert.ok(propertyCandidate);
  assert.ok(propertyCandidate.positiveReasons.includes("Exact normalized alias"));
  const rejected = await rejectResolutionCandidate(prisma, propertyCandidate.id, "Different building");
  const rejectedAgain = await rejectResolutionCandidate(prisma, propertyCandidate.id);
  assert.equal(rejected?.decision, "REJECTED");
  assert.equal(rejectedAgain?.idempotent, true);
  const stored = await prisma.entityResolutionCandidate.findUniqueOrThrow({ where: { id: propertyCandidate.id } });
  assert.equal(stored.decision, "REJECTED");
  assert.equal(stored.decisionReason, "Different building");
  assert.equal(await prisma.propertyAlias.count({ where: { workspaceId: workspace.id } }), aliasCount);
  assert.equal(await prisma.entityResolutionLink.count({ where: { entityObservationId: propertyObservation.id } }), 0);
  await assert.rejects(() => acceptResolutionCandidate(prisma, propertyCandidate.id), GraphInvariantError);
});
