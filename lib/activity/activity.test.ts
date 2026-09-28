import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import {
  attachObservationSupport,
  createCompany,
  createDealParticipation,
  createEmployment,
  createPerson,
  createProperty,
  createPropertyStake,
  createWorkspace,
  linkDealProperty,
  recordEntityObservation,
  recordObservationDisposition,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import { getConnectionGraph } from "@/lib/graph/service";
import { getPersonIntelligence } from "@/lib/intelligence/service";
import { parseActivityQuery, ActivityQueryError } from "./query";
import { getActivityPage } from "./service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let sequence = 0;

const manualAssertion = { assertionSource: "MANUAL" as const };
const extractor = { extractor: "deterministic-test", extractorVersion: "phase8b-test" };

describe("Phase 8B evidence-backed activity", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test.after(async () => cleanup());

  test("A/B/C/D deal, person, company, and property timelines share stored chronology without personal attribution", async () => {
    const fixture = await scaffold("root timelines");
    const [deal, person, company, property] = await Promise.all([
      getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, limit: 50 }),
      getActivityPage(prisma, { rootType: "PERSON", rootId: fixture.sarah.id, limit: 50 }),
      getActivityPage(prisma, { rootType: "COMPANY", rootId: fixture.jll.id, limit: 50 }),
      getActivityPage(prisma, { rootType: "PROPERTY", rootId: fixture.property.id, limit: 50 }),
    ]);
    assert.ok(deal && person && company && property);
    assert.ok(deal.events.some((event) => event.eventType === "NEGOTIATION_COUNTER"));
    assert.ok(person.events.some((event) => event.eventType.startsWith("NEGOTIATION_")));
    assert.ok(company.events.some((event) => event.eventType === "EMPLOYMENT_EVIDENCE"));
    assert.ok(property.events.some((event) => event.eventType === "PROPERTY_RELATIONSHIP_EVIDENCE"));
    const personNegotiation = person.events.find((event) => event.eventType === "NEGOTIATION_COUNTER");
    assert.ok(personNegotiation);
    assert.equal(personNegotiation.title.includes("Sarah"), false, "deal activity must not be attributed to a participant");
  });

  test("E/F/G/H/I ordering and temporal semantics keep unknown, record, document, and valid-from dates separate", async () => {
    const fixture = await scaffold("temporal");
    const page = await getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, limit: 50 });
    assert.ok(page);
    const known = page.events.find((event) => event.id === `document:${fixture.document.id}`);
    const unknown = page.events.find((event) => event.id === `document:${fixture.unknownDocument.id}`);
    const employment = page.events.find((event) => event.sourceId === fixture.employment.id);
    assert.equal(known?.occurredAt, fixture.document.documentDate?.toISOString());
    assert.equal(unknown?.occurredAt, null);
    assert.equal(unknown?.recordedAt, fixture.unknownDocument.createdAt.toISOString());
    assert.notEqual(unknown?.occurredAt, unknown?.recordedAt, "createdAt must not masquerade as occurredAt");
    assert.equal(employment?.occurredAt, fixture.employment.validFrom?.toISOString(), "validFrom takes precedence over evidence source time");
    const knownDates = page.events.filter((event) => event.occurredAt).map((event) => event.occurredAt!);
    assert.deepEqual(knownDates, [...knownDates].sort((a, b) => b.localeCompare(a)));
    assert.ok(page.events.findIndex((event) => event.occurredAt === null) > page.events.findLastIndex((event) => event.occurredAt !== null));
  });

  test("J/K/L negotiation rounds aggregate terms and preserve stepped rent plus irregular free rent", async () => {
    const fixture = await scaffold("structured negotiation");
    const page = await getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, filter: "NEGOTIATION", limit: 50 });
    assert.ok(page);
    assert.equal(page.events.length, 2, "one event is emitted per round, not per term");
    const counter = page.events.find((event) => event.sourceId === fixture.counterRoundId);
    assert.ok(counter);
    assert.ok(counter.details?.some((detail) => detail.previousValue === "$61/RSF/year" && detail.value === "Stepped rent schedule"));
    const rent = counter.details?.find((detail) => detail.canonicalType === "BASE_RENT");
    assert.equal(rent?.structured?.kind, "RENT_SCHEDULE");
    assert.deepEqual(rent?.structured?.rows.map((row) => row.label), ["Months 1–12", "Months 13–24"]);
    const freeRent = counter.details?.find((detail) => detail.canonicalType === "FREE_RENT");
    assert.equal(freeRent?.structured?.kind, "FREE_RENT_SCHEDULE");
    assert.deepEqual(freeRent?.structured?.rows.map((row) => row.label), ["Months 1–3", "Months 7–9"]);
  });

  test("M/N/O/R evidence-backed relationships group support, exclude zero-support fake history, and allow dated participation", async () => {
    const fixture = await scaffold("relationship rules");
    const page = await getActivityPage(prisma, { rootType: "PERSON", rootId: fixture.sarah.id, filter: "RELATIONSHIPS", limit: 50 });
    assert.ok(page);
    const employmentEvents = page.events.filter((event) => event.eventType === "EMPLOYMENT_EVIDENCE");
    assert.equal(employmentEvents.length, 1);
    assert.equal(employmentEvents[0]?.evidence?.supportCount, 2, "duplicate support is grouped beneath one assertion event");
    assert.equal(page.events.some((event) => event.sourceId === fixture.unsupportedEmployment.id), false);
    assert.ok(page.events.some((event) => event.eventType === "DEAL_PARTICIPATION" && event.sourceId === fixture.personParticipation.id));
  });

  test("P/Q unresolved observations are labeled pending while rejected observations are excluded", async () => {
    const fixture = await scaffold("observation disposition");
    const page = await getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, filter: "RELATIONSHIPS", limit: 50 });
    assert.ok(page);
    const pending = page.events.filter((event) => event.resolutionState === "PENDING");
    assert.ok(pending.some((event) => event.sourceId === fixture.pendingEntity.id));
    assert.ok(pending.some((event) => event.sourceId === fixture.pendingRelationship.id));
    assert.ok(pending.every((event) => /pending|unresolved/i.test(`${event.title} ${event.description}`)));
    const serialized = JSON.stringify(page);
    assert.equal(serialized.includes("Rejected Phantom"), false);
    assert.equal(serialized.includes("rejected secret relationship"), false);
  });

  test("S/T/U exact, ambiguous, and unlocated provenance retain quotes without inventing pages", async () => {
    const fixture = await scaffold("provenance");
    const page = await getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, filter: "NEGOTIATION", limit: 50 });
    assert.ok(page);
    const counter = page.events.find((event) => event.sourceId === fixture.counterRoundId);
    assert.ok(counter?.evidence);
    const exact = counter.evidence.supports.find((support) => support.provenanceStatus === "EXACT");
    const ambiguous = counter.evidence.supports.find((support) => support.provenanceStatus === "AMBIGUOUS");
    const unlocated = counter.evidence.supports.find((support) => support.provenanceStatus === "UNLOCATED");
    assert.equal(exact?.pageNumber, 1);
    assert.match(exact?.href ?? "", /#page=1$/);
    assert.equal(ambiguous?.pageNumber, null);
    assert.equal(ambiguous?.href?.includes("#page="), false);
    assert.equal(unlocated?.pageNumber, null);
    assert.match(unlocated?.quote ?? "", /Unlocated term evidence/);
  });

  test("V/W/X/Y workspace isolation holds for every root", async () => {
    const left = await scaffold("isolation left");
    const right = await scaffold("isolation right Secret Workspace");
    for (const [rootType, rootId] of [
      ["PERSON", left.sarah.id],
      ["COMPANY", left.jll.id],
      ["PROPERTY", left.property.id],
      ["DEAL", left.deal.id],
    ] as const) {
      const page = await getActivityPage(prisma, { rootType, rootId, limit: 50 });
      assert.ok(page);
      const serialized = JSON.stringify(page);
      assert.equal(serialized.includes(right.deal.id), false);
      assert.equal(serialized.includes("Secret Workspace"), false);
    }
  });

  test("Z cursor pagination is stable, bounded, and rejects client workspace authority", async () => {
    const fixture = await scaffold("pagination");
    const first = await getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, limit: 2 });
    assert.ok(first?.nextCursor);
    assert.equal(first.events.length, 2);
    await prisma.dealEvent.create({ data: { dealId: fixture.deal.id, type: "NEWER_EVENT", description: "Inserted after page one", occurredAt: new Date("2026-10-20T00:00:00Z"), confidence: 1, evidenceQuote: "Inserted after page one" } });
    const second = await getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, limit: 2, cursor: first.nextCursor });
    assert.ok(second);
    assert.equal(second.events.some((event) => first.events.some((prior) => prior.id === event.id)), false);
    assert.equal(second.events.some((event) => event.title === "Newer event"), false, "newer inserts stay before the cursor");
    assert.throws(() => parseActivityQuery(new URLSearchParams(`rootType=DEAL&rootId=${fixture.deal.id}&workspaceId=attacker`)), ActivityQueryError);
    assert.throws(() => parseActivityQuery(new URLSearchParams(`rootType=DEAL&rootId=${fixture.deal.id}&limit=51`)), ActivityQueryError);
    assert.throws(() => parseActivityQuery(new URLSearchParams(`rootType=DEAL&rootId=${fixture.deal.id}&cursor=broken`)), ActivityQueryError);
  });

  test("read model performs no canonical writes, extraction/model calls, or Phase 8A/connection mutations", async () => {
    const fixture = await scaffold("read only regression");
    const intelligenceBefore = await getPersonIntelligence(prisma, fixture.sarah.id);
    const graphBefore = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: fixture.sarah.id, depth: 2 });
    const before = await snapshot(fixture.workspace.id);
    await Promise.all([
      getActivityPage(prisma, { rootType: "PERSON", rootId: fixture.sarah.id, limit: 25 }),
      getActivityPage(prisma, { rootType: "COMPANY", rootId: fixture.jll.id, limit: 25 }),
      getActivityPage(prisma, { rootType: "PROPERTY", rootId: fixture.property.id, limit: 25 }),
      getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, limit: 25 }),
    ]);
    assert.deepEqual(await snapshot(fixture.workspace.id), before);
    assert.deepEqual(await getPersonIntelligence(prisma, fixture.sarah.id), intelligenceBefore);
    assert.deepEqual(await getConnectionGraph(prisma, { rootType: "PERSON", rootId: fixture.sarah.id, depth: 2 }), graphBefore);
  });
});

async function scaffold(label: string) {
  const workspace = await createWorkspace(prisma, { name: `${label} ${++sequence}` });
  const deal = await prisma.deal.create({ data: { workspaceId: workspace.id, name: `${label} — 200 Clarendon`, company: "Acme Corp", property: "200 Clarendon", stage: "Negotiation", status: "ACTIVE", createdAt: new Date("2026-07-01T00:00:00Z") } });
  const property = await createProperty(prisma, { workspaceId: workspace.id, canonicalName: `${label} 200 Clarendon`, addressLine1: "200 Clarendon Street", city: "Boston", region: "MA", assetType: "OFFICE" });
  await linkDealProperty(prisma, { workspaceId: workspace.id, dealId: deal.id, propertyId: property.id });
  const sarah = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: `${label} Sarah Chen`, primaryTitle: "Senior VP" });
  const jll = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: `${label} JLL Boston` });
  const owner = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: `${label} Boston Properties` });
  const acme = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: `${label} Acme Corp` });

  const thread = await prisma.thread.create({ data: { dealId: deal.id, subject: "Relationship evidence", participants: "[]" } });
  const message = await prisma.message.create({ data: { threadId: thread.id, sender: "source@example.com", recipients: "[]", sentAt: new Date("2026-09-22T12:00:00Z"), body: `${sarah.canonicalName} works at ${jll.canonicalName}. Participant evidence.` } });
  const document = await prisma.document.create({ data: {
    dealId: deal.id, filename: "evidence.pdf", originalFilename: `${label} Counterproposal.pdf`, mimeType: "application/pdf", sizeBytes: 100, sha256: `known-${sequence}`, documentType: "COUNTERPROPOSAL", documentDate: new Date("2026-09-26T00:00:00Z"), negotiationSide: "LANDLORD", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED", storageKey: `test/${sequence}/known.pdf`, pageCount: 2, createdAt: new Date("2026-10-01T00:00:00Z"),
  } });
  const page1 = await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 1, text: `Exact rent evidence. Duplicate term evidence. ${owner.canonicalName} owns ${property.canonicalName}. Pending Company manages ${property.canonicalName}. Rejected Phantom. rejected secret relationship.` } });
  await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 2, text: "Duplicate term evidence." } });
  const unknownDocument = await prisma.document.create({ data: {
    dealId: deal.id, filename: "unknown.pdf", originalFilename: `${label} Undated Upload.pdf`, mimeType: "application/pdf", sizeBytes: 20, sha256: `unknown-${sequence}`, documentType: "OTHER", documentDate: null, negotiationSide: null, ingestionStatus: "READY", storageKey: `test/${sequence}/unknown.pdf`, createdAt: new Date("2026-10-02T00:00:00Z"),
  } });

  const personDocumentObservation = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, observedType: "PERSON", surfaceForm: sarah.canonicalName, evidenceQuote: "Exact rent evidence" });
  const companyDocumentObservation = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, observedType: "COMPANY", surfaceForm: jll.canonicalName, evidenceQuote: "Exact rent evidence" });
  await prisma.entityResolutionLink.create({ data: { workspaceId: workspace.id, entityObservationId: personDocumentObservation.id, personId: sarah.id, method: "MANUAL", status: "ACCEPTED", resolutionConfidence: 1 } });
  await prisma.entityResolutionLink.create({ data: { workspaceId: workspace.id, entityObservationId: companyDocumentObservation.id, companyId: jll.id, method: "MANUAL", status: "ACCEPTED", resolutionConfidence: 1 } });

  const personMessageObservation = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "MESSAGE", dealId: deal.id, messageId: message.id, observedType: "PERSON", surfaceForm: sarah.canonicalName, evidenceQuote: sarah.canonicalName });
  const companyMessageObservation = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "MESSAGE", dealId: deal.id, messageId: message.id, observedType: "COMPANY", surfaceForm: jll.canonicalName, evidenceQuote: jll.canonicalName });
  await prisma.entityResolutionLink.create({ data: { workspaceId: workspace.id, entityObservationId: personMessageObservation.id, personId: sarah.id, method: "MANUAL", status: "ACCEPTED", resolutionConfidence: 1 } });
  await prisma.entityResolutionLink.create({ data: { workspaceId: workspace.id, entityObservationId: companyMessageObservation.id, companyId: jll.id, method: "MANUAL", status: "ACCEPTED", resolutionConfidence: 1 } });

  const employment = await createEmployment(prisma, { ...manualAssertion, workspaceId: workspace.id, personId: sarah.id, companyId: jll.id, affiliationKind: "BROKER", titleAtTime: "Senior VP", validFrom: new Date("2026-08-01T00:00:00Z"), validFromPrecision: "DAY" });
  const workDocument = await recordRelationshipObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, predicate: "WORKS_AT", subjectObservationId: personDocumentObservation.id, objectObservationId: companyDocumentObservation.id, evidenceQuote: "Exact rent evidence", statedTitle: "Senior VP" });
  const workMessage = await recordRelationshipObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "MESSAGE", dealId: deal.id, messageId: message.id, predicate: "WORKS_AT", subjectObservationId: personMessageObservation.id, objectObservationId: companyMessageObservation.id, evidenceQuote: `${sarah.canonicalName} works at ${jll.canonicalName}` });
  await attachObservationSupport(prisma, { workspaceId: workspace.id, employmentId: employment.id, relationshipObservationId: workDocument.id });
  await attachObservationSupport(prisma, { workspaceId: workspace.id, employmentId: employment.id, relationshipObservationId: workMessage.id });
  const unsupportedEmployment = await createEmployment(prisma, { ...manualAssertion, workspaceId: workspace.id, personId: sarah.id, companyId: jll.id, affiliationKind: "STAFF" });

  const personParticipation = await createDealParticipation(prisma, { ...manualAssertion, workspaceId: workspace.id, dealId: deal.id, personId: sarah.id, representsCompanyId: acme.id, role: "TENANT_BROKER", validFrom: new Date("2026-09-01T00:00:00Z"), validFromPrecision: "DAY" });
  await createDealParticipation(prisma, { ...manualAssertion, workspaceId: workspace.id, dealId: deal.id, companyId: jll.id, representsCompanyId: acme.id, role: "TENANT_BROKERAGE", validFrom: new Date("2026-09-01T00:00:00Z"), validFromPrecision: "DAY" });
  await createDealParticipation(prisma, { ...manualAssertion, workspaceId: workspace.id, dealId: deal.id, companyId: owner.id, role: "LANDLORD", validFrom: new Date("2026-09-01T00:00:00Z"), validFromPrecision: "DAY" });

  const ownerObservation = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, observedType: "COMPANY", surfaceForm: owner.canonicalName, evidenceQuote: owner.canonicalName });
  const propertyObservation = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, observedType: "PROPERTY", surfaceForm: property.canonicalName, evidenceQuote: property.canonicalName });
  await prisma.entityResolutionLink.create({ data: { workspaceId: workspace.id, entityObservationId: ownerObservation.id, companyId: owner.id, method: "MANUAL", status: "ACCEPTED" } });
  await prisma.entityResolutionLink.create({ data: { workspaceId: workspace.id, entityObservationId: propertyObservation.id, propertyId: property.id, method: "MANUAL", status: "ACCEPTED" } });
  const stake = await createPropertyStake(prisma, { ...manualAssertion, workspaceId: workspace.id, companyId: owner.id, propertyId: property.id, predicate: "OWNS" });
  const ownsObservation = await recordRelationshipObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, predicate: "OWNS", subjectObservationId: ownerObservation.id, objectObservationId: propertyObservation.id, evidenceQuote: `${owner.canonicalName} owns ${property.canonicalName}` });
  await attachObservationSupport(prisma, { workspaceId: workspace.id, propertyStakeId: stake.id, relationshipObservationId: ownsObservation.id });

  const pendingEntity = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, observedType: "COMPANY", surfaceForm: "Pending Company", evidenceQuote: "Pending Company" });
  const pendingRelationship = await recordRelationshipObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, predicate: "MANAGES", subjectObservationId: pendingEntity.id, objectObservationId: propertyObservation.id, evidenceQuote: `Pending Company manages ${property.canonicalName}` });
  const rejectedEntity = await recordEntityObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, observedType: "PERSON", surfaceForm: "Rejected Phantom", evidenceQuote: "Rejected Phantom" });
  await recordObservationDisposition(prisma, { entityObservationId: rejectedEntity.id, disposition: "REJECTED", actor: "USER" });
  const rejectedRelationship = await recordRelationshipObservation(prisma, { ...extractor, workspaceId: workspace.id, sourceKind: "DOCUMENT_PAGE", dealId: deal.id, documentId: document.id, predicate: "MANAGES", subjectObservationId: ownerObservation.id, objectObservationId: propertyObservation.id, evidenceQuote: "rejected secret relationship" });
  await recordObservationDisposition(prisma, { relationshipObservationId: rejectedRelationship.id, disposition: "REJECTED", actor: "USER" });

  await prisma.negotiationRound.create({ data: { dealId: deal.id, side: "TENANT", roundNumber: 1, documentName: "Tenant LOI", documentText: "Initial terms", documentDate: new Date("2026-09-18T00:00:00Z"), createdAt: new Date("2026-09-19T00:00:00Z"), terms: { create: [{ canonicalType: "BASE_RENT", normalizedValue: "$61/RSF/year", normalizedNumeric: 61, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: "$61", status: "PROPOSED", side: "TENANT", roundNumber: 1, confidence: 1, evidenceQuote: "Initial rent evidence", sourceLocation: "Rent" }] } } });
  const counter = await prisma.negotiationRound.create({ data: { dealId: deal.id, side: "TENANT", roundNumber: 2, documentName: "Tenant Counter", documentText: "Counter terms", documentDate: new Date("2026-09-27T00:00:00Z"), sourceType: "PDF_UPLOAD", documentId: document.id, createdAt: new Date("2026-10-03T00:00:00Z"), terms: { create: [
    { canonicalType: "BASE_RENT", normalizedValue: "Stepped rent schedule", rawValue: "Stepped rent", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 1, evidenceQuote: "Exact rent evidence", sourceLocation: "Rent", documentPageId: page1.id, provenanceStatus: "EXACT", structuredPayload: { termType: "BASE_RENT", rent: { kind: "stepped", steps: [{ startMonth: 1, endMonth: 12, amountPerRSFYear: 65 }, { startMonth: 13, endMonth: 24, amountPerRSFYear: 67 }] } } },
    { canonicalType: "FREE_RENT", normalizedValue: "Irregular abatement schedule", rawValue: "Split abatement", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 1, evidenceQuote: "Duplicate term evidence", sourceLocation: "Abatement", provenanceStatus: "AMBIGUOUS", structuredPayload: { termType: "FREE_RENT", abatement: { kind: "irregular", periods: [{ startMonth: 1, endMonth: 3, abatementType: "FULL" }, { startMonth: 7, endMonth: 9, abatementType: "FULL" }], equivalentFullMonths: 6 }, scope: "BASE_RENT_ONLY" } },
    { canonicalType: "PARKING", normalizedValue: "20 spaces", rawValue: "20 spaces", status: "PROPOSED", side: "TENANT", roundNumber: 2, confidence: 1, evidenceQuote: "Unlocated term evidence", sourceLocation: "Parking", provenanceStatus: "UNLOCATED", structuredPayload: { termType: "PARKING", spacesCount: 20, spacesRatio: null, ratePerSpacePerMonth: 350, rateType: "FIXED", reserved: true, conditions: [] } },
  ] } } });
  await prisma.dealEvent.create({ data: { dealId: deal.id, messageId: message.id, type: "PROPOSAL_SENT", description: "Stored proposal activity", occurredAt: new Date("2026-09-20T00:00:00Z"), confidence: 1, evidenceQuote: "Participant evidence" } });

  return { workspace, deal, property, sarah, jll, owner, acme, document, unknownDocument, employment, unsupportedEmployment, personParticipation, pendingEntity, pendingRelationship, counterRoundId: counter.id };
}

async function snapshot(workspaceId: string) {
  const [people, companies, properties, employments, stakes, participations, observations, relationships, rounds, terms, runs, promotions] = await Promise.all([
    prisma.person.count({ where: { workspaceId } }),
    prisma.company.count({ where: { workspaceId } }),
    prisma.property.count({ where: { workspaceId } }),
    prisma.employment.count({ where: { workspaceId } }),
    prisma.propertyStake.count({ where: { workspaceId } }),
    prisma.dealParticipation.count({ where: { workspaceId } }),
    prisma.entityObservation.count({ where: { workspaceId } }),
    prisma.relationshipObservation.count({ where: { workspaceId } }),
    prisma.negotiationRound.count({ where: { deal: { workspaceId } } }),
    prisma.negotiationTerm.count({ where: { round: { deal: { workspaceId } } } }),
    prisma.graphExtractionRun.count({ where: { workspaceId } }),
    prisma.relationshipPromotion.count({ where: { workspaceId } }),
  ]);
  return { people, companies, properties, employments, stakes, participations, observations, relationships, rounds, terms, runs, promotions };
}
