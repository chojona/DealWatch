import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import {
  createPerson,
  createWorkspace,
  recordEntityObservation,
  recordObservationDisposition,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import { graphReviewHref } from "@/lib/graph/provenance";
import { getCompanyIntelligence, getPersonIntelligence } from "@/lib/intelligence/service";
import { getDocumentReview } from "@/lib/inbox/service";
import { acceptResolutionCandidate, listResolutionCandidates } from "@/lib/resolution/service";
import {
  approveRelationshipObservation,
  createCanonicalEntityFromObservation,
  getDealKnowledge,
  rejectRelationshipObservation,
} from "./service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

const extractor = {
  extractor: "manual",
  extractorVersion: "knowledge-review",
};

test.before(async () => {
  const db = await createTestDatabase();
  prisma = db.prisma;
  cleanup = db.cleanup;
});

test.after(async () => {
  await cleanup();
});

test("review href points at the document section and observation", () => {
  const href = graphReviewHref({ documentId: "doc-1", observationId: "obs-1", kind: "relationship" });
  assert.equal(href, "/documents/doc-1/review?section=relationships&focus=obs-1");
  assert.equal(graphReviewHref({ documentId: null, observationId: "obs-1", kind: "entity" }), null);
});

test("knowledge review, provenance, and workspace isolation", async () => {
  const left = await workspaceDeal("Workspace A");
  const right = await workspaceDeal("Workspace B");
  const leftDocument = await sourceDocument(left.deal.id, "acme-letter.pdf", "Jane Broker works for Acme Corp.");
  const rightDocument = await sourceDocument(right.deal.id, "other-acme.pdf", "Other Acme Corp appears here.");

  const pendingCompany = await observe(left, "COMPANY", "Acme Corp", leftDocument.id, "Acme Corp");
  const pendingPerson = await observe(left, "PERSON", "Jane Broker", leftDocument.id, "Jane Broker");
  const pendingRelationship = await recordRelationshipObservation(prisma, {
    ...extractor,
    workspaceId: left.workspace.id,
    dealId: left.deal.id,
    documentId: leftDocument.id,
    sourceKind: "DOCUMENT_PAGE",
    predicate: "WORKS_AT",
    subjectObservationId: pendingPerson.id,
    objectObservationId: pendingCompany.id,
    affiliationKind: "BROKER",
    evidenceQuote: "Jane Broker works for Acme Corp.",
  });

  const before = await getDealKnowledge(prisma, left.deal.id);
  assert.ok(before);
  assert.equal(before.canonical.people.length, 0);
  assert.equal(before.canonical.employments.length, 0);
  const pendingEntity = before.pending.entities.find((entity) => entity.id === pendingCompany.id);
  const pendingEdge = before.pending.relationships.find((row) => row.id === pendingRelationship.id);
  assert.ok(pendingEntity);
  assert.equal(pendingEntity.reviewHref, graphReviewHref({
    documentId: leftDocument.id,
    observationId: pendingCompany.id,
    kind: "entity",
  }));
  assert.equal(pendingEntity.sourceLabel, "acme-letter.pdf");
  assert.equal(pendingEntity.provenanceStatus, "EXACT");
  assert.equal(pendingEntity.pageNumber, 1);
  assert.ok(pendingEntity.evidenceStartOffset != null);
  assert.ok(pendingEntity.evidenceEndOffset != null);
  assert.ok(pendingEdge);
  assert.equal(pendingEdge.reviewHref, graphReviewHref({
    documentId: leftDocument.id,
    observationId: pendingRelationship.id,
    kind: "relationship",
  }));
  assert.match(pendingEdge.evidenceQuote, /Jane Broker works for Acme Corp/);
  assert.equal(pendingEdge.pageNumber, 1);

  const rejectedPerson = await observe(left, "PERSON", "Rejected Ghost", leftDocument.id, "Jane Broker");
  await recordObservationDisposition(prisma, {
    entityObservationId: rejectedPerson.id,
    disposition: "REJECTED",
    actor: "USER",
  });
  const rejectedRelationship = await recordRelationshipObservation(prisma, {
    ...extractor,
    workspaceId: left.workspace.id,
    dealId: left.deal.id,
    documentId: leftDocument.id,
    sourceKind: "DOCUMENT_PAGE",
    predicate: "WORKS_AT",
    subjectObservationId: rejectedPerson.id,
    objectObservationId: pendingCompany.id,
    evidenceQuote: "Jane Broker works for Acme Corp.",
  });
  await rejectRelationshipObservation(prisma, rejectedRelationship.id, "Not this relationship");

  const createdCompany = await createCanonicalEntityFromObservation(prisma, pendingCompany.id);
  assert.ok(createdCompany);
  const existingPerson = await createPerson(prisma, {
    workspaceId: left.workspace.id,
    canonicalName: "Jane Broker",
  });
  const candidates = await listResolutionCandidates(prisma, pendingPerson.id);
  const match = candidates?.candidates.find((candidate) => candidate.candidate.id === existingPerson.id);
  assert.ok(match);
  await acceptResolutionCandidate(prisma, match.id);
  await approveRelationshipObservation(prisma, pendingRelationship.id, "Confirmed employment");

  const after = await getDealKnowledge(prisma, left.deal.id);
  assert.ok(after);
  assert.equal(after.pending.entities.some((entity) => entity.id === pendingCompany.id), false);
  assert.equal(after.pending.entities.some((entity) => entity.id === rejectedPerson.id), false);
  assert.equal(after.pending.relationships.some((row) => row.id === pendingRelationship.id), false);
  assert.equal(after.pending.relationships.some((row) => row.id === rejectedRelationship.id), false);
  assert.equal(after.canonical.people.some((person) => person.name === "Rejected Ghost"), false);
  const jane = after.canonical.people.find((person) => person.name === "Jane Broker");
  assert.ok(jane);
  assert.equal(jane.personId, existingPerson.id);
  assert.equal(jane.origin.supportCount, 1);
  assert.equal(jane.origin.supports[0]?.documentName, "acme-letter.pdf");
  assert.equal(jane.origin.supports[0]?.reviewState, "ACCEPTED");
  assert.equal(jane.origin.supports[0]?.reviewHref, graphReviewHref({
    documentId: leftDocument.id,
    observationId: pendingPerson.id,
    kind: "entity",
  }));
  assert.ok(jane.origin.supports[0]?.evidenceStartOffset != null);
  const employment = after.canonical.employments.find((row) => row.personName === "Jane Broker");
  assert.ok(employment);
  assert.equal(employment.companyName, "Acme Corp");
  assert.equal(employment.evidence.supportCount, 1);
  assert.equal(employment.evidence.supports[0]?.quote, "Jane Broker works for Acme Corp.");
  assert.equal(employment.evidence.supports[0]?.reviewState, "APPROVED");
  assert.equal(employment.evidence.supports[0]?.documentId, leftDocument.id);
  assert.equal(employment.evidence.supports[0]?.pageNumber, 1);
  assert.ok(employment.evidence.supports[0]?.evidenceStartOffset != null);
  assert.equal(employment.evidence.supports[0]?.reviewHref, pendingEdge.reviewHref);
  assert.equal(await prisma.person.count({ where: { workspaceId: left.workspace.id, canonicalName: "Jane Broker" } }), 1);
  assert.equal(await prisma.employment.count({ where: { workspaceId: left.workspace.id, status: "ASSERTED" } }), 1);

  const company = await getCompanyIntelligence(prisma, createdCompany.entityId);
  assert.ok(company);
  assert.equal(company.origin.supportCount, 1);
  assert.equal(company.origin.supports[0]?.documentId, leftDocument.id);
  assert.equal(company.origin.supports[0]?.quote.includes("Acme Corp"), true);
  const person = await getPersonIntelligence(prisma, existingPerson.id);
  assert.equal(person?.origin.supports[0]?.sourceKind, "DOCUMENT_PAGE");
  assert.match(person?.origin.supports[0]?.reviewHref ?? "", new RegExp(`/documents/${leftDocument.id}/review`));

  const thread = await prisma.thread.create({
    data: { dealId: left.deal.id, subject: "Acme introduction", participants: "[]" },
  });
  const message = await prisma.message.create({
    data: {
      threadId: thread.id,
      sender: "jane@broker.example",
      recipients: "[]",
      sentAt: new Date("2026-09-01T00:00:00Z"),
      body: "Please meet Jane Broker from the brokerage.",
    },
  });
  const messageObservation = await recordEntityObservation(prisma, {
    ...extractor,
    workspaceId: left.workspace.id,
    dealId: left.deal.id,
    messageId: message.id,
    sourceKind: "MESSAGE",
    observedType: "PERSON",
    surfaceForm: "Jane Broker",
    evidenceQuote: "Jane Broker",
  });
  const messageCandidates = await listResolutionCandidates(prisma, messageObservation.id);
  const messageMatch = messageCandidates?.candidates.find((candidate) => candidate.candidate.id === existingPerson.id);
  assert.ok(messageMatch);
  await acceptResolutionCandidate(prisma, messageMatch.id);
  const messageKnowledge = await getDealKnowledge(prisma, left.deal.id);
  const messageJane = messageKnowledge?.canonical.people.find((row) => row.personId === existingPerson.id);
  const messageSupport = messageJane?.origin.supports.find((support) => support.observationId === messageObservation.id);
  assert.ok(messageSupport);
  assert.equal(messageSupport.sourceKind, "MESSAGE");
  assert.equal(messageSupport.messageSubject, "Acme introduction");
  assert.equal(messageSupport.messageSender, "jane@broker.example");
  assert.equal(messageSupport.reviewHref, null);
  assert.equal(messageSupport.evidenceStartOffset, message.body.indexOf("Jane Broker"));
  assert.equal(
    await prisma.person.count({ where: { workspaceId: left.workspace.id, canonicalName: "Jane Broker" } }),
    1
  );

  const rightCompany = await observe(right, "COMPANY", "Acme Corp", rightDocument.id, "Other Acme Corp");
  const rightCreated = await createCanonicalEntityFromObservation(prisma, rightCompany.id);
  assert.ok(rightCreated);
  assert.notEqual(rightCreated.entityId, createdCompany.entityId);
  const rightKnowledge = await getDealKnowledge(prisma, right.deal.id);
  assert.ok(rightKnowledge);
  const rightHrefs = [
    ...rightKnowledge.pending.entities.map((entity) => entity.reviewHref),
    ...rightKnowledge.pending.relationships.map((row) => row.reviewHref),
    ...rightKnowledge.canonical.people.flatMap((person) => person.origin.supports.map((support) => support.reviewHref)),
    ...(rightKnowledge.canonical.property?.origin.supports.map((support) => support.reviewHref) ?? []),
  ].filter((href): href is string => Boolean(href));
  assert.equal(rightHrefs.some((href) => href.includes(leftDocument.id)), false);
  const leftKnowledge = await getDealKnowledge(prisma, left.deal.id);
  const leftHrefs = JSON.stringify(leftKnowledge);
  assert.equal(leftHrefs.includes(rightDocument.id), false);
  assert.equal(await getDocumentReview(prisma, left.workspace.id, rightDocument.id), null);
  assert.equal(await getDocumentReview(prisma, right.workspace.id, leftDocument.id), null);
  const rightCompanyView = await getCompanyIntelligence(prisma, rightCreated.entityId);
  assert.equal(rightCompanyView?.origin.supports.some((support) => support.documentId === leftDocument.id), false);
  assert.equal(await prisma.company.count({ where: { workspaceId: right.workspace.id, canonicalName: "Acme Corp" } }), 1);
  assert.equal(await prisma.employment.count({ where: { workspaceId: right.workspace.id } }), 0);

  const empty = await workspaceDeal("Empty graph");
  const emptyKnowledge = await getDealKnowledge(prisma, empty.deal.id);
  assert.deepEqual(emptyKnowledge?.pending.entities, []);
  assert.deepEqual(emptyKnowledge?.pending.relationships, []);
  assert.deepEqual(emptyKnowledge?.canonical.people, []);
  assert.deepEqual(emptyKnowledge?.canonical.employments, []);
});

async function workspaceDeal(name: string) {
  const workspace = await createWorkspace(prisma, { name });
  const deal = await prisma.deal.create({
    data: {
      name,
      company: "Acme Corp",
      property: "Harbor Tower",
      stage: "LOI",
      status: "ACTIVE",
      workspaceId: workspace.id,
    },
  });
  return { workspace, deal };
}

async function sourceDocument(dealId: string, filename: string, text: string) {
  return prisma.document.create({
    data: {
      dealId,
      filename,
      originalFilename: filename,
      mimeType: "application/pdf",
      sizeBytes: text.length,
      sha256: `${filename}-${dealId}`,
      documentType: "OTHER",
      storageKey: `${filename}-${dealId}`,
      pages: { create: [{ pageNumber: 1, text }] },
    },
  });
}

async function observe(
  scope: { workspace: { id: string }; deal: { id: string } },
  observedType: "PERSON" | "COMPANY" | "PROPERTY",
  surfaceForm: string,
  documentId: string,
  evidenceQuote: string
) {
  return recordEntityObservation(prisma, {
    ...extractor,
    workspaceId: scope.workspace.id,
    dealId: scope.deal.id,
    documentId,
    sourceKind: "DOCUMENT_PAGE",
    observedType,
    surfaceForm,
    evidenceQuote,
  });
}
