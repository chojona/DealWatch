import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { GraphModelExtractor } from "@/lib/ai/graph/extractModel";
import { getActivityPage } from "@/lib/activity/service";
import { runDocumentGraphExtraction } from "@/lib/documents/runGraphExtraction";
import { DemoResetError, resetDevelopmentDocument } from "@/lib/documents/demoReset";
import {
  CRE_REVIEW_GRAPH,
  CRE_REVIEW_QUOTES,
  creReviewTestPdf,
} from "@/lib/documents/fixtures/creReviewFixture";
import {
  analyzeNegotiationDocument,
  receiveNegotiationPdf,
  type NegotiationTermExtractor,
} from "@/lib/documents/ingestNegotiationPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { recordEntityObservation, recordRelationshipObservation } from "@/lib/entities/service";
import { GraphInvariantError } from "@/lib/entities/errors";
import { createWorkspace, ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getConnectionGraph } from "@/lib/graph/service";
import { scoreConnectionPath, scoreEdgeStrength } from "@/lib/graph/strength";
import { getInbox, getDocumentReview } from "@/lib/inbox/service";
import { getDealIntelligence } from "@/lib/deals/intelligence/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import {
  acknowledgeBlockedRelationship,
  approveRelationshipObservation,
  createCanonicalEntityFromObservation,
  getDealKnowledge,
} from "@/lib/promotion/service";
import { leaveEntityUnresolved, reopenEntityClosure } from "@/lib/review/closure";
import { recordReviewDecision, ReviewActionError } from "@/lib/review/decisions";
import { correctNegotiationEvidence } from "@/lib/review/evidence";
import { getReviewHistory } from "@/lib/review/history";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let workspaceId = "";

const extractor = { extractor: "phase8f-test", extractorVersion: "phase8f" };
const quote = "Base Rent shall be $65.00 per rentable square foot.";

describe("Phase 8F document review closure", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    workspaceId = (await ensureDefaultWorkspace(prisma)).id;
  });
  test.after(async () => cleanup());

  test("A/B persist leave unresolved without a canonical entity, and repeat it once", async () => {
    const fixture = await scaffold("Leave unresolved");
    const peopleBefore = await prisma.person.count({ where: { workspaceId } });
    const companiesBefore = await prisma.company.count({ where: { workspaceId } });
    const propertiesBefore = await prisma.property.count({ where: { workspaceId } });
    const linksBefore = await prisma.entityResolutionLink.count({ where: { entityObservationId: fixture.company.id } });
    const first = await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    const second = await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    assert.equal(first.reviewState, "LEFT_UNRESOLVED");
    assert.equal(second.id, first.id);
    assert.equal(await prisma.reviewDecisionEvent.count({ where: { documentId: fixture.document.id, kind: "ENTITY_CLOSURE" } }), 1);
    assert.equal(await prisma.person.count({ where: { workspaceId } }), peopleBefore);
    assert.equal(await prisma.company.count({ where: { workspaceId } }), companiesBefore);
    assert.equal(await prisma.property.count({ where: { workspaceId } }), propertiesBefore);
    assert.equal(await prisma.entityResolutionLink.count({ where: { entityObservationId: fixture.company.id } }), linksBefore);
    const review = await getDocumentReview(prisma, workspaceId, fixture.document.id);
    assert.equal(review?.item.entityReviewSummary.leftUnresolved, 1);
    assert.equal(review?.item.entityReviewSummary.unresolved, 1);
    assert.equal(review?.item.processingStatus, "REVIEW_REQUIRED");
  });

  test("C/D reopen an unresolved entity, then resolve it", async () => {
    const fixture = await scaffold("Reopen");
    await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    await reopenEntityClosure(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    const reopened = await getDocumentReview(prisma, workspaceId, fixture.document.id);
    assert.equal(reopened?.item.entityReviewSummary.leftUnresolved, 0);
    assert.equal(reopened?.item.entityReviewSummary.unresolved, 2);
    const created = await createCanonicalEntityFromObservation(prisma, fixture.company.id);
    assert.ok(created);
    const review = await getDocumentReview(prisma, workspaceId, fixture.document.id);
    assert.equal(review?.item.entityReviewSummary.resolved, 1);
    assert.equal(review?.item.entityReviewSummary.leftUnresolved, 0);
    const history = await getReviewHistory(prisma, { workspaceId, documentId: fixture.document.id });
    assert.ok(history?.entries.some((entry) => entry.label === "Entity left unresolved"));
    assert.ok(history?.entries.some((entry) => entry.label === "Entity review reopened"));
    assert.ok(history?.entries.some((entry) => entry.label === "Entity resolved"));
    assert.equal(history?.entries.every((entry) => entry.actorLabel === "Manual review"), true);
  });

  test("E-I blocked acknowledgement does not create an edge and can be approved after resolution", async () => {
    const fixture = await scaffold("Blocked");
    await createCanonicalEntityFromObservation(prisma, fixture.person.id);
    const employmentsBefore = await prisma.employment.count({ where: { workspaceId } });
    const stakesBefore = await prisma.propertyStake.count({ where: { workspaceId } });
    const participationsBefore = await prisma.dealParticipation.count({ where: { workspaceId } });
    const propertyBefore = fixture.deal.propertyId;
    const previewBlocked = (await import("@/lib/promotion/service")).previewRelationshipPromotion;
    const blocked = await previewBlocked(prisma, fixture.relationship.id);
    assert.equal(blocked?.status, "BLOCKED_UNRESOLVED_ENTITY");
    assert.equal(blocked?.endpoints.some((endpoint) => endpoint.closure === "UNREVIEWED"), true);
    await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    const left = await previewBlocked(prisma, fixture.relationship.id);
    assert.equal(left?.status, "BLOCKED_UNRESOLVED_ENTITY");
    assert.equal(left?.endpoints.find((endpoint) => endpoint.observationId === fixture.company.id)?.closure, "LEFT_UNRESOLVED");
    await assert.rejects(() => approveRelationshipObservation(prisma, fixture.relationship.id), GraphInvariantError);
    const first = await acknowledgeBlockedRelationship(prisma, fixture.relationship.id);
    const second = await acknowledgeBlockedRelationship(prisma, fixture.relationship.id);
    assert.equal(first?.decision, "ACKNOWLEDGED_BLOCKED");
    assert.equal(second?.idempotent, true);
    assert.equal(await prisma.relationshipPromotionEvent.count({ where: { relationshipObservationId: fixture.relationship.id } }), 1);
    assert.equal(await prisma.employment.count({ where: { workspaceId } }), employmentsBefore);
    assert.equal(await prisma.propertyStake.count({ where: { workspaceId } }), stakesBefore);
    assert.equal(await prisma.dealParticipation.count({ where: { workspaceId } }), participationsBefore);
    assert.equal((await prisma.deal.findUnique({ where: { id: fixture.deal.id } }))?.propertyId, propertyBefore);
    const acknowledged = await previewBlocked(prisma, fixture.relationship.id);
    assert.equal(acknowledged?.status, "ACKNOWLEDGED_BLOCKED");
    assert.equal(acknowledged?.canonical, null);
    await reopenEntityClosure(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    await createCanonicalEntityFromObservation(prisma, fixture.company.id);
    const ready = await previewBlocked(prisma, fixture.relationship.id);
    assert.equal(ready?.status, "PENDING");
    assert.equal(ready?.canApprove, true);
    const approved = await approveRelationshipObservation(prisma, fixture.relationship.id);
    assert.equal(approved?.decision, "APPROVED");
    assert.equal(await prisma.employment.count({ where: { workspaceId } }), employmentsBefore + 1);
  });

  test("J-N review completion allows unresolved closure and reopens for follow-up", async () => {
    const fixture = await scaffold("Reviewed");
    await recordReviewDecision(prisma, {
      documentId: fixture.document.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: fixture.term.id },
    });
    await createCanonicalEntityFromObservation(prisma, fixture.person.id);
    await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    await acknowledgeBlockedRelationship(prisma, fixture.relationship.id);
    const reviewed = await getDocumentReview(prisma, workspaceId, fixture.document.id);
    assert.equal(reviewed?.item.processingStatus, "REVIEWED");
    assert.equal(reviewed?.item.requiresReview, false);
    assert.equal(reviewed?.completion.entitiesLeftUnresolved, 1);
    assert.equal(reviewed?.completion.relationshipsAcknowledgedBlocked, 1);
    assert.equal(reviewed?.completion.result, "REVIEWED");
    const inbox = await getInbox(prisma, { workspaceId, dealId: fixture.deal.id, filter: "NEEDS_REVIEW" });
    assert.equal(inbox.items.some((item) => item.document.id === fixture.document.id), false);
    const complete = await getInbox(prisma, { workspaceId, dealId: fixture.deal.id, filter: "COMPLETE" });
    assert.equal(complete.items.some((item) => item.document.id === fixture.document.id), true);

    await recordReviewDecision(prisma, {
      documentId: fixture.document.id,
      action: "NEEDS_FOLLOW_UP",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: fixture.term.id },
      note: "Check the rent",
    });
    const reopened = await getDocumentReview(prisma, workspaceId, fixture.document.id);
    assert.equal(reopened?.item.processingStatus, "REVIEW_REQUIRED");
    await recordReviewDecision(prisma, {
      documentId: fixture.document.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: fixture.term.id },
    });
    const restored = await getDocumentReview(prisma, workspaceId, fixture.document.id);
    assert.equal(restored?.item.processingStatus, "REVIEWED");
  });

  test("O-Q review history is ordered and does not repeat an identical action", async () => {
    const fixture = await scaffold("History");
    await recordReviewDecision(prisma, {
      documentId: fixture.document.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: fixture.term.id },
    });
    await wait();
    await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    await wait();
    await createCanonicalEntityFromObservation(prisma, fixture.person.id);
    await wait();
    await acknowledgeBlockedRelationship(prisma, fixture.relationship.id);
    await recordReviewDecision(prisma, {
      documentId: fixture.document.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: fixture.term.id },
    });
    const history = await getReviewHistory(prisma, { workspaceId, documentId: fixture.document.id });
    const labels = history?.entries.map((entry) => entry.label) ?? [];
    assert.deepEqual(labels, [
      "Negotiation finding acknowledged",
      "Entity left unresolved",
      "Entity resolved",
      "Blocked relationship acknowledged",
    ]);
    const times = history?.entries.map((entry) => entry.occurredAt) ?? [];
    assert.deepEqual(times, [...times].sort((a, b) => a.localeCompare(b)));
    assert.equal(labels.filter((label) => label === "Negotiation finding acknowledged").length, 1);
  });

  test("R-U unresolved closure and blocked acknowledgement do not change negotiation or graph scores", async () => {
    const fixture = await scaffold("Truth");
    await createCanonicalEntityFromObservation(prisma, fixture.person.id);
    await createCanonicalEntityFromObservation(prisma, fixture.company.id);
    await approveRelationshipObservation(prisma, fixture.relationship.id);
    const page = await prisma.documentPage.findFirstOrThrow({ where: { documentId: fixture.document.id } });
    const correction = await correctNegotiationEvidence(prisma, {
      documentId: fixture.document.id,
      negotiationTermId: fixture.term.id,
      documentPageId: page.id,
      startOffset: page.text.indexOf(quote),
      endOffset: page.text.indexOf(quote) + quote.length,
      evidenceQuote: quote,
    });
    const termsBefore = await prisma.negotiationTerm.findMany({
      where: { round: { documentId: fixture.document.id } },
      select: { id: true, normalizedValue: true, status: true, structuredPayload: true, evidenceQuote: true },
    });
    const negotiationBefore = negotiationSnapshot(await getNegotiationWorkspace(prisma, fixture.deal.id));
    const graphBefore = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: (await resolvedPersonId(fixture.person.id)) });
    const strengthBefore = (graphBefore?.edges ?? []).map((edge) => ({
      id: edge.canonicalAssertionId,
      type: edge.relationshipType,
      supportCount: edge.supportCount,
    }));
    const rankBefore = scoreConnectionPath([{ strengthScore: 0.5, recency: "recent" }]);
    const fixedStrength = scoreEdgeStrength({
      assertionSource: "OBSERVATION",
      hasExactProvenance: true,
      observationCount: 1,
      distinctDocumentCount: 1,
      distinctMessageCount: 0,
      sharedDealCount: 1,
      newestEvidenceAt: new Date("2026-09-01T00:00:00Z"),
      open: true,
      now: new Date("2026-09-28T00:00:00Z"),
    });
    const other = await recordEntityObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: fixture.deal.id,
      documentId: fixture.document.id,
      observedType: "COMPANY",
      surfaceForm: "Unrelated Holdings",
      evidenceQuote: quote,
    });
    await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: other.id });
    const strengthAfter = scoreEdgeStrength({
      assertionSource: "OBSERVATION",
      hasExactProvenance: true,
      observationCount: 1,
      distinctDocumentCount: 1,
      distinctMessageCount: 0,
      sharedDealCount: 1,
      newestEvidenceAt: new Date("2026-09-01T00:00:00Z"),
      open: true,
      now: new Date("2026-09-28T00:00:00Z"),
    });
    const termsAfter = await prisma.negotiationTerm.findMany({
      where: { round: { documentId: fixture.document.id } },
      select: { id: true, normalizedValue: true, status: true, structuredPayload: true, evidenceQuote: true },
    });
    const negotiationAfter = negotiationSnapshot(await getNegotiationWorkspace(prisma, fixture.deal.id));
    const graphAfter = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: await resolvedPersonId(fixture.person.id) });
    assert.deepEqual(termsAfter, termsBefore);
    assert.deepEqual(negotiationAfter, negotiationBefore);
    assert.deepEqual(
      (graphAfter?.edges ?? []).map((edge) => ({
        id: edge.canonicalAssertionId,
        type: edge.relationshipType,
        supportCount: edge.supportCount,
      })),
      strengthBefore
    );
    assert.equal(scoreConnectionPath([{ strengthScore: 0.5, recency: "recent" }]), rankBefore);
    assert.deepEqual(strengthAfter, fixedStrength);
    assert.equal(
      (await prisma.evidenceCorrection.findMany({ where: { documentId: fixture.document.id }, select: { id: true, evidenceQuote: true } })).map((row) => row.id).join(),
      correction.correction.id
    );
  });

  test("V/W workspace and document boundaries reject foreign observations", async () => {
    const fixture = await scaffold("Boundary");
    const otherWorkspace = await createWorkspace(prisma, { name: "Phase 8F elsewhere" });
    const otherDeal = await prisma.deal.create({
      data: {
        name: "Other deal",
        company: "Other Co",
        property: "Other property",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: otherWorkspace.id,
      },
    });
    const otherDocument = await prisma.document.create({ data: documentData(otherDeal.id, "Other.pdf") });
    await prisma.documentPage.create({ data: { documentId: otherDocument.id, pageNumber: 1, text: quote } });
    const foreign = await recordEntityObservation(prisma, {
      ...extractor,
      workspaceId: otherWorkspace.id,
      sourceKind: "DOCUMENT_PAGE",
      dealId: otherDeal.id,
      documentId: otherDocument.id,
      observedType: "PERSON",
      surfaceForm: "Foreign Person",
      evidenceQuote: quote,
    });
    await assert.rejects(
      () => leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: foreign.id }),
      (error: unknown) => error instanceof ReviewActionError && error.code === "CROSS_DOCUMENT"
    );
    const siblingDocument = await prisma.document.create({ data: documentData(fixture.deal.id, "Sibling.pdf") });
    await prisma.documentPage.create({ data: { documentId: siblingDocument.id, pageNumber: 1, text: quote } });
    const sibling = await recordEntityObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: fixture.deal.id,
      documentId: siblingDocument.id,
      observedType: "COMPANY",
      surfaceForm: "Sibling Co",
      evidenceQuote: quote,
    });
    await assert.rejects(
      () => leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: sibling.id }),
      (error: unknown) => error instanceof ReviewActionError && error.code === "CROSS_DOCUMENT"
    );
    const foreignCompany = await recordEntityObservation(prisma, {
      ...extractor,
      workspaceId: otherWorkspace.id,
      sourceKind: "DOCUMENT_PAGE",
      dealId: otherDeal.id,
      documentId: otherDocument.id,
      observedType: "COMPANY",
      surfaceForm: "Foreign Co",
      evidenceQuote: quote,
    });
    const mismatched = await recordRelationshipObservation(prisma, {
      ...extractor,
      workspaceId: otherWorkspace.id,
      sourceKind: "DOCUMENT_PAGE",
      dealId: otherDeal.id,
      documentId: otherDocument.id,
      predicate: "WORKS_AT",
      subjectObservationId: foreign.id,
      objectObservationId: foreignCompany.id,
      evidenceQuote: quote,
    });
    await prisma.relationshipObservation.update({
      where: { id: mismatched.id },
      data: { workspaceId },
    });
    await assert.rejects(() => acknowledgeBlockedRelationship(prisma, mismatched.id), GraphInvariantError);
  });

  test("X-Z negotiation, knowledge, graph, and activity follow stored review truth", async () => {
    const fixture = await scaffold("Surfaces");
    await recordReviewDecision(prisma, {
      documentId: fixture.document.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: fixture.term.id },
    });
    const person = await createCanonicalEntityFromObservation(prisma, fixture.person.id);
    await leaveEntityUnresolved(prisma, { documentId: fixture.document.id, observationId: fixture.company.id });
    await acknowledgeBlockedRelationship(prisma, fixture.relationship.id);
    const negotiation = await getNegotiationWorkspace(prisma, fixture.deal.id);
    assert.equal(negotiation?.terms.some((term) => term.canonicalType === "BASE_RENT"), true);
    const knowledge = await getDealKnowledge(prisma, fixture.deal.id);
    assert.ok(await prisma.person.findUnique({ where: { id: person!.entityId } }));
    assert.equal(knowledge?.canonical.people.some((row) => row.name.includes("Company")), false);
    assert.equal(knowledge?.canonical.employments.length, 0);
    assert.equal(knowledge?.canonical.stakes.length, 0);
    const graph = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: person!.entityId });
    assert.equal(graph?.edges.length, 0);
    const activity = await getActivityPage(prisma, { rootType: "DEAL", rootId: fixture.deal.id, filter: "DOCUMENTS" });
    assert.equal(activity?.events.some((event) => event.title === "Document review complete"), true);
    assert.equal(activity?.events.some((event) => event.title === "Entity left unresolved"), false);
  });

  test("the fictional CRE PDF travels through real extraction to REVIEWED", async () => {
    const deal = await createTestDeal(prisma);
    const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-cre-")));
    const received = await receiveNegotiationPdf({
      dealId: deal.id,
      bytes: creReviewTestPdf(),
      filename: "test-fictional-loi.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-15T00:00:00Z"),
      documentType: "LOI",
      storage,
      prisma,
      mode: "extract",
    });
    const page = await prisma.documentPage.findFirst({ where: { documentId: received.document.id } });
    assert.equal(page?.text, (await import("@/lib/documents/fixtures/creReviewFixture")).CRE_REVIEW_FIXTURE_TEXT);
    assert.equal(received.document.pageCount, 1);
    const analyzed = await analyzeNegotiationDocument({
      documentId: received.document.id,
      prisma,
      extractTerms: fixtureTerms(),
    });
    assert.equal(analyzed.document.ingestionStatus, "COMPLETE", analyzed.document.failureReason ?? "");
    const again = await analyzeNegotiationDocument({
      documentId: received.document.id,
      prisma,
      extractTerms: fixtureTerms(),
    });
    assert.equal(again.idempotent, true);
    assert.equal(await prisma.negotiationRound.count({ where: { documentId: received.document.id } }), 1);
    const graphExtractor: GraphModelExtractor = async () => ({
      extraction: CRE_REVIEW_GRAPH,
      model: "phase8f-fixture",
    });
    graphExtractor.model = "phase8f-fixture";
    const graph = await runDocumentGraphExtraction({
      prisma,
      documentId: received.document.id,
      extractor: graphExtractor,
    });
    assert.equal(graph?.status, "SUCCEEDED", JSON.stringify(graph?.rejections));
    assert.equal(graph?.entityCount, 5);
    assert.equal(graph?.relationshipCount, 3);
    const repeatedGraph = await runDocumentGraphExtraction({
      prisma,
      documentId: received.document.id,
      extractor: graphExtractor,
    });
    assert.equal(repeatedGraph?.idempotent, true);

    const observations = await prisma.entityObservation.findMany({ where: { documentId: received.document.id } });
    const byName = new Map(observations.map((row) => [row.surfaceForm, row]));
    for (const name of ["Sarah Chen", "Northwind Labs", "Harbor Brokerage", "500 Test Street"]) {
      const created = await createCanonicalEntityFromObservation(prisma, byName.get(name)!.id);
      assert.ok(created);
    }
    await leaveEntityUnresolved(prisma, {
      documentId: received.document.id,
      observationId: byName.get("Clarendon Holdings")!.id,
    });
    const relationships = await prisma.relationshipObservation.findMany({ where: { documentId: received.document.id } });
    const worksAt = relationships.find((row) => row.predicate === "WORKS_AT");
    const participation = relationships.find((row) => row.predicate === "PARTICIPATES_AS");
    const owns = relationships.find((row) => row.predicate === "OWNS");
    await approveRelationshipObservation(prisma, worksAt!.id);
    await approveRelationshipObservation(prisma, participation!.id);
    await acknowledgeBlockedRelationship(prisma, owns!.id);
    const terms = await prisma.negotiationTerm.findMany({ where: { round: { documentId: received.document.id } } });
    for (const term of terms) {
      await recordReviewDecision(prisma, {
        documentId: received.document.id,
        action: "ACKNOWLEDGE",
        target: { kind: "NEGOTIATION_TERM", negotiationTermId: term.id },
      });
    }
    const review = await getDocumentReview(prisma, workspaceId, received.document.id);
    assert.equal(review?.item.processingStatus, "REVIEWED");
    assert.equal(review?.findings.length, 4);
    assert.equal(review?.findings.some((finding) => finding.structuredDetails && finding.structuredDetails.length > 0), true);
    assert.equal(review?.completion.entitiesResolved, 4);
    assert.equal(review?.completion.entitiesLeftUnresolved, 1);
    assert.equal(review?.completion.relationshipsApproved, 2);
    assert.equal(review?.completion.relationshipsAcknowledgedBlocked, 1);

    const negotiation = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(negotiation?.terms.length, 4);
    const rent = negotiation?.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(rent?.status, "PROPOSED");
    const knowledge = await getDealKnowledge(prisma, deal.id);
    assert.equal(knowledge?.canonical.people.some((person) => person.name === "Sarah Chen"), true);
    assert.equal(knowledge?.canonical.employments.some((row) => row.companyName === "Harbor Brokerage"), true);
    assert.equal(knowledge?.canonical.participations.some((row) => row.role === "TENANT_BROKER"), true);
    assert.equal(knowledge?.canonical.stakes.some((row) => row.companyName === "Clarendon Holdings"), false);
    assert.equal(knowledge?.canonical.people.some((person) => person.name === "Clarendon Holdings"), false);
    const sarah = knowledge?.canonical.people.find((person) => person.name === "Sarah Chen");
    const map = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: sarah!.personId, depth: 2 });
    assert.equal(map?.edges.some((edge) => edge.label.toLowerCase().includes("own")), false);
    assert.ok((map?.edges.length ?? 0) > 0);
    const activity = await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id, filter: "ALL" });
    assert.equal(await prisma.documentMilestone.count({ where: { documentId: received.document.id, kind: "ANALYZED" } }), 1);
    assert.equal(activity?.events.some((event) => event.title === "Document analyzed"), false);
    assert.equal(activity?.events.some((event) => event.title === "Document review complete"), true);

    const needsReview = await getInbox(prisma, { workspaceId, dealId: deal.id, filter: "NEEDS_REVIEW" });
    assert.equal(needsReview.items.some((item) => item.document.id === received.document.id), false);

    const intelligence = await getDealIntelligence(prisma, deal.id);
    assert.equal(intelligence?.intelligenceStatus, "NEGOTIATING");
    assert.equal(intelligence?.deal.recordStatus, deal.status);
    assert.equal(intelligence?.health.reviewedDocumentCount, 1);
    assert.equal(intelligence?.health.reviewRequiredDocumentCount, 0);
    assert.equal(intelligence?.agreedTerms.length, 0);
    assert.equal(intelligence?.terms.find((term) => term.canonicalType === "BASE_RENT")?.status, "PROPOSED");
    assert.equal(intelligence?.team.tenantBrokers.some((party) => party.name === "Sarah Chen"), true);
    assert.equal(intelligence?.team.tenantBrokers.find((party) => party.name === "Sarah Chen")?.employers.some((employer) => employer.companyName === "Harbor Brokerage"), true);
    assert.equal(intelligence?.team.landlord.some((party) => party.name === "Clarendon Holdings"), false);
    assert.equal(intelligence?.reviewQueue.some((item) => item.kind === "ENTITY" || item.kind === "RELATIONSHIP"), false);
  });

  test("200 Clarendon development data is not repaired with invented source facts", async () => {
    const seed = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/seed.ts"),
      "utf8"
    );
    assert.match(seed, /Tenant LOI — Initial Proposal/);
    assert.match(seed, /Landlord Counter — Round 1/);
    assert.match(seed, /Tenant Counter — Round 2/);
    assert.match(seed, /Landlord Counter — Round 2/);
    const deal = await createTestDeal(prisma);
    const document = await prisma.document.create({
      data: {
        ...documentData(deal.id, "200 Clarendon LOI"),
        storageKey: "pending",
        negotiationSide: null,
        documentDate: null,
        ingestionStatus: "READY",
        sha256: "clarendon-placeholder",
      },
    });
    await prisma.documentPage.create({
      data: { documentId: document.id, pageNumber: 1, text: "Letter of intent for 200 Clarendon." },
    });
    await recordEntityObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: deal.id,
      documentId: document.id,
      observedType: "PROPERTY",
      surfaceForm: "200 Clarendon",
      evidenceQuote: "Letter of intent for 200 Clarendon.",
    });
    const review = await getDocumentReview(prisma, workspaceId, document.id);
    assert.equal(review?.item.sourceFileState, "MISSING");
    assert.equal(review?.findings.length, 0);
    assert.equal(review?.item.entityReviewSummary.found, 1);
    assert.ok(review?.readiness.missing.some((gap) => gap.label === "Authoring side"));
    assert.ok(review?.readiness.missing.some((gap) => gap.label === "Document date"));
    assert.equal(await prisma.negotiationTerm.count({ where: { round: { documentId: document.id } } }), 0);
  });

  test("development reset removes one document and keeps shared canonical records", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    await assert.rejects(
      () => resetDevelopmentDocument(prisma, "missing"),
      (error: unknown) => error instanceof DemoResetError && error.code === "PRODUCTION"
    );
    env.NODE_ENV = previous;
    const fixture = await scaffold("Reset");
    const created = await createCanonicalEntityFromObservation(prisma, fixture.person.id);
    const other = await prisma.document.create({ data: documentData(fixture.deal.id, "Shared.pdf") });
    await prisma.documentPage.create({ data: { documentId: other.id, pageNumber: 1, text: quote } });
    const sharedObservation = await recordEntityObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: fixture.deal.id,
      documentId: other.id,
      observedType: "PERSON",
      surfaceForm: "Sarah Chen",
      evidenceQuote: quote,
    });
    await prisma.entityResolutionLink.create({
      data: {
        workspaceId,
        entityObservationId: sharedObservation.id,
        personId: created!.entityId,
        method: "MANUAL",
        status: "ACCEPTED",
      },
    });
    const report = await resetDevelopmentDocument(prisma, fixture.document.id);
    assert.equal(report.removed, true);
    assert.equal(await prisma.document.findUnique({ where: { id: fixture.document.id } }), null);
    assert.ok(report.retained.some((row) => row.kind === "Person" && row.id === created?.entityId));
    assert.equal(await prisma.person.findUnique({ where: { id: created!.entityId } }) !== null, true);
    assert.equal(await prisma.document.findUnique({ where: { id: other.id } }) !== null, true);
  });
});

function wait() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function negotiationSnapshot(workspace: Awaited<ReturnType<typeof getNegotiationWorkspace>>) {
  return (workspace?.terms ?? []).map((term) => ({
    canonicalType: term.canonicalType,
    status: term.status,
    structuredState: term.structuredState,
    tenant: term.tenantPosition?.kind ?? null,
    landlord: term.landlordPosition?.kind ?? null,
  }));
}

async function resolvedPersonId(observationId: string) {
  const link = await prisma.entityResolutionLink.findFirstOrThrow({
    where: { entityObservationId: observationId, status: "ACCEPTED" },
    select: { personId: true },
  });
  return link.personId!;
}

async function scaffold(name: string) {
  const deal = await createTestDeal(prisma);
  const document = await prisma.document.create({ data: documentData(deal.id, `${name}.pdf`) });
  const page = await prisma.documentPage.create({
    data: { documentId: document.id, pageNumber: 1, text: quote },
  });
  const round = await prisma.negotiationRound.create({
    data: {
      dealId: deal.id,
      side: "LANDLORD",
      roundNumber: 1,
      documentName: `${name}.pdf`,
      documentText: quote,
      documentDate: new Date("2026-09-01T00:00:00Z"),
      sourceType: "PDF",
      documentId: document.id,
    },
  });
  const term = await prisma.negotiationTerm.create({
    data: {
      roundId: round.id,
      canonicalType: "BASE_RENT",
      normalizedValue: "$65.00/RSF/year",
      normalizedNumeric: 65,
      normalizedUnit: "USD_PER_RSF_YEAR",
      rawValue: quote,
      status: "PROPOSED",
      side: "LANDLORD",
      roundNumber: 1,
      confidence: 1,
      evidenceQuote: quote,
      sourceLocation: "Rent",
      provenanceStatus: "EXACT",
      documentPageId: page.id,
      evidenceStartOffset: 0,
      evidenceEndOffset: quote.length,
      structuredPayload: {
        termType: "BASE_RENT",
        rent: { kind: "simple", amountPerRSFYear: 65, rentStructure: "NNN" },
        inlineEscalation: null,
      },
    },
  });
  const person = await recordEntityObservation(prisma, {
    ...extractor,
    workspaceId,
    sourceKind: "DOCUMENT_PAGE",
    dealId: deal.id,
    documentId: document.id,
    observedType: "PERSON",
    surfaceForm: `${name} Person`,
    evidenceQuote: quote,
  });
  const company = await recordEntityObservation(prisma, {
    ...extractor,
    workspaceId,
    sourceKind: "DOCUMENT_PAGE",
    dealId: deal.id,
    documentId: document.id,
    observedType: "COMPANY",
    surfaceForm: `${name} Company`,
    evidenceQuote: quote,
  });
  const relationship = await recordRelationshipObservation(prisma, {
    ...extractor,
    workspaceId,
    sourceKind: "DOCUMENT_PAGE",
    dealId: deal.id,
    documentId: document.id,
    predicate: "WORKS_AT",
    subjectObservationId: person.id,
    objectObservationId: company.id,
    affiliationKind: "BROKER",
    evidenceQuote: quote,
  });
  return { deal, document, term, person, company, relationship };
}

function documentData(dealId: string, originalFilename: string) {
  return {
    dealId,
    filename: `${originalFilename}-${Math.random().toString(16).slice(2)}`,
    originalFilename,
    mimeType: "application/pdf",
    sizeBytes: 120,
    sha256: `sha-${Math.random().toString(16).slice(2)}`,
    documentType: "LOI" as const,
    documentDate: new Date("2026-09-01T00:00:00Z"),
    negotiationSide: "LANDLORD" as const,
    ingestionStatus: "COMPLETE" as const,
    graphExtractionStatus: "SUCCEEDED" as const,
    storageKey: `pending-${Math.random().toString(16).slice(2)}`,
    pageCount: 1,
  };
}

function fixtureTerms(): NegotiationTermExtractor {
  return async () => ({
    terms: [
      term("BASE_RENT", CRE_REVIEW_QUOTES.baseRent, "$72.00/RSF/year", 72, "USD_PER_RSF_YEAR", {
        termType: "BASE_RENT",
        rent: { kind: "simple", amountPerRSFYear: 72, rentStructure: "NNN" },
      }),
      term("TI_ALLOWANCE", CRE_REVIEW_QUOTES.ti, "$85.00/RSF", 85, "USD_PER_RSF_YEAR", {
        termType: "TI_ALLOWANCE",
        amount: { amount: 85, unit: "USD_PER_RSF_YEAR" },
        conditions: [],
        drawDeadline: null,
        unusedConversion: null,
      }),
      term("FREE_RENT", CRE_REVIEW_QUOTES.freeRent, "3 months", 3, "MONTHS", {
        termType: "FREE_RENT",
        abatement: { kind: "contiguous", months: 3, abatementType: "FULL" },
        scope: "BASE_RENT_ONLY",
      }),
      term("LEASE_TERM", CRE_REVIEW_QUOTES.leaseTerm, "7 years", 7, "YEARS", null),
    ],
    metadata: {
      model: "phase8f-fixture",
      extractedAt: "2026-09-28T00:00:00.000Z",
      latencyMs: 1,
      extractionConfidence: 1,
      validationFailures: 0,
    },
  }) as Awaited<ReturnType<NegotiationTermExtractor>>;
}

function term(
  canonicalType: string,
  evidenceQuote: string,
  normalizedValue: string,
  normalizedNumeric: number,
  normalizedUnit: string,
  structuredPayload: Record<string, unknown> | null
) {
  return {
    canonicalType,
    normalizedValue,
    normalizedNumeric,
    normalizedUnit,
    rawValue: evidenceQuote,
    status: "PROPOSED" as const,
    confidence: 1,
    evidenceQuote,
    sourceLocation: canonicalType,
    ...(structuredPayload ? { structuredPayload } : {}),
  };
}
