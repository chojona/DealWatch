import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import {
  createCompany,
  createPerson,
  createWorkspace,
  recordEntityObservation,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import {
  acknowledgeBlockedRelationship,
  approveRelationshipObservation,
  createCanonicalEntityFromObservation,
} from "@/lib/promotion/service";
import { leaveEntityUnresolved, reopenEntityClosure } from "@/lib/review/closure";
import { recordReviewDecision } from "@/lib/review/decisions";
import { NO_DOCUMENTARY_SUPPORT } from "@/lib/graph/path-types";
import { deriveDealIntelligenceStatus } from "./project";
import { getDealIntelligence, rejectClientWorkspace } from "./service";
import { DEAL_INTELLIGENCE_STATUSES, type DealHealth } from "./types";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let workspaceId = "";
let sequence = 0;

const extractor = { extractor: "phase9a-test", extractorVersion: "phase9a" };

function health(overrides: Partial<DealHealth> = {}): DealHealth {
  return {
    documentCount: 0,
    reviewedDocumentCount: 0,
    reviewRequiredDocumentCount: 0,
    failedDocumentCount: 0,
    processingDocumentCount: 0,
    negotiationTermCount: 0,
    openTermCount: 0,
    agreedTermCount: 0,
    conflictCount: 0,
    unresolvedEntityCount: 0,
    blockedRelationshipCount: 0,
    evidenceIssueCount: 0,
    latestActivityAt: null,
    latestNegotiationAt: null,
    ...overrides,
  };
}

describe("Phase 9A deal intelligence", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    workspaceId = (await ensureDefaultWorkspace(prisma)).id;
  });
  test.after(async () => cleanup());

  test("status rules stay separate from stored deal status and omit COMPLETE", () => {
    assert.equal(DEAL_INTELLIGENCE_STATUSES.includes("COMPLETE" as never), false);
    assert.equal(deriveDealIntelligenceStatus(health()), "SETUP");
    assert.equal(deriveDealIntelligenceStatus(health({ documentCount: 1, processingDocumentCount: 1 })), "DOCUMENTS_PROCESSING");
    assert.equal(deriveDealIntelligenceStatus(health({ documentCount: 1, failedDocumentCount: 1 })), "REVIEW_REQUIRED");
    assert.equal(deriveDealIntelligenceStatus(health({ documentCount: 1, reviewedDocumentCount: 1 })), "SETUP");
    assert.equal(
      deriveDealIntelligenceStatus(health({ negotiationTermCount: 2, openTermCount: 2, processingDocumentCount: 1 })),
      "NEGOTIATING"
    );
    assert.equal(
      deriveDealIntelligenceStatus(health({ negotiationTermCount: 3, openTermCount: 1, agreedTermCount: 2 })),
      "MOSTLY_AGREED"
    );
    assert.equal(
      deriveDealIntelligenceStatus(health({ negotiationTermCount: 3, openTermCount: 1, agreedTermCount: 2, conflictCount: 1 })),
      "NEGOTIATING"
    );
    assert.equal(
      deriveDealIntelligenceStatus(health({ negotiationTermCount: 2, agreedTermCount: 2 })),
      "AGREED"
    );
    assert.equal(rejectClientWorkspace({ has: (name) => name === "workspaceId" }), "workspaceId is server-controlled");
    assert.equal(rejectClientWorkspace({ has: () => false }), null);
  });

  test("A empty deal", async () => {
    const deal = await dealNamed("Empty");
    const before = await counts();
    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.deepEqual(await counts(), before);
    assert.equal(intelligence?.intelligenceStatus, "SETUP");
    assert.equal(intelligence?.deal.recordStatus, "ACTIVE");
    assert.equal(intelligence?.health.documentCount, 0);
    assert.equal(intelligence?.health.negotiationTermCount, 0);
    assert.equal(intelligence?.openItems.length, 0);
    assert.equal(intelligence?.agreedTerms.length, 0);
    assert.equal(intelligence?.recentMovement.length, 0);
    assert.equal(intelligence?.documents.length, 0);
    assert.equal(intelligence?.reviewQueue.length, 0);
    assert.equal(intelligence?.team.property, null);
    assert.equal(intelligence?.activity.length, 0);
    assert.equal(await prisma.deal.findUnique({ where: { id: deal.id }, select: { status: true } }).then((row) => row?.status), "ACTIVE");
  });

  test("B one reviewed document", async () => {
    const deal = await dealNamed("Reviewed");
    await documentOn(deal.id, { originalFilename: "Reviewed.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.health.documentCount, 1);
    assert.equal(intelligence?.health.reviewedDocumentCount, 1);
    assert.equal(intelligence?.documents[0]?.reviewState, "REVIEWED");
    assert.equal(intelligence?.documents[0]?.action.label, "View reviewed document");
    assert.equal(intelligence?.reviewQueue.length, 0);
    assert.equal(intelligence?.intelligenceStatus, "SETUP");
  });

  test("C review-required document does not turn a proposal into agreement", async () => {
    const deal = await dealNamed("Review required");
    const document = await documentOn(deal.id, { originalFilename: "Proposal.pdf", ingestionStatus: "COMPLETE", negotiationSide: "TENANT" });
    const round = await roundOn(deal.id, document.id, "TENANT", 1, "2026-03-01", [term("BASE_RENT", 64, "PROPOSED", "TENANT", 1, "Tenant proposes $64")], "PDF_UPLOAD");
    const before = await getDealIntelligence(prisma, deal.id);
    assert.equal(before?.health.reviewRequiredDocumentCount, 1);
    assert.equal(before?.intelligenceStatus, "NEGOTIATING");
    assert.equal(before?.openItems[0]?.status, "PROPOSED");
    assert.equal(before?.agreedTerms.length, 0);
    assert.equal(before?.reviewQueue.some((item) => item.kind === "NEGOTIATION_REVIEW"), true);
    const termId = round.terms[0]!.id;
    await recordReviewDecision(prisma, {
      documentId: document.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: termId },
    });
    const after = await getDealIntelligence(prisma, deal.id);
    assert.equal(after?.documents[0]?.reviewState, "REVIEWED");
    assert.equal(after?.terms.find((item) => item.canonicalType === "BASE_RENT")?.status, "PROPOSED");
    assert.equal(after?.agreedTerms.length, 0);
    assert.equal(await prisma.deal.findUnique({ where: { id: deal.id }, select: { status: true } }).then((row) => row?.status), "ACTIVE");
  });

  test("D/E/F/L/M/N multiple documents, pasted rounds, movement, and older review", async () => {
    const deal = await dealNamed("Chronology");
    const older = await documentOn(deal.id, {
      originalFilename: "Older proposal.pdf",
      ingestionStatus: "COMPLETE",
      negotiationSide: "LANDLORD",
      documentDate: new Date("2026-01-15T00:00:00Z"),
    });
    const olderRound = await roundOn(deal.id, older.id, "LANDLORD", 1, "2026-01-15", [term("BASE_RENT", 69, "PROPOSED", "LANDLORD", 1, "Landlord proposes $69")], "PDF_UPLOAD");
    await recordReviewDecision(prisma, {
      documentId: older.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: olderRound.terms[0]!.id },
    });
    await roundOn(deal.id, null, "TENANT", 1, "2026-02-01", [term("BASE_RENT", 64, "PROPOSED", "TENANT", 1, "Tenant proposes $64")], "PASTED_TEXT", "Tenant paste");
    const newer = await documentOn(deal.id, {
      originalFilename: "Newer counter.pdf",
      ingestionStatus: "COMPLETE",
      negotiationSide: "LANDLORD",
      documentDate: new Date("2026-04-01T00:00:00Z"),
    });
    await roundOn(deal.id, newer.id, "LANDLORD", 2, "2026-04-01", [term("BASE_RENT", 67, "PROPOSED", "LANDLORD", 2, "Landlord proposes $67")], "PDF_UPLOAD");
    const quiet = await documentOn(deal.id, { originalFilename: "Graph only.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.health.documentCount, 3);
    assert.equal(intelligence?.documents.map((document) => document.name).join("|"), "Older proposal.pdf|Newer counter.pdf|Graph only.pdf");
    assert.equal(intelligence?.documents.find((document) => document.id === older.id)?.reviewState, "REVIEWED");
    assert.equal(intelligence?.documents.find((document) => document.id === newer.id)?.reviewState, "REVIEW_REQUIRED");
    assert.ok(quiet.id);
    const rent = intelligence?.terms.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rent?.tenantPosition?.kind === "VALUE" ? rent.tenantPosition.value.summary : null, "$64");
    assert.equal(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : null, "$67");
    assert.equal(rent?.status, "UNRESOLVED");
    assert.equal(rent?.latestSideToChange, "LANDLORD");
    assert.match(rent?.history.find((item) => item.side === "TENANT")?.evidence.sourceLabel ?? "", /Pasted text/);
    assert.equal(rent?.history.find((item) => item.side === "TENANT")?.evidence.pageNumber ?? null, null);
    const movement = intelligence?.recentMovement.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(movement?.movement.kind, "NUMERIC");
    assert.equal(movement?.movement.from, 69);
    assert.equal(movement?.movement.to, 67);
    assert.equal(movement?.movement.side, "LANDLORD");
    assert.match(movement?.landlordLine ?? "", /→/);
    assert.equal(movement?.tenantLine, "$64");
    const open = intelligence?.openItems.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(open?.latestChangingSide, "LANDLORD");
    assert.equal(open?.numericGap?.value, 3);
    assert.equal(open?.rank, 2);
  });

  test("G agreement is resolver-confirmed", async () => {
    const deal = await dealNamed("Agreement");
    const document = await documentOn(deal.id, { originalFilename: "Agreement.pdf", ingestionStatus: "COMPLETE", negotiationSide: "LANDLORD" });
    await roundOn(deal.id, document.id, "TENANT", 1, "2026-05-01", [term("TI_ALLOWANCE", 100, "PROPOSED", "TENANT", 1, "Tenant TI $100")], "PDF_UPLOAD");
    await roundOn(deal.id, document.id, "LANDLORD", 1, "2026-05-02", [term("TI_ALLOWANCE", 100, "AGREED", "LANDLORD", 1, "Landlord agrees TI $100")], "PDF_UPLOAD");
    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.intelligenceStatus, "AGREED");
    assert.equal(intelligence?.agreedTerms.length, 1);
    assert.equal(intelligence?.agreedTerms[0]?.agreedValue.summary, "$100");
    assert.equal(intelligence?.agreedTerms[0]?.agreedAt?.slice(0, 10), "2026-05-02");
    assert.equal(intelligence?.openItems.length, 0);
    assert.equal(intelligence?.health.reviewRequiredDocumentCount, 1);
  });

  test("H/I/J/K conflict, one-sided proposal, gap, and unsafe gap", async () => {
    const deal = await dealNamed("Positions");
    const document = await documentOn(deal.id, { originalFilename: "Positions.pdf", ingestionStatus: "COMPLETE", negotiationSide: "TENANT" });
    await roundOn(deal.id, document.id, "TENANT", 1, "2026-06-01", [
      term("BASE_RENT", 70, "PROPOSED", "TENANT", 1, "Rent option 70", { normalizedValue: "$70" }),
      term("BASE_RENT", 72, "PROPOSED", "TENANT", 1, "Rent option 72", { normalizedValue: "$72" }),
      term("FREE_RENT", 6, "PROPOSED", "TENANT", 1, "Six months free", { normalizedUnit: "MONTHS", normalizedValue: "6 months" }),
    ], "PDF_UPLOAD");
    await roundOn(deal.id, document.id, "LANDLORD", 1, "2026-06-02", [
      term("TI_ALLOWANCE", 90, "PROPOSED", "LANDLORD", 1, "Landlord TI $90"),
      term("FREE_RENT", 4, "PROPOSED", "LANDLORD", 1, "Four periods", { normalizedUnit: "USD", normalizedValue: "$4" }),
    ], "PDF_UPLOAD");
    await roundOn(deal.id, document.id, "TENANT", 2, "2026-06-03", [
      term("TI_ALLOWANCE", 110, "PROPOSED", "TENANT", 2, "Tenant TI $110"),
    ], "PDF_UPLOAD");
    const intelligence = await getDealIntelligence(prisma, deal.id);
    const byType = new Map(intelligence?.openItems.map((item) => [item.canonicalType, item]));
    const rent = byType.get("BASE_RENT");
    assert.equal(rent?.tenantPosition?.kind, "CONFLICT");
    assert.equal(rent?.rank, 1);
    assert.equal(rent?.numericGap, null);
    assert.equal(rent?.tenantPosition?.kind === "CONFLICT" ? rent.tenantPosition.candidates.length : 0, 2);
    const ti = byType.get("TI_ALLOWANCE");
    assert.equal(ti?.rank, 2);
    assert.equal(ti?.numericGap?.value, 20);
    assert.equal(ti?.status, "UNRESOLVED");
    const free = byType.get("FREE_RENT");
    assert.equal(free?.rank, 2);
    assert.equal(free?.numericGap, null);
    assert.equal(intelligence?.openItems.map((item) => item.canonicalType).join(","), "BASE_RENT,FREE_RENT,TI_ALLOWANCE");
    assert.equal(intelligence?.reviewQueue.some((item) => item.kind === "CONFLICT"), true);
  });

  test("one-sided proposal ranks after two-sided items", async () => {
    const deal = await dealNamed("One sided");
    const document = await documentOn(deal.id, { originalFilename: "One.pdf", ingestionStatus: "COMPLETE", negotiationSide: "TENANT" });
    await roundOn(deal.id, document.id, "TENANT", 1, "2026-07-01", [term("LEASE_TERM", null, "PROPOSED", "TENANT", 1, "Seven years", { normalizedNumeric: null, normalizedUnit: null, normalizedValue: "7 years" })], "PDF_UPLOAD");
    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.openItems[0]?.status, "PROPOSED");
    assert.equal(intelligence?.openItems[0]?.landlordPosition, null);
    assert.equal(intelligence?.openItems[0]?.rank, 3);
    assert.equal(intelligence?.openItems[0]?.numericGap, null);
  });

  test("O/P/Q/R review queue ignores closed work and returns reopened work", async () => {
    const prepareDeal = await dealNamed("Prepare");
    await documentOn(prepareDeal.id, {
      originalFilename: "Needs prepare.pdf",
      ingestionStatus: "READY",
      negotiationSide: null,
      documentDate: null,
      pageCount: 1,
    });
    const prepare = await getDealIntelligence(prisma, prepareDeal.id);
    assert.equal(prepare?.reviewQueue.some((item) => item.kind === "PREPARE"), true);
    assert.equal(prepare?.intelligenceStatus, "DOCUMENTS_PROCESSING");

    const follow = await dealNamed("Follow up");
    const followDocument = await documentOn(follow.id, { originalFilename: "Follow.pdf", ingestionStatus: "COMPLETE", negotiationSide: "TENANT" });
    const followRound = await roundOn(follow.id, followDocument.id, "TENANT", 1, "2026-07-02", [
      term("BASE_RENT", 64, "PROPOSED", "TENANT", 1, "Unlocated rent quote", { provenanceStatus: "UNLOCATED" }),
    ], "PDF_UPLOAD");
    await recordReviewDecision(prisma, {
      documentId: followDocument.id,
      action: "NEEDS_FOLLOW_UP",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: followRound.terms[0]!.id },
    });
    const followIntelligence = await getDealIntelligence(prisma, follow.id);
    assert.equal(followIntelligence?.reviewQueue.some((item) => item.kind === "FOLLOW_UP"), true);
    assert.equal(followIntelligence?.reviewQueue.some((item) => item.kind === "PROVENANCE"), true);
    assert.equal(followIntelligence?.agreedTerms.length, 0);

    const left = await dealNamed("Left unresolved");
    const leftDocument = await documentOn(left.id, { originalFilename: "Left.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const observation = await observe(left.id, leftDocument.id, "Unpromoted Co", "COMPANY", "Unpromoted Co appears once");
    await leaveEntityUnresolved(prisma, { documentId: leftDocument.id, observationId: observation.id });
    const leftIntelligence = await getDealIntelligence(prisma, left.id);
    assert.equal(leftIntelligence?.reviewQueue.some((item) => item.kind === "ENTITY"), false);
    assert.equal(leftIntelligence?.health.unresolvedEntityCount, 0);
    assert.equal(leftIntelligence?.team.other.some((party) => party.name === "Unpromoted Co"), false);
    assert.equal(leftIntelligence?.documents[0]?.reviewState, "REVIEWED");

    await reopenEntityClosure(prisma, { documentId: leftDocument.id, observationId: observation.id });
    const reopened = await getDealIntelligence(prisma, left.id);
    assert.equal(reopened?.reviewQueue.some((item) => item.kind === "ENTITY"), true);
    assert.equal(reopened?.documents[0]?.reviewState, "REVIEW_REQUIRED");

    const blocked = await dealNamed("Blocked");
    const blockedDocument = await documentOn(blocked.id, { originalFilename: "Blocked.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const person = await observe(blocked.id, blockedDocument.id, "Pat Broker", "PERSON", "Pat Broker appears once");
    const company = await observe(blocked.id, blockedDocument.id, "Pat Co", "COMPANY", "Pat Co appears once");
    const relationship = await recordRelationshipObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: blocked.id,
      documentId: blockedDocument.id,
      predicate: "WORKS_AT",
      subjectObservationId: person.id,
      objectObservationId: company.id,
      evidenceQuote: "Pat Broker appears once",
    });
    await acknowledgeBlockedRelationship(prisma, relationship.id);
    const acknowledged = await getDealIntelligence(prisma, blocked.id);
    assert.equal(acknowledged?.reviewQueue.some((item) => item.kind === "RELATIONSHIP"), false);
    assert.equal(acknowledged?.health.blockedRelationshipCount, 0);
    assert.equal(acknowledged?.reviewQueue.some((item) => item.kind === "ENTITY"), true);
    await createCanonicalEntityFromObservation(prisma, person.id);
    await createCanonicalEntityFromObservation(prisma, company.id);
    const stale = await getDealIntelligence(prisma, blocked.id);
    assert.equal(stale?.reviewQueue.some((item) => item.kind === "RELATIONSHIP"), true);
    assert.equal(stale?.team.tenantBrokers.length, 0);
    assert.equal(stale?.team.other.some((party) => party.name === "Pat Broker"), false);
  });

  test("S failed document", async () => {
    const deal = await dealNamed("Failed");
    await documentOn(deal.id, {
      originalFilename: "Scanned.pdf",
      ingestionStatus: "FAILED",
      failureCode: "SCANNED_OR_EMPTY",
      failureReason: "This PDF has no usable embedded text.",
    });
    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.health.failedDocumentCount, 1);
    assert.equal(intelligence?.intelligenceStatus, "REVIEW_REQUIRED");
    assert.equal(intelligence?.reviewQueue.some((item) => item.kind === "FAILED"), true);
    assert.equal(intelligence?.documents[0]?.action.label, "View failure");
  });

  test("T processing document", async () => {
    const deal = await dealNamed("Processing");
    await documentOn(deal.id, { originalFilename: "Running.pdf", ingestionStatus: "ANALYZING" });
    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.health.processingDocumentCount, 1);
    assert.equal(intelligence?.intelligenceStatus, "DOCUMENTS_PROCESSING");
    assert.equal(intelligence?.reviewQueue.some((item) => item.documentName === "Running.pdf"), false);
    assert.equal(intelligence?.documents[0]?.analysis, "Running");
  });

  test("U/V/W/X/Y canonical team, employers, and evidence", async () => {
    const deal = await dealNamed("Team");
    const document = await documentOn(deal.id, { originalFilename: "Team.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED", negotiationSide: "TENANT" });
    const tenant = await observe(deal.id, document.id, "Northwind Labs", "COMPANY", "Tenant is Northwind Labs.");
    const landlord = await observe(deal.id, document.id, "Boston Properties", "COMPANY", "Landlord is Boston Properties.");
    const broker = await observe(deal.id, document.id, "Sarah Chen", "PERSON", "Sarah Chen is a broker at Harbor Brokerage.");
    const brokerage = await observe(deal.id, document.id, "Harbor Brokerage", "COMPANY", "Sarah Chen is a broker at Harbor Brokerage.");
    const property = await observe(deal.id, document.id, "200 Clarendon", "PROPERTY", "Property is 200 Clarendon.");
    const stray = await observe(deal.id, document.id, "Unresolved Vendor", "COMPANY", "Unresolved Vendor appears once");
    await createCanonicalEntityFromObservation(prisma, tenant.id);
    await createCanonicalEntityFromObservation(prisma, landlord.id);
    await createCanonicalEntityFromObservation(prisma, broker.id);
    await createCanonicalEntityFromObservation(prisma, brokerage.id);
    await createCanonicalEntityFromObservation(prisma, property.id);
    await approveRelationshipObservation(prisma, (await relate(deal.id, document.id, {
      predicate: "PARTICIPATES_AS",
      subjectObservationId: tenant.id,
      participationRole: "TENANT",
      evidenceQuote: "Tenant is Northwind Labs.",
    })).id);
    await approveRelationshipObservation(prisma, (await relate(deal.id, document.id, {
      predicate: "PARTICIPATES_AS",
      subjectObservationId: landlord.id,
      participationRole: "LANDLORD",
      evidenceQuote: "Landlord is Boston Properties.",
    })).id);
    await approveRelationshipObservation(prisma, (await relate(deal.id, document.id, {
      predicate: "PARTICIPATES_AS",
      subjectObservationId: broker.id,
      participationRole: "TENANT_BROKER",
      principalObservationId: tenant.id,
      evidenceQuote: "Sarah Chen is a broker at Harbor Brokerage.",
    })).id);
    await approveRelationshipObservation(prisma, (await relate(deal.id, document.id, {
      predicate: "WORKS_AT",
      subjectObservationId: broker.id,
      objectObservationId: brokerage.id,
      affiliationKind: "BROKER",
      statedTitle: "Broker",
      evidenceQuote: "Sarah Chen is a broker at Harbor Brokerage.",
    })).id);
    await approveRelationshipObservation(prisma, (await relate(deal.id, document.id, {
      predicate: "CONCERNS_PROPERTY",
      subjectObservationId: property.id,
      evidenceQuote: "Property is 200 Clarendon.",
    })).id);

    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.team.property?.name, "200 Clarendon");
    assert.equal(intelligence?.team.property?.evidence.supportCount, 1);
    assert.equal(intelligence?.team.tenant[0]?.name, "Northwind Labs");
    assert.equal(intelligence?.team.tenant[0]?.evidence.supportCount, 1);
    assert.equal(intelligence?.team.landlord[0]?.name, "Boston Properties");
    assert.equal(intelligence?.team.tenantBrokers[0]?.name, "Sarah Chen");
    assert.equal(intelligence?.team.tenantBrokers[0]?.representsCompanyName, "Northwind Labs");
    assert.equal(intelligence?.team.tenantBrokers[0]?.employers[0]?.companyName, "Harbor Brokerage");
    assert.equal(intelligence?.team.tenantBrokers[0]?.employers[0]?.title, "Broker");
    assert.match(intelligence?.team.tenant[0]?.href ?? "", /^\/companies\//);
    assert.match(intelligence?.team.tenantBrokers[0]?.href ?? "", /^\/people\//);
    assert.equal(intelligence?.team.other.some((party) => party.name === "Unresolved Vendor"), false);
    assert.equal(intelligence?.facts.some((fact) => fact.value === "Unresolved Vendor"), false);
    assert.equal(stray.surfaceForm, "Unresolved Vendor");

    const bare = await dealNamed("Zero support");
    const person = await createPerson(prisma, { workspaceId, canonicalName: "Manual Person" });
    const company = await createCompany(prisma, { workspaceId, canonicalName: "Manual Landlord" });
    await prisma.dealParticipation.create({
      data: {
        workspaceId,
        dealId: bare.id,
        role: "LANDLORD",
        companyId: company.id,
        assertionSource: "MANUAL",
      },
    });
    await prisma.dealParticipation.create({
      data: {
        workspaceId,
        dealId: bare.id,
        role: "TENANT_BROKER",
        personId: person.id,
        assertionSource: "MANUAL",
      },
    });
    const unsupported = await getDealIntelligence(prisma, bare.id);
    assert.equal(unsupported?.team.landlord[0]?.evidence.supportCount, 0);
    assert.equal(unsupported?.team.landlord[0]?.evidence.supports.length, 0);
    assert.equal(NO_DOCUMENTARY_SUPPORT, "No documentary support is currently linked to this canonical assertion.");
  });

  test("Z workspace isolation and zero writes", async () => {
    const other = await createWorkspace(prisma, { name: `Other ${++sequence}` });
    const foreign = await prisma.deal.create({
      data: {
        name: "Foreign Tower",
        company: "Other Co",
        property: "1 Other Street",
        stage: "LOI",
        status: "ACTIVE",
        workspaceId: other.id,
      },
    });
    await documentOn(foreign.id, { originalFilename: "Foreign.pdf", ingestionStatus: "COMPLETE" });
    const person = await createPerson(prisma, { workspaceId: other.id, canonicalName: "Foreign Person" });
    await prisma.dealParticipation.create({
      data: {
        workspaceId: other.id,
        dealId: foreign.id,
        role: "TENANT",
        personId: person.id,
        assertionSource: "MANUAL",
      },
    });
    const home = await dealNamed("Home");
    const before = await counts();
    const intelligence = await getDealIntelligence(prisma, home.id);
    assert.deepEqual(await counts(), before);
    assert.equal(intelligence?.documents.some((document) => document.name === "Foreign.pdf"), false);
    assert.equal(intelligence?.team.tenant.some((party) => party.name === "Foreign Person"), false);
    assert.equal(intelligence?.deal.workspaceId, workspaceId);
    const foreignIntelligence = await getDealIntelligence(prisma, foreign.id);
    assert.equal(foreignIntelligence?.deal.workspaceId, other.id);
    assert.equal(foreignIntelligence?.documents[0]?.name, "Foreign.pdf");
    assert.equal(foreignIntelligence?.team.tenant[0]?.name, "Foreign Person");
  });
});

async function counts() {
  const [deals, documents, terms, people, decisions, participations] = await Promise.all([
    prisma.deal.count(),
    prisma.document.count(),
    prisma.negotiationTerm.count(),
    prisma.person.count(),
    prisma.reviewDecision.count(),
    prisma.dealParticipation.count(),
  ]);
  return { deals, documents, terms, people, decisions, participations };
}

async function dealNamed(name: string) {
  return prisma.deal.create({
    data: {
      name,
      company: "Acme Corp",
      property: "200 Clarendon Street",
      stage: "Negotiation",
      status: "ACTIVE",
      workspaceId,
    },
  });
}

async function documentOn(
  dealId: string,
  overrides: Partial<{
    originalFilename: string;
    ingestionStatus: "UPLOADED" | "EXTRACTING" | "READY" | "ANALYZING" | "COMPLETE" | "FAILED";
    graphExtractionStatus: "NOT_RUN" | "SUCCEEDED" | "FAILED";
    failureCode: string | null;
    failureReason: string | null;
    negotiationSide: string | null;
    documentDate: Date | null;
    pageCount: number | null;
  }>
) {
  const id = ++sequence;
  return prisma.document.create({
    data: {
      dealId,
      filename: `file-${id}.pdf`,
      originalFilename: overrides.originalFilename ?? `Document ${id}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 128,
      sha256: `sha-${id}`,
      documentType: "LOI",
      documentDate: overrides.documentDate === undefined ? new Date("2026-08-01T00:00:00Z") : overrides.documentDate,
      negotiationSide: overrides.negotiationSide === undefined ? "TENANT" : overrides.negotiationSide,
      ingestionStatus: overrides.ingestionStatus ?? "COMPLETE",
      graphExtractionStatus: overrides.graphExtractionStatus ?? "NOT_RUN",
      failureCode: overrides.failureCode ?? null,
      failureReason: overrides.failureReason ?? null,
      storageKey: `pending-${id}`,
      pageCount: overrides.pageCount === undefined ? 1 : overrides.pageCount,
    },
  });
}

function term(
  canonicalType: string,
  numeric: number | null,
  status: string,
  side: string,
  roundNumber: number,
  evidenceQuote: string,
  extra?: Record<string, unknown>
) {
  return {
    canonicalType,
    normalizedValue: numeric === null ? evidenceQuote : `$${numeric}`,
    normalizedNumeric: numeric,
    normalizedUnit: numeric === null ? null : "USD_PER_RSF_YEAR",
    rawValue: evidenceQuote,
    status,
    side,
    roundNumber,
    confidence: 1,
    evidenceQuote,
    sourceLocation: "Body",
    provenanceStatus: "EXACT" as const,
    ...extra,
  };
}

async function roundOn(
  dealId: string,
  documentId: string | null,
  side: "TENANT" | "LANDLORD",
  roundNumber: number,
  date: string,
  terms: ReturnType<typeof term>[],
  sourceType: string,
  documentName = `Round ${roundNumber}`
) {
  return prisma.negotiationRound.create({
    data: {
      dealId,
      side,
      roundNumber,
      documentName,
      documentText: terms.map((item) => item.evidenceQuote).join("\n"),
      documentDate: new Date(`${date}T00:00:00Z`),
      sourceType,
      documentId,
      terms: { create: terms },
    },
    include: { terms: true },
  });
}

async function observe(
  dealId: string,
  documentId: string,
  surfaceForm: string,
  observedType: "PERSON" | "COMPANY" | "PROPERTY",
  evidenceQuote: string
) {
  const page = await prisma.documentPage.findFirst({ where: { documentId, pageNumber: 1 } });
  if (!page) {
    await prisma.documentPage.create({ data: { documentId, pageNumber: 1, text: evidenceQuote } });
  } else if (!page.text.includes(evidenceQuote)) {
    await prisma.documentPage.update({
      where: { id: page.id },
      data: { text: `${page.text}\n${evidenceQuote}` },
    });
  }
  return recordEntityObservation(prisma, {
    ...extractor,
    workspaceId,
    sourceKind: "DOCUMENT_PAGE",
    dealId,
    documentId,
    observedType,
    surfaceForm,
    evidenceQuote,
  });
}

async function relate(
  dealId: string,
  documentId: string,
  input: {
    predicate: "PARTICIPATES_AS" | "WORKS_AT" | "CONCERNS_PROPERTY";
    subjectObservationId: string;
    objectObservationId?: string;
    principalObservationId?: string;
    participationRole?: "TENANT" | "LANDLORD" | "TENANT_BROKER";
    affiliationKind?: "BROKER";
    statedTitle?: string;
    evidenceQuote: string;
  }
) {
  return recordRelationshipObservation(prisma, {
    ...extractor,
    workspaceId,
    sourceKind: "DOCUMENT_PAGE",
    dealId,
    documentId,
    contextDealId: dealId,
    predicate: input.predicate,
    subjectObservationId: input.subjectObservationId,
    objectObservationId: input.objectObservationId,
    principalObservationId: input.principalObservationId,
    participationRole: input.participationRole,
    affiliationKind: input.affiliationKind,
    statedTitle: input.statedTitle,
    evidenceQuote: input.evidenceQuote,
  });
}
