import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { NegotiationExtractionError } from "@/lib/ai/negotiation/extractTerms";
import type { NegotiationTermExtractor } from "@/lib/documents/ingestNegotiationPdf";
import { analyzeNegotiationDocument, ingestNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase } from "@/lib/documents/testDb";
import {
  createPerson,
  createWorkspace,
  deleteDocumentPreservingEvidence,
  recordEntityObservation,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getActivityPage } from "@/lib/activity/service";
import { getConnectionGraph } from "@/lib/graph/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import {
  approveRelationshipObservation,
  createCanonicalEntityFromObservation,
  getDealKnowledge,
  listDocumentRelationshipPromotions,
} from "@/lib/promotion/service";
import { acceptResolutionCandidate } from "@/lib/resolution/service";
import { InboxQueryError, parseInboxQuery } from "./query";
import { getDocumentReview, getInbox } from "./service";
import { deriveInboxStatus } from "./status";
import { emptyReviewWork } from "@/lib/review/completion";
import type { InboxItem } from "./types";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let workspaceId = "";
let sequence = 0;

const extractor = { extractor: "deterministic-test", extractorVersion: "phase8d-test" };

describe("Phase 8D deal inbox", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    workspaceId = (await ensureDefaultWorkspace(prisma)).id;
  });

  test.after(async () => cleanup());

  test("A empty inbox", async () => {
    const empty = await createWorkspace(prisma, { name: `Empty ${++sequence}` });
    const page = await getInbox(prisma, { workspaceId: empty.id });
    assert.equal(page.items.length, 0);
    assert.equal(page.counts.ALL, 0);
    assert.equal(page.counts.NEEDS_REVIEW, 0);
    const open = emptyReviewWork();
    open.entitiesTotal = 1;
    assert.deepEqual(
      deriveInboxStatus({
        ingestionStatus: "COMPLETE",
        graphExtractionStatus: "NOT_RUN",
        fileReady: false,
        metadataReady: true,
        analysisReady: false,
        work: open,
        reviewReasons: ["UNRESOLVED_ENTITIES"],
      }),
      { processingStatus: "REVIEW_REQUIRED", requiresReview: true }
    );
    assert.deepEqual(
      deriveInboxStatus({
        ingestionStatus: "READY",
        graphExtractionStatus: "NOT_RUN",
        fileReady: true,
        metadataReady: true,
        analysisReady: true,
        work: emptyReviewWork(),
        reviewReasons: [],
      }),
      { processingStatus: "READY_TO_ANALYZE", requiresReview: false }
    );
  });

  test("B/C/D/E processing states and pasted rounds stay off the inbox", async () => {
    const deal = await dealNamed("States");
    await prisma.negotiationRound.create({
      data: {
        dealId: deal.id,
        side: "LANDLORD",
        roundNumber: 1,
        documentName: "Pasted landlord proposal",
        documentText: "legacy paste",
        documentDate: new Date("2026-01-01T00:00:00Z"),
        sourceType: "PASTED_TEXT",
        terms: {
          create: [term("BASE_RENT", 69, "PROPOSED", "LANDLORD", 1, "$69.00 per rentable square foot")],
        },
      },
    });
    const uploaded = await documentOn(deal.id, { originalFilename: "Uploaded.pdf", ingestionStatus: "UPLOADED" });
    const processing = await documentOn(deal.id, { originalFilename: "Processing.pdf", ingestionStatus: "ANALYZING" });
    const complete = await documentOn(deal.id, { originalFilename: "Complete.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const failed = await documentOn(deal.id, {
      originalFilename: "Scanned.pdf",
      ingestionStatus: "FAILED",
      failureCode: "SCANNED_OR_EMPTY",
      failureReason: "This PDF has no usable embedded text. Scanned documents are not supported.",
    });
    const page = await getInbox(prisma, { workspaceId, dealId: deal.id });
    const byName = new Map(page.items.map((item) => [item.document.originalFilename, item]));
    assert.equal(byName.get("Uploaded.pdf")?.processingStatus, "NOT_READY");
    assert.equal(byName.get("Processing.pdf")?.processingStatus, "ANALYZING");
    assert.equal(byName.get("Complete.pdf")?.processingStatus, "REVIEWED");
    assert.equal(byName.get("Complete.pdf")?.requiresReview, false);
    assert.equal(byName.get("Scanned.pdf")?.processingStatus, "FAILED");
    assert.equal(byName.get("Scanned.pdf")?.canRetry, false);
    assert.match(byName.get("Scanned.pdf")?.document.failureReason ?? "", /no usable embedded text/);
    assert.equal(page.items.some((item) => item.document.originalFilename.includes("Pasted")), false);
    assert.ok(uploaded.id);
    assert.ok(processing.id);
    assert.ok(complete.id);
    assert.ok(failed.id);
  });

  test("F/G/H/I/J/K review reasons distinguish negotiation, entity, and relationship documents", async () => {
    const deal = await dealNamed("Kinds");
    const negotiation = await documentOn(deal.id, { originalFilename: "NegotiationOnly.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED", negotiationSide: "LANDLORD" });
    await roundOn(deal.id, negotiation.id, "LANDLORD", 1, "2026-02-01", [term("BASE_RENT", 70, "PROPOSED", "LANDLORD", 1, "Base rent evidence")]);
    const entity = await documentOn(deal.id, { originalFilename: "EntityOnly.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    await observeEntity(deal, entity.id, "Ada Broker", "PERSON", "Ada Broker appears once");
    const relationship = await documentOn(deal.id, { originalFilename: "RelationshipOnly.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const person = await observeEntity(deal, relationship.id, "Riley Broker", "PERSON", "Riley Broker appears once");
    const company = await observeEntity(deal, relationship.id, "Cycle Co", "COMPANY", "Cycle Co appears once");
    await createCanonicalEntityFromObservation(prisma, person.id);
    await createCanonicalEntityFromObservation(prisma, company.id);
    await recordRelationshipObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: deal.id,
      documentId: relationship.id,
      predicate: "WORKS_AT",
      subjectObservationId: person.id,
      objectObservationId: company.id,
      evidenceQuote: "Riley Broker appears once",
    });
    const mixed = await documentOn(deal.id, { originalFilename: "Mixed.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED", negotiationSide: "TENANT" });
    await roundOn(deal.id, mixed.id, "TENANT", 2, "2026-03-01", [
      term("TI_ALLOWANCE", 95, "PROPOSED", "TENANT", 2, "TI evidence one"),
      term("TI_ALLOWANCE", 105, "PROPOSED", "TENANT", 2, "TI evidence two", { normalizedValue: "$105 / RSF" }),
    ]);
    await observeEntity(deal, mixed.id, "Mixed Person", "PERSON", "Mixed person evidence");

    const page = await getInbox(prisma, { workspaceId, dealId: deal.id });
    const negotiationItem = find(page.items, "NegotiationOnly.pdf");
    assert.equal(negotiationItem.processingStatus, "REVIEW_REQUIRED");
    assert.equal(negotiationItem.negotiationSummary.termCount, 1);
    assert.equal(negotiationItem.negotiationSummary.newCount, 1);
    assert.equal(negotiationItem.entityReviewSummary.found, 0);
    const entityItem = find(page.items, "EntityOnly.pdf");
    assert.equal(entityItem.requiresReview, true);
    assert.equal(entityItem.entityReviewSummary.unresolved, 1);
    assert.equal(entityItem.negotiationSummary.termCount, 0);
    assert.ok(entityItem.reviewReasons.includes("UNRESOLVED_ENTITIES"));
    const relationshipItem = find(page.items, "RelationshipOnly.pdf");
    assert.equal(relationshipItem.relationshipReviewSummary.ready, 1);
    assert.equal(relationshipItem.relationshipReviewSummary.blocked, 0);
    assert.equal(relationshipItem.entityReviewSummary.unresolved, 0);
    assert.ok(relationshipItem.reviewReasons.includes("UNRESOLVED_RELATIONSHIPS"));
    const mixedItem = find(page.items, "Mixed.pdf");
    assert.equal(mixedItem.negotiationSummary.conflictCount, 1);
    assert.equal(mixedItem.entityReviewSummary.unresolved, 1);
    assert.ok(mixedItem.reviewReasons.includes("NEGOTIATION_CONFLICT"));
  });

  test("L/M/N/O change, unresolved, blocked, and approved counts", async () => {
    const deal = await dealNamed("Counts");
    const prior = await documentOn(deal.id, { originalFilename: "Prior.pdf", ingestionStatus: "COMPLETE", negotiationSide: "LANDLORD", documentDate: new Date("2026-04-01T00:00:00Z") });
    await roundOn(deal.id, prior.id, "LANDLORD", 1, "2026-04-01", [term("BASE_RENT", 69, "PROPOSED", "LANDLORD", 1, "Prior rent")]);
    const current = await documentOn(deal.id, { originalFilename: "Current.pdf", ingestionStatus: "COMPLETE", negotiationSide: "LANDLORD", documentDate: new Date("2026-05-01T00:00:00Z") });
    await roundOn(deal.id, current.id, "LANDLORD", 2, "2026-05-01", [term("BASE_RENT", 67, "PROPOSED", "LANDLORD", 2, "Current rent")]);
    const later = await documentOn(deal.id, { originalFilename: "Later.pdf", ingestionStatus: "COMPLETE", negotiationSide: "LANDLORD", documentDate: new Date("2026-06-01T00:00:00Z") });
    await roundOn(deal.id, later.id, "LANDLORD", 3, "2026-06-01", [term("BASE_RENT", 60, "PROPOSED", "LANDLORD", 3, "Later rent")]);
    const blockedDoc = await documentOn(deal.id, { originalFilename: "Blocked.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const person = await observeEntity(deal, blockedDoc.id, "Sarah Chen", "PERSON", "Sarah Chen, Senior Vice President");
    const company = await observeEntity(deal, blockedDoc.id, "JLL Boston", "COMPANY", "JLL Boston brokerage");
    await recordRelationshipObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: deal.id,
      documentId: blockedDoc.id,
      predicate: "WORKS_AT",
      subjectObservationId: person.id,
      objectObservationId: company.id,
      evidenceQuote: "Sarah Chen, Senior Vice President",
    });

    const before = find((await getInbox(prisma, { workspaceId, dealId: deal.id })).items, "Current.pdf");
    assert.equal(before.negotiationSummary.changedCount, 1);
    assert.equal(before.negotiationSummary.agreedCount, 0);
    const review = await getDocumentReview(prisma, workspaceId, current.id);
    assert.ok(review);
    assert.equal(review.findings.length, 1);
    assert.match(review.findings[0]!.impactLabel, /69/);
    assert.match(review.findings[0]!.impactLabel, /67/);
    assert.equal(review.findings[0]!.impactLabel.includes("60"), false);
    const blocked = find((await getInbox(prisma, { workspaceId, dealId: deal.id })).items, "Blocked.pdf");
    assert.equal(blocked.entityReviewSummary.unresolved, 2);
    assert.equal(blocked.relationshipReviewSummary.blocked, 1);
    assert.equal(blocked.relationshipReviewSummary.approved, 0);

    await createCanonicalEntityFromObservation(prisma, person.id);
    await createCanonicalEntityFromObservation(prisma, company.id);
    const ready = await getDocumentReview(prisma, workspaceId, blockedDoc.id);
    assert.equal(ready?.item.relationshipReviewSummary.ready, 1);
    assert.equal(ready?.item.relationshipReviewSummary.approved, 0);
    assert.equal(ready?.item.entityReviewSummary.unresolved, 0);
    const previews = await listDocumentRelationshipPromotions(prisma, blockedDoc.id);
    assert.equal(previews?.[0]?.status, "PENDING");
    assert.equal(previews?.[0]?.canApprove, true);
    await approveRelationshipObservation(prisma, previews![0]!.relationshipObservationId, "Confirmed");
    const approved = await getDocumentReview(prisma, workspaceId, blockedDoc.id);
    assert.equal(approved?.item.relationshipReviewSummary.approved, 1);
    assert.equal(approved?.item.requiresReview, false);
  });

  test("structured payload and legacy flat term both render stored values", async () => {
    const deal = await dealNamed("Payload");
    const document = await documentOn(deal.id, { originalFilename: "Structured.pdf", ingestionStatus: "COMPLETE", negotiationSide: "LANDLORD" });
    await roundOn(deal.id, document.id, "LANDLORD", 1, "2026-07-01", [
      term("BASE_RENT", 67, "PROPOSED", "LANDLORD", 1, "$67.00 per rentable square foot", {
        structuredPayload: { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: 67 } },
      }),
      term("LEASE_TERM", null, "PROPOSED", "LANDLORD", 1, "Ten year term", {
        normalizedValue: "10 years",
        normalizedUnit: null,
        canonicalType: "LEASE_TERM",
      }),
    ]);
    const review = await getDocumentReview(prisma, workspaceId, document.id);
    const rent = review?.findings.find((finding) => finding.canonicalType === "BASE_RENT");
    const lease = review?.findings.find((finding) => finding.canonicalType === "LEASE_TERM");
    assert.ok(rent?.structuredDetails?.some((detail) => detail.value.includes("67")));
    assert.equal(lease?.structuredDetails, null);
    assert.equal(lease?.formattedValue, "10 years");
  });

  test("P/Q/R exact, ambiguous, and unlocated provenance stay truthful", async () => {
    const deal = await dealNamed("Evidence");
    const document = await documentOn(deal.id, { originalFilename: "Evidence.pdf", ingestionStatus: "COMPLETE", pageCount: 2 });
    const pageOne = await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 1, text: "Shared quote lives here. Exact quote lives here." } });
    await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 2, text: "Shared quote lives here." } });
    await observeEntity(deal, document.id, "Exact Co", "COMPANY", "Exact quote lives here");
    await observeEntity(deal, document.id, "Ambiguous Co", "COMPANY", "Shared quote lives here");
    await observeEntity(deal, document.id, "Missing Co", "COMPANY", "This quote is not on a page", { append: false });
    await roundOn(deal.id, document.id, "TENANT", 1, "2026-08-01", [
      term("PARKING", 4, "PROPOSED", "TENANT", 1, "Exact quote lives here", {
        provenanceStatus: "EXACT",
        documentPageId: pageOne.id,
        normalizedUnit: "SPACES",
      }),
    ]);
    const review = await getDocumentReview(prisma, workspaceId, document.id);
    assert.ok(review);
    const exact = review.evidence.find((record) => record.label === "Exact Co");
    const ambiguous = review.evidence.find((record) => record.label === "Ambiguous Co");
    const missing = review.evidence.find((record) => record.label === "Missing Co");
    const parking = review.evidence.find((record) => record.kind === "TERM");
    assert.equal(exact?.provenanceStatus, "EXACT");
    assert.equal(exact?.pageNumber, 1);
    assert.equal(exact?.href, null);
    assert.equal(ambiguous?.provenanceStatus, "AMBIGUOUS");
    assert.equal(ambiguous?.pageNumber, null);
    assert.equal(ambiguous?.href, null);
    assert.equal(missing?.provenanceStatus, "UNLOCATED");
    assert.equal(missing?.pageNumber, null);
    assert.equal(parking?.provenanceStatus, "EXACT");
    assert.ok(review.item.reviewReasons.includes("AMBIGUOUS_PROVENANCE"));
    assert.ok(review.item.reviewReasons.includes("UNLOCATED_PROVENANCE"));
  });

  test("S workspace isolation", async () => {
    const other = await createWorkspace(prisma, { name: `Other ${++sequence}` });
    const deal = await prisma.deal.create({
      data: { workspaceId: other.id, name: "Hidden deal", company: "Hidden Co", property: "Hidden Tower", stage: "LOI", status: "ACTIVE" },
    });
    const document = await documentOn(deal.id, { originalFilename: "Hidden.pdf", ingestionStatus: "COMPLETE" });
    const inbox = await getInbox(prisma, { workspaceId });
    assert.equal(inbox.items.some((item) => item.document.id === document.id), false);
    assert.equal(await getDocumentReview(prisma, workspaceId, document.id), null);
    const visible = await getInbox(prisma, { workspaceId: other.id });
    assert.equal(visible.items.length, 1);
  });

  test("T/U search and filters", async () => {
    const alpha = await dealNamed("Filter Alpha", { company: "SearchCo", property: "Search Tower" });
    const beta = await dealNamed("Filter Beta");
    await documentOn(alpha.id, { originalFilename: "UniqueLease.pdf", documentType: "LOI", negotiationSide: "TENANT", ingestionStatus: "COMPLETE" });
    await documentOn(beta.id, { originalFilename: "LandlordCounter.pdf", documentType: "COUNTERPROPOSAL", negotiationSide: "LANDLORD", ingestionStatus: "FAILED", failureCode: "ANALYSIS_FAILED", failureReason: "Negotiation analysis failed." });
    const byName = await getInbox(prisma, { workspaceId, q: "UniqueLease" });
    assert.equal(byName.items.length, 1);
    const byCompany = await getInbox(prisma, { workspaceId, q: "searchco" });
    assert.ok(byCompany.items.every((item) => item.deal.company === "SearchCo"));
    const byProperty = await getInbox(prisma, { workspaceId, q: "search tower" });
    assert.equal(byProperty.items.length, 1);
    const loi = await getInbox(prisma, { workspaceId, documentType: "LOI", dealId: alpha.id });
    assert.ok(loi.items.every((item) => item.document.documentType === "LOI"));
    const landlord = await getInbox(prisma, { workspaceId, negotiationSide: "LANDLORD", dealId: beta.id });
    assert.equal(landlord.items.length, 1);
    const failed = await getInbox(prisma, { workspaceId, filter: "FAILED", dealId: beta.id });
    assert.equal(failed.items.length, 1);
    assert.equal(failed.items[0]?.canRetry, true);
    assert.throws(() => parseInboxQuery(new URLSearchParams("workspaceId=other")), InboxQueryError);
    const dealPage = await getInbox(prisma, { workspaceId, scopeDealId: alpha.id });
    assert.ok(dealPage.items.every((item) => item.deal.id === alpha.id));
  });

  test("V duplicate document", async () => {
    const left = await dealNamed("Dup Left");
    const right = await dealNamed("Dup Right");
    const sha = `same-file-${sequence}`;
    const first = await documentOn(left.id, { sha256: sha, originalFilename: "Same.pdf" });
    const second = await documentOn(right.id, { sha256: sha, originalFilename: "Same.pdf" });
    const review = await getDocumentReview(prisma, workspaceId, first.id);
    assert.deepEqual(review?.item.document.duplicateDocumentIds, [second.id]);
  });

  test("W/X retry stays idempotent and does not duplicate a round", async () => {
    const deal = await dealNamed("Retry");
    const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-inbox-")));
    const calls: string[] = [];
    let fail = true;
    const extractTerms: NegotiationTermExtractor = async (input) => {
      calls.push(input.documentText);
      if (fail) throw new NegotiationExtractionError("mock analysis failure");
      return {
        terms: [{
          canonicalType: "BASE_RENT",
          normalizedValue: "$65.00/RSF/year",
          normalizedNumeric: 65,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: "$65.00 per rentable square foot.",
          status: "PROPOSED",
          confidence: 1,
          evidenceQuote: "Base Rent shall be $65.00 per rentable square foot.",
          sourceLocation: "Rent",
        }],
        metadata: { model: "mock", extractedAt: new Date().toISOString(), latencyMs: 1, extractionConfidence: 1, validationFailures: 0 },
      };
    };
    const quote = "Base Rent shall be $65.00 per rentable square foot.";
    const failed = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: buildTextPdf([quote]),
      filename: "retry.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-01"),
      documentType: "LOI",
      storage,
      prisma,
      extractGraph: null,
      extractTerms,
    });
    const failedItem = await getDocumentReview(prisma, workspaceId, failed.document.id);
    assert.equal(failedItem?.item.processingStatus, "FAILED");
    assert.equal(failedItem?.item.canRetry, true);
    assert.equal(await prisma.negotiationRound.count({ where: { documentId: failed.document.id } }), 0);
    fail = false;
    const recovered = await analyzeNegotiationDocument({ documentId: failed.document.id, prisma, extractTerms });
    const again = await analyzeNegotiationDocument({ documentId: failed.document.id, prisma, extractTerms });
    assert.equal(recovered.document.ingestionStatus, "COMPLETE");
    assert.equal(again.idempotent, true);
    assert.equal(await prisma.negotiationRound.count({ where: { documentId: failed.document.id } }), 1);
    assert.equal(calls.length, 2);
  });

  test("Y/Z reads perform no model calls and no canonical writes", async () => {
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "service.ts"), "utf8");
    assert.equal(/\b(extractTerms|extractCREGraph|openai)\b/.test(source), false);
    const deal = await dealNamed("Read only");
    const document = await documentOn(deal.id, { originalFilename: "ReadOnly.pdf", ingestionStatus: "COMPLETE" });
    const guarded = guardReads(prisma);
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetches += 1;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await getInbox(guarded, { workspaceId, dealId: deal.id });
      await getDocumentReview(guarded, workspaceId, document.id);
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(fetches, 0);
  });

  test("accepting a candidate resolves an entity without approving relationships automatically", async () => {
    const deal = await dealNamed("Accept");
    const document = await documentOn(deal.id, { originalFilename: "Accept.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" });
    const observation = await observeEntity(deal, document.id, "Pat Lee", "PERSON", "Pat Lee is named once");
    const person = await createPerson(prisma, { workspaceId, canonicalName: "Pat Lee" });
    const candidate = await prisma.entityResolutionCandidate.create({
      data: {
        workspaceId,
        entityObservationId: observation.id,
        candidatePersonId: person.id,
        score: 0.91,
        features: {},
        positiveReasons: ["Exact name"],
        negativeReasons: [],
        temporalNotes: [],
      },
    });
    await acceptResolutionCandidate(prisma, candidate.id, "Same person");
    const review = await getDocumentReview(prisma, workspaceId, document.id);
    assert.equal(review?.item.entityReviewSummary.resolved, 1);
    assert.equal(review?.item.entityReviewSummary.unresolved, 0);
    assert.equal(review?.item.relationshipReviewSummary.approved, 0);
  });

  test("the graph deletion guard remains while no deletion state is exposed, and deal documents reuse the inbox", async () => {
    const deal = await dealNamed("Delete");
    const document = await documentOn(deal.id, { originalFilename: "Keep.pdf", ingestionStatus: "COMPLETE" });
    await observeEntity(deal, document.id, "Keep Co", "COMPANY", "Keep Co is named");
    const review = await getDocumentReview(prisma, workspaceId, document.id);
    assert.ok(review);
    assert.equal("deletionBlocked" in review, false);
    await assert.rejects(() => deleteDocumentPreservingEvidence(prisma, document.id), /cannot be deleted/);
    const bare = await documentOn(deal.id, { originalFilename: "Bare.pdf", ingestionStatus: "UPLOADED" });
    const scoped = await getInbox(prisma, { workspaceId, scopeDealId: deal.id });
    assert.equal(scoped.items.some((item) => item.document.id === document.id), true);
    assert.equal(scoped.items.some((item) => item.document.id === bare.id), true);
    assert.ok(scoped.items.every((item) => item.deal.id === deal.id));
  });

  test("activity, negotiation, knowledge, and connection map still read stored records", async () => {
    const deal = await dealNamed("Regression");
    const document = await documentOn(deal.id, {
      originalFilename: "Regression.pdf",
      ingestionStatus: "COMPLETE",
      graphExtractionStatus: "SUCCEEDED",
      negotiationSide: "LANDLORD",
      documentDate: new Date("2026-09-26T00:00:00Z"),
    });
    await roundOn(deal.id, document.id, "LANDLORD", 1, "2026-09-26", [term("BASE_RENT", 67, "PROPOSED", "LANDLORD", 1, "Regression rent")]);
    const personObservation = await observeEntity(deal, document.id, "Reg Person", "PERSON", "Reg Person evidence");
    const companyObservation = await observeEntity(deal, document.id, "Reg Company", "COMPANY", "Reg Company evidence");
    const person = await createCanonicalEntityFromObservation(prisma, personObservation.id);
    const company = await createCanonicalEntityFromObservation(prisma, companyObservation.id);
    const relationship = await recordRelationshipObservation(prisma, {
      ...extractor,
      workspaceId,
      sourceKind: "DOCUMENT_PAGE",
      dealId: deal.id,
      documentId: document.id,
      predicate: "WORKS_AT",
      subjectObservationId: personObservation.id,
      objectObservationId: companyObservation.id,
      evidenceQuote: "Reg Person evidence",
    });
    await approveRelationshipObservation(prisma, relationship.id);
    const [activity, negotiation, knowledge, connections] = await Promise.all([
      getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id, limit: 20 }),
      getNegotiationWorkspace(prisma, deal.id),
      getDealKnowledge(prisma, deal.id),
      getConnectionGraph(prisma, { rootType: "PERSON", rootId: person!.entityId, depth: 1 }),
    ]);
    assert.ok(activity?.events.some((event) => event.eventType.startsWith("NEGOTIATION_")));
    assert.equal(negotiation?.documents.find((item) => item.id === document.id)?.reviewHref, `/documents/${document.id}/review`);
    assert.ok(knowledge?.canonical.employments.some((employment) => employment.companyId === company!.entityId));
    assert.ok(connections && connections.nodes.length > 0);
  });

  test("inbox queries stay batched", async () => {
    const deal = await dealNamed("Batch");
    await documentOn(deal.id, { originalFilename: "One.pdf", ingestionStatus: "COMPLETE" });
    await documentOn(deal.id, { originalFilename: "Two.pdf", ingestionStatus: "COMPLETE" });
    await documentOn(deal.id, { originalFilename: "Three.pdf", ingestionStatus: "COMPLETE" });
    const counter = countQueries(prisma);
    await getInbox(counter.prisma, { workspaceId, dealId: deal.id });
    assert.ok(counter.queries <= 8, `expected a batched read, saw ${counter.queries} queries`);
  });
});

function find(items: InboxItem[], filename: string): InboxItem {
  const item = items.find((entry) => entry.document.originalFilename === filename);
  assert.ok(item, filename);
  return item;
}

async function dealNamed(name: string, extra?: { company?: string; property?: string }) {
  return prisma.deal.create({
    data: {
      workspaceId,
      name: `${name} ${++sequence}`,
      company: extra?.company ?? "Acme Corp",
      property: extra?.property ?? "200 Clarendon",
      stage: "Negotiation",
      status: "ACTIVE",
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
    documentType: "LOI" | "PROPOSAL" | "COUNTERPROPOSAL" | "TERM_SHEET" | "AMENDMENT" | "RENEWAL_PROPOSAL" | "OTHER";
    documentDate: Date | null;
    sha256: string;
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
      sha256: overrides.sha256 ?? `sha-${id}`,
      documentType: overrides.documentType ?? "LOI",
      documentDate: overrides.documentDate === undefined ? new Date("2026-09-26T00:00:00Z") : overrides.documentDate,
      negotiationSide: overrides.negotiationSide === undefined ? "TENANT" : overrides.negotiationSide,
      ingestionStatus: overrides.ingestionStatus ?? "COMPLETE",
      graphExtractionStatus: overrides.graphExtractionStatus ?? "NOT_RUN",
      failureCode: overrides.failureCode ?? null,
      failureReason: overrides.failureReason ?? null,
      storageKey: `pending-${id}`,
      pageCount: overrides.pageCount ?? 1,
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
  documentId: string,
  side: "TENANT" | "LANDLORD",
  roundNumber: number,
  date: string,
  terms: ReturnType<typeof term>[]
) {
  return prisma.negotiationRound.create({
    data: {
      dealId,
      side,
      roundNumber,
      documentName: `Round ${roundNumber}`,
      documentText: "",
      documentDate: new Date(`${date}T00:00:00Z`),
      sourceType: "PDF_UPLOAD",
      documentId,
      terms: { create: terms },
    },
  });
}

async function observeEntity(
  deal: { id: string },
  documentId: string,
  surfaceForm: string,
  observedType: "PERSON" | "COMPANY",
  evidenceQuote: string,
  options?: { append?: boolean }
) {
  const append = options?.append !== false;
  const page = await prisma.documentPage.findFirst({ where: { documentId, pageNumber: 1 } });
  if (!page) {
    await prisma.documentPage.create({
      data: { documentId, pageNumber: 1, text: append ? evidenceQuote : "Unrelated page text." },
    });
  } else if (append && !page.text.includes(evidenceQuote)) {
    await prisma.documentPage.update({
      where: { id: page.id },
      data: { text: `${page.text}\n${evidenceQuote}` },
    });
  }
  return recordEntityObservation(prisma, {
    ...extractor,
    workspaceId,
    sourceKind: "DOCUMENT_PAGE",
    dealId: deal.id,
    documentId,
    observedType,
    surfaceForm,
    evidenceQuote,
  });
}

function guardReads(client: PrismaClient): PrismaClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop.startsWith("$")) {
        if (prop === "$transaction") return () => { throw new Error("unexpected transaction during read"); };
        return Reflect.get(target, prop, receiver);
      }
      const model = Reflect.get(target, prop, receiver);
      if (typeof model !== "object" || model === null) return model;
      return new Proxy(model, {
        get(modelTarget, method, modelReceiver) {
          if (typeof method === "string" && /^(create|update|delete|upsert)/.test(method)) {
            return () => { throw new Error(`canonical write ${String(prop)}.${method}`); };
          }
          const fn = Reflect.get(modelTarget, method, modelReceiver);
          return typeof fn === "function" ? fn.bind(modelTarget) : fn;
        },
      });
    },
  }) as PrismaClient;
}

function countQueries(client: PrismaClient): { prisma: PrismaClient; queries: number } {
  const state = { queries: 0 };
  const wrapped = new Proxy(client, {
    get(target, prop, receiver) {
      const model = Reflect.get(target, prop, receiver);
      if (typeof model !== "object" || model === null || typeof prop === "symbol" || prop.startsWith("$")) return model;
      return new Proxy(model, {
        get(modelTarget, method, modelReceiver) {
          const fn = Reflect.get(modelTarget, method, modelReceiver);
          if (typeof method === "string" && (method.startsWith("find") || method === "count") && typeof fn === "function") {
            return (...args: unknown[]) => {
              state.queries += 1;
              return fn.apply(modelTarget, args);
            };
          }
          return typeof fn === "function" ? fn.bind(modelTarget) : fn;
        },
      });
    },
  }) as PrismaClient;
  return { prisma: wrapped, get queries() { return state.queries; } };
}
