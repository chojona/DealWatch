import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { NegotiationExtractionError } from "@/lib/ai/negotiation/extractTerms";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { deriveReadiness } from "@/lib/documents/readiness";
import { replaceDevelopmentSourceFile, SourceReplacementError } from "@/lib/documents/replaceSource";
import { updateDocumentMetadata } from "@/lib/documents/metadata";
import { analyzeNegotiationDocument, type NegotiationTermExtractor } from "@/lib/documents/ingestNegotiationPdf";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { LocalDocumentStorage, getDocumentStorage } from "@/lib/documents/storage";
import { receiveNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { getActivityPage } from "@/lib/activity/service";
import { getConnectionGraph } from "@/lib/graph/service";
import { getInbox, getDocumentReview } from "@/lib/inbox/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { getDealKnowledge } from "@/lib/promotion/service";
import { recordReviewDecision } from "@/lib/review/decisions";
import { correctNegotiationEvidence } from "@/lib/review/evidence";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let workspaceId = "";

describe("Phase 8E document review completion", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
    workspaceId = (await ensureDefaultWorkspace(prisma)).id;
  });
  test.after(async () => cleanup());

  test("readiness names missing side and date and does not invent them", () => {
    const missing = deriveReadiness({
      mimeType: "application/pdf",
      sourceFileState: "MISSING",
      hasUsableText: true,
      negotiationSide: null,
      documentDate: null,
      dealId: "deal",
      ingestionStatus: "READY",
      failureCode: null,
    });
    assert.equal(missing.metadataReady, false);
    assert.equal(missing.analysisReady, false);
    assert.deepEqual(missing.missing.map((gap) => gap.label), ["Source file", "Authoring side", "Document date"]);
    const ready = deriveReadiness({
      mimeType: "application/pdf",
      sourceFileState: "AVAILABLE",
      hasUsableText: true,
      negotiationSide: "LANDLORD",
      documentDate: new Date("2026-09-01T00:00:00Z"),
      dealId: "deal",
      ingestionStatus: "READY",
      failureCode: null,
    });
    assert.equal(ready.fileReady, true);
    assert.equal(ready.analysisReady, true);
    assert.deepEqual(ready.missing, []);
  });

  test("A/B source file states stay truthful", async () => {
    const deal = await createTestDeal(prisma);
    const missing = await prisma.document.create({
      data: baseDocument(deal.id, { storageKey: "pending", originalFilename: "Missing.pdf", ingestionStatus: "READY" }),
    });
    await prisma.documentPage.create({ data: { documentId: missing.id, pageNumber: 1, text: "Extracted text remains." } });
    const missingReview = await getDocumentReview(prisma, workspaceId, missing.id);
    assert.equal(missingReview?.item.sourceFileState, "MISSING");
    assert.equal(missingReview?.fileAvailable, false);
    assert.equal(missingReview?.item.pdfHref, null);

    const storage = getDocumentStorage();
    const available = await prisma.document.create({
      data: baseDocument(deal.id, { storageKey: "pending", originalFilename: "Available.pdf", sha256: "available-sha", ingestionStatus: "READY" }),
    });
    const stored = await storage.put({ documentId: available.id, filename: "available.pdf", bytes: buildTextPdf(["Hello"]) });
    await prisma.document.update({ where: { id: available.id }, data: { storageKey: stored.storageKey, sha256: "available-sha" } });
    const review = await getDocumentReview(prisma, workspaceId, available.id);
    assert.equal(review?.item.sourceFileState, "AVAILABLE");
    assert.equal(review?.fileAvailable, true);
    assert.ok(review?.item.pdfHref);
    await storage.delete(stored.storageKey);
  });

  test("C/D/E missing side, missing date, and ready to analyze", async () => {
    const deal = await createTestDeal(prisma);
    const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-ready-")));
    const quote = "Base Rent shall be $65.00 per rentable square foot.";
    const bytes = buildTextPdf([quote]);
    const received = await receiveNegotiationPdf({
      dealId: deal.id,
      bytes,
      filename: "ready.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-02T00:00:00Z"),
      documentType: "LOI",
      storage,
      prisma,
      mode: "extract",
    });
    const mirrored = await getDocumentStorage().put({
      documentId: received.document.id,
      filename: "ready.pdf",
      bytes,
    });
    await prisma.document.update({
      where: { id: received.document.id },
      data: { storageKey: mirrored.storageKey, negotiationSide: null, documentDate: null },
    });
      const prepared = await getDocumentReview(prisma, workspaceId, received.document.id);
      assert.equal(prepared?.item.processingStatus, "READY_TO_PREPARE");
      assert.ok(prepared?.readiness.missing.some((gap) => gap.label === "Authoring side"));
      assert.ok(prepared?.readiness.missing.some((gap) => gap.label === "Document date"));
      await updateDocumentMetadata(prisma, received.document.id, { negotiationSide: "LANDLORD" });
      const dated = await getDocumentReview(prisma, workspaceId, received.document.id);
      assert.ok(dated?.readiness.missing.some((gap) => gap.label === "Document date"));
      assert.equal(dated?.readiness.missing.some((gap) => gap.label === "Authoring side"), false);
      await updateDocumentMetadata(prisma, received.document.id, { documentDate: new Date("2026-09-03T00:00:00Z") });
      const ready = await getDocumentReview(prisma, workspaceId, received.document.id);
      assert.equal(ready?.readiness.analysisReady, true);
      assert.equal(ready?.item.processingStatus, "READY_TO_ANALYZE");
      await getDocumentStorage().delete(mirrored.storageKey);
  });

  test("F-J analyze success, failure, retry, and idempotency", async () => {
    const deal = await createTestDeal(prisma);
    const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-analyze-")));
    const quote = "Base Rent shall be $65.00 per rentable square foot.";
    let fail = true;
    const calls: string[] = [];
    const extractTerms: NegotiationTermExtractor = async (input) => {
      calls.push(input.documentText);
      if (fail) throw new NegotiationExtractionError("mock analysis failure");
      return {
        terms: [{
          canonicalType: "BASE_RENT",
          normalizedValue: "$65.00/RSF/year",
          normalizedNumeric: 65,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: quote,
          status: "PROPOSED",
          confidence: 1,
          evidenceQuote: quote,
          sourceLocation: "Rent",
        }],
        metadata: { model: "mock", extractedAt: new Date().toISOString(), latencyMs: 1, extractionConfidence: 1, validationFailures: 0 },
      };
    };
    const received = await receiveNegotiationPdf({
      dealId: deal.id,
      bytes: buildTextPdf([quote]),
      filename: "analyze.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-04T00:00:00Z"),
      documentType: "LOI",
      storage,
      prisma,
      mode: "extract",
    });
    const failed = await analyzeNegotiationDocument({ documentId: received.document.id, prisma, extractTerms });
    assert.equal(failed.document.ingestionStatus, "FAILED");
    assert.equal(await prisma.documentMilestone.count({ where: { documentId: received.document.id, kind: "ANALYZED" } }), 0);
    fail = false;
    const recovered = await analyzeNegotiationDocument({ documentId: received.document.id, prisma, extractTerms });
    const again = await analyzeNegotiationDocument({ documentId: received.document.id, prisma, extractTerms });
    assert.equal(recovered.document.ingestionStatus, "COMPLETE");
    assert.equal(again.idempotent, true);
    assert.equal(await prisma.negotiationRound.count({ where: { documentId: received.document.id } }), 1);
    assert.equal(calls.length, 2);
    assert.equal(await prisma.documentMilestone.count({ where: { documentId: received.document.id, kind: "ANALYZED" } }), 1);
    const review = await getDocumentReview(prisma, workspaceId, received.document.id);
    assert.equal(review?.findings.length, 1);
    assert.equal(review?.findings[0]?.reviewState, "PENDING");
    assert.equal(review?.item.processingStatus, "REVIEW_REQUIRED");
  });

  test("K-Q review decisions do not change negotiation truth", async () => {
    const deal = await createTestDeal(prisma);
    const document = await prisma.document.create({
      data: baseDocument(deal.id, { originalFilename: "Review.pdf", ingestionStatus: "COMPLETE", negotiationSide: "LANDLORD" }),
    });
    const page = await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 2, text: "Shared rent quote. Exact rent quote is $67.00 per rentable square foot." } });
    await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 3, text: "Shared rent quote." } });
    const round = await prisma.negotiationRound.create({
      data: {
        dealId: deal.id,
        side: "LANDLORD",
        roundNumber: 1,
        documentName: "Review.pdf",
        documentText: "text",
        documentDate: new Date("2026-09-05T00:00:00Z"),
        sourceType: "UPLOADED_PDF",
        documentId: document.id,
        terms: {
          create: [
            term("BASE_RENT", 67, "Shared rent quote", { structuredPayload: { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: 67 } }, provenanceStatus: "AMBIGUOUS" }),
            term("BASE_RENT", 65, "Other rent quote", { normalizedValue: "$65", provenanceStatus: "UNLOCATED" }),
            term("LEASE_TERM", null, "Ten year term", { normalizedValue: "10 years", normalizedUnit: null, provenanceStatus: "EXACT", documentPageId: page.id, evidenceStartOffset: 0, evidenceEndOffset: 4 }),
          ],
        },
      },
      include: { terms: true },
    });
    const before = await prisma.negotiationTerm.findMany({ where: { roundId: round.id }, orderBy: { id: "asc" } });
    const structured = round.terms.find((item) => item.canonicalType === "BASE_RENT" && item.normalizedNumeric === 67)!;
    const legacy = round.terms.find((item) => item.canonicalType === "LEASE_TERM")!;
    const pending = await getDocumentReview(prisma, workspaceId, document.id);
    assert.equal(pending?.findings.every((finding) => finding.reviewState === "PENDING"), true);
    assert.ok((pending?.conflicts.length ?? 0) >= 1);

    await recordReviewDecision(prisma, { documentId: document.id, action: "ACKNOWLEDGE", target: { kind: "NEGOTIATION_TERM", negotiationTermId: structured.id } });
    await recordReviewDecision(prisma, { documentId: document.id, action: "ACKNOWLEDGE", target: { kind: "NEGOTIATION_TERM", negotiationTermId: structured.id } });
    const acknowledged = await getDocumentReview(prisma, workspaceId, document.id);
    assert.equal(acknowledged?.findings.find((finding) => finding.termId === structured.id)?.reviewState, "ACKNOWLEDGED");
    assert.equal(await prisma.reviewDecisionEvent.count({ where: { documentId: document.id, subjectKey: `term:${structured.id}` } }), 1);

    const other = round.terms.find((item) => item.evidenceQuote === "Other rent quote")!;
    await recordReviewDecision(prisma, { documentId: document.id, action: "NEEDS_FOLLOW_UP", target: { kind: "NEGOTIATION_TERM", negotiationTermId: other.id }, note: "Check the rent" });
    await recordReviewDecision(prisma, { documentId: document.id, action: "CLEAR", target: { kind: "NEGOTIATION_TERM", negotiationTermId: other.id } });
    const cleared = await getDocumentReview(prisma, workspaceId, document.id);
    assert.equal(cleared?.findings.find((finding) => finding.termId === other.id)?.reviewState, "PENDING");
    assert.equal(await prisma.reviewDecision.count({ where: { negotiationTermId: other.id } }), 1);
    assert.equal(await prisma.reviewDecisionEvent.count({ where: { negotiationTermId: other.id } }), 2);

    const conflictType = pending?.conflicts[0]?.canonicalType ?? "BASE_RENT";
    await recordReviewDecision(prisma, { documentId: document.id, action: "ACKNOWLEDGE", target: { kind: "NEGOTIATION_CONFLICT", canonicalType: conflictType } });
    await recordReviewDecision(prisma, { documentId: document.id, action: "ACKNOWLEDGE", target: { kind: "NEGOTIATION_TERM", negotiationTermId: legacy.id } });
    const after = await prisma.negotiationTerm.findMany({ where: { roundId: round.id }, orderBy: { id: "asc" } });
    assert.deepEqual(after.map(snapshot), before.map(snapshot));
    const employments = await prisma.employment.count();
    const links = await prisma.entityResolutionLink.count();
    assert.equal(await prisma.employment.count(), employments);
    assert.equal(await prisma.entityResolutionLink.count(), links);
    const legacyRow = after.find((item) => item.id === legacy.id)!;
    assert.equal(legacyRow.structuredPayload, null);
    assert.equal(legacyRow.status, "PROPOSED");
  });

  test("R-Z evidence correction preserves original provenance", async () => {
    const deal = await createTestDeal(prisma);
    const document = await prisma.document.create({
      data: baseDocument(deal.id, { originalFilename: "Evidence.pdf", ingestionStatus: "COMPLETE" }),
    });
    const other = await prisma.document.create({
      data: baseDocument(deal.id, { originalFilename: "Other.pdf", ingestionStatus: "COMPLETE", sha256: "other-sha" }),
    });
    const page = await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 2, text: "Alpha quote lives here. Beta quote lives here." } });
    const duplicate = await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 4, text: "Alpha quote lives here." } });
    const foreign = await prisma.documentPage.create({ data: { documentId: other.id, pageNumber: 1, text: "Alpha quote lives here." } });
    const round = await prisma.negotiationRound.create({
      data: {
        dealId: deal.id,
        side: "TENANT",
        roundNumber: 1,
        documentName: "Evidence.pdf",
        documentText: "",
        documentDate: new Date("2026-09-06T00:00:00Z"),
        sourceType: "UPLOADED_PDF",
        documentId: document.id,
        terms: {
          create: [
            term("PARKING", 4, "Beta quote lives here.", { provenanceStatus: "EXACT", documentPageId: page.id, evidenceStartOffset: 23, evidenceEndOffset: 45, normalizedUnit: "SPACES" }),
            term("TI_ALLOWANCE", 10, "Alpha quote lives here.", { provenanceStatus: "AMBIGUOUS", normalizedUnit: "USD_PER_RSF" }),
            term("SECURITY_DEPOSIT", 1, "Missing quote.", { provenanceStatus: "UNLOCATED", normalizedUnit: "MONTHS" }),
          ],
        },
      },
      include: { terms: true },
    });
    const exact = round.terms.find((item) => item.canonicalType === "PARKING")!;
    const ambiguous = round.terms.find((item) => item.canonicalType === "TI_ALLOWANCE")!;
    const unlocated = round.terms.find((item) => item.canonicalType === "SECURITY_DEPOSIT")!;
    const shown = await getDocumentReview(prisma, workspaceId, document.id);
    const exactFinding = shown?.findings.find((finding) => finding.termId === exact.id);
    assert.equal(exactFinding?.provenanceStatus, "EXACT");
    assert.equal(exactFinding?.pageNumber, 2);

    const start = page.text.indexOf("Alpha quote lives here.");
    const saved = await correctNegotiationEvidence(prisma, {
      documentId: document.id,
      negotiationTermId: ambiguous.id,
      documentPageId: page.id,
      startOffset: start,
      endOffset: start + "Alpha quote lives here.".length,
      evidenceQuote: "Alpha quote lives here.",
    });
    const repeated = await correctNegotiationEvidence(prisma, {
      documentId: document.id,
      negotiationTermId: ambiguous.id,
      documentPageId: page.id,
      startOffset: start,
      endOffset: start + "Alpha quote lives here.".length,
      evidenceQuote: "Alpha quote lives here.",
    });
    assert.equal(saved.correction.id, repeated.correction.id);
    const betaStart = duplicate.text.indexOf("Alpha quote lives here.");
    await correctNegotiationEvidence(prisma, {
      documentId: document.id,
      negotiationTermId: ambiguous.id,
      documentPageId: duplicate.id,
      startOffset: betaStart,
      endOffset: betaStart + "Alpha quote lives here.".length,
      evidenceQuote: "Alpha quote lives here.",
    });
    const missingStart = page.text.indexOf("Beta quote lives here.");
    await correctNegotiationEvidence(prisma, {
      documentId: document.id,
      negotiationTermId: unlocated.id,
      documentPageId: page.id,
      startOffset: missingStart,
      endOffset: missingStart + "Beta quote lives here.".length,
      evidenceQuote: "Beta quote lives here.",
    });
    await assert.rejects(
      () => correctNegotiationEvidence(prisma, {
        documentId: document.id,
        negotiationTermId: ambiguous.id,
        documentPageId: foreign.id,
        startOffset: 0,
        endOffset: 5,
        evidenceQuote: "Alpha",
      }),
      /not part of this document/
    );
    await assert.rejects(
      () => correctNegotiationEvidence(prisma, {
        documentId: document.id,
        negotiationTermId: ambiguous.id,
        documentPageId: page.id,
        startOffset: 5,
        endOffset: 2,
        evidenceQuote: "nope",
      }),
      /outside the extracted page/
    );
    await assert.rejects(
      () => correctNegotiationEvidence(prisma, {
        documentId: document.id,
        negotiationTermId: ambiguous.id,
        documentPageId: page.id,
        startOffset: 0,
        endOffset: 5,
        evidenceQuote: "not the slice",
      }),
      /does not match/
    );
    const original = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: ambiguous.id } });
    assert.equal(original.evidenceQuote, "Alpha quote lives here.");
    assert.equal(original.provenanceStatus, "AMBIGUOUS");
    assert.equal(original.documentPageId, null);
    const history = await prisma.evidenceCorrection.findMany({ where: { negotiationTermId: ambiguous.id }, orderBy: { createdAt: "asc" } });
    assert.equal(history.length, 2);
    assert.ok(history[0]?.supersededAt);
    assert.equal(history[1]?.supersededAt, null);
    assert.equal(history[1]?.documentPageId, duplicate.id);
    const active = await prisma.evidenceCorrection.findFirst({ where: { negotiationTermId: ambiguous.id, supersededAt: null } });
    assert.equal(active?.id, history[1]?.id);
  });

  test("follow-up stays review required and acknowledged work can reach reviewed", async () => {
    const deal = await createTestDeal(prisma);
    const document = await prisma.document.create({
      data: baseDocument(deal.id, { originalFilename: "Progress.pdf", ingestionStatus: "COMPLETE", graphExtractionStatus: "SUCCEEDED" }),
    });
    const round = await prisma.negotiationRound.create({
      data: {
        dealId: deal.id,
        side: "TENANT",
        roundNumber: 1,
        documentName: "Progress.pdf",
        documentText: "",
        documentDate: new Date("2026-09-07T00:00:00Z"),
        sourceType: "UPLOADED_PDF",
        documentId: document.id,
        terms: { create: [term("BASE_RENT", 64, "Rent quote stays exact", { provenanceStatus: "EXACT" })] },
      },
      include: { terms: true },
    });
    await recordReviewDecision(prisma, { documentId: document.id, action: "NEEDS_FOLLOW_UP", target: { kind: "NEGOTIATION_TERM", negotiationTermId: round.terms[0]!.id } });
    const followUp = await getDocumentReview(prisma, workspaceId, document.id);
    assert.equal(followUp?.item.processingStatus, "REVIEW_REQUIRED");
    assert.equal(followUp?.progress.negotiationReviewed, 1);
    assert.equal(followUp?.progress.negotiationTotal, 1);
    assert.equal(followUp?.item.requiresReview, true);
    await recordReviewDecision(prisma, { documentId: document.id, action: "ACKNOWLEDGE", target: { kind: "NEGOTIATION_TERM", negotiationTermId: round.terms[0]!.id } });
    const reviewed = await getDocumentReview(prisma, workspaceId, document.id);
    assert.equal(reviewed?.item.processingStatus, "REVIEWED");
    const inbox = await getInbox(prisma, { workspaceId, dealId: deal.id });
    assert.equal(inbox.items.find((item) => item.document.originalFilename === "Progress.pdf")?.processingStatus, "REVIEWED");
  });

  test("workspace isolation, activity milestones, and downstream reads", async () => {
    const deal = await createTestDeal(prisma);
    const otherWorkspace = await prisma.workspace.create({ data: { name: "Elsewhere" } });
    const otherDeal = await prisma.deal.create({
      data: { workspaceId: otherWorkspace.id, name: "Hidden", company: "Hidden", property: "Hidden", stage: "LOI", status: "ACTIVE" },
    });
    const document = await prisma.document.create({
      data: baseDocument(deal.id, { originalFilename: "Isolated.pdf", ingestionStatus: "COMPLETE" }),
    });
    const hidden = await prisma.document.create({
      data: baseDocument(otherDeal.id, { originalFilename: "Hidden.pdf", ingestionStatus: "COMPLETE", sha256: "hidden-sha" }),
    });
    const hiddenPage = await prisma.documentPage.create({ data: { documentId: hidden.id, pageNumber: 1, text: "Foreign page text." } });
    const round = await prisma.negotiationRound.create({
      data: {
        dealId: deal.id,
        side: "TENANT",
        roundNumber: 1,
        documentName: "Isolated.pdf",
        documentText: "",
        documentDate: new Date("2026-09-08T00:00:00Z"),
        sourceType: "UPLOADED_PDF",
        documentId: document.id,
        terms: { create: [term("BASE_RENT", 70, "Isolated rent", { provenanceStatus: "UNLOCATED" })] },
      },
      include: { terms: true },
    });
    const hiddenRound = await prisma.negotiationRound.create({
      data: {
        dealId: otherDeal.id,
        side: "TENANT",
        roundNumber: 1,
        documentName: "Hidden.pdf",
        documentText: "",
        documentDate: new Date("2026-09-08T00:00:00Z"),
        sourceType: "UPLOADED_PDF",
        documentId: hidden.id,
        terms: { create: [term("BASE_RENT", 1, "Foreign page text.", { provenanceStatus: "EXACT", documentPageId: hiddenPage.id })] },
      },
      include: { terms: true },
    });
    await assert.rejects(
      () => recordReviewDecision(prisma, { documentId: document.id, action: "ACKNOWLEDGE", target: { kind: "NEGOTIATION_TERM", negotiationTermId: hiddenRound.terms[0]!.id } }),
      /not on this document/
    );
    assert.equal(await getDocumentReview(prisma, workspaceId, hidden.id), null);
    const page = await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 1, text: "Isolated rent is stored here." } });
    const start = page.text.indexOf("Isolated rent");
    await correctNegotiationEvidence(prisma, {
      documentId: document.id,
      negotiationTermId: round.terms[0]!.id,
      documentPageId: page.id,
      startOffset: start,
      endOffset: start + "Isolated rent".length,
      evidenceQuote: "Isolated rent",
    });
    await recordReviewDecision(prisma, { documentId: document.id, action: "ACKNOWLEDGE", target: { kind: "NEGOTIATION_TERM", negotiationTermId: round.terms[0]!.id } });
    const activity = await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id, limit: 20 });
    const titles = activity?.events.map((event) => event.title) ?? [];
    assert.equal(titles.filter((title) => title === "Evidence corrected").length, 1);
    assert.equal(titles.filter((title) => title === "Negotiation findings reviewed").length, 1);
    const negotiation = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(negotiation?.terms.find((term) => term.canonicalType === "BASE_RENT")?.status === "AGREED", false);
    assert.equal(negotiation?.documents.find((item) => item.id === document.id)?.review?.findingsReviewed, 1);
    const knowledge = await getDealKnowledge(prisma, deal.id);
    const connections = await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 1 });
    const documents = await getInbox(prisma, { workspaceId, scopeDealId: deal.id });
    assert.ok(knowledge);
    assert.ok(connections);
    assert.equal(documents.items.some((item) => item.document.id === document.id), true);
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../inbox/service.ts"), "utf8");
    assert.equal(/\b(extractTerms|extractCREGraph|openai)\b/.test(source), false);
  });

  test("development source replacement preserves the document only when that is safe", async () => {
    const deal = await createTestDeal(prisma);
    const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-repair-")));
    const bytes = buildTextPdf(["Replacement text for a clean document."]);
    const document = await prisma.document.create({
      data: baseDocument(deal.id, { storageKey: "pending", originalFilename: "Repair.pdf", sha256: "not-a-file", ingestionStatus: "READY" }),
    });
    await prisma.documentPage.create({ data: { documentId: document.id, pageNumber: 1, text: "Bound text." } });
    await prisma.entityObservation.create({
      data: {
        workspaceId,
        observedType: "COMPANY",
        surfaceForm: "Bound Co",
        normalizedName: "bound co",
        sourceKind: "DOCUMENT_PAGE",
        dealId: deal.id,
        documentId: document.id,
        evidenceQuote: "Bound text.",
        extractor: "test",
        extractorVersion: "test",
      },
    });
    await assert.rejects(
      () => replaceDevelopmentSourceFile(prisma, { documentId: document.id, bytes, filename: "new.pdf", mimeType: "application/pdf", storage }),
      (error: unknown) => error instanceof SourceReplacementError && error.code === "EVIDENCE_BOUND"
    );
    const clean = await prisma.document.create({
      data: baseDocument(deal.id, { storageKey: "pending", originalFilename: "Clean.pdf", sha256: "clean-sha", ingestionStatus: "UPLOADED" }),
    });
    const replaced = await replaceDevelopmentSourceFile(prisma, {
      documentId: clean.id,
      bytes,
      filename: "clean.pdf",
      mimeType: "application/pdf",
      storage,
    });
    assert.equal(replaced.id, clean.id);
    assert.notEqual(replaced.sha256, "clean-sha");
    assert.equal(replaced.storageKey.startsWith("pending"), false);
  });
});

function baseDocument(dealId: string, overrides: Record<string, unknown>) {
  return {
    dealId,
    filename: `file-${Math.random().toString(16).slice(2)}.pdf`,
    originalFilename: "Document.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    sha256: `sha-${Math.random().toString(16).slice(2)}`,
    documentType: "LOI" as const,
    documentDate: new Date("2026-09-01T00:00:00Z"),
    negotiationSide: "TENANT",
    ingestionStatus: "COMPLETE" as const,
    storageKey: `pending-${Math.random().toString(16).slice(2)}`,
    pageCount: 1,
    ...overrides,
  };
}

function term(canonicalType: string, numeric: number | null, evidenceQuote: string, extra?: Record<string, unknown>) {
  return {
    canonicalType,
    normalizedValue: numeric === null ? evidenceQuote : `$${numeric}`,
    normalizedNumeric: numeric,
    normalizedUnit: numeric === null ? null : "USD_PER_RSF_YEAR",
    rawValue: evidenceQuote,
    status: "PROPOSED",
    side: "LANDLORD",
    roundNumber: 1,
    confidence: 1,
    evidenceQuote,
    sourceLocation: "Body",
    provenanceStatus: "EXACT" as const,
    ...extra,
  };
}

function snapshot(termRow: { status: string; normalizedValue: string | null; evidenceQuote: string; provenanceStatus: string | null; structuredPayload: unknown }) {
  return {
    status: termRow.status,
    normalizedValue: termRow.normalizedValue,
    evidenceQuote: termRow.evidenceQuote,
    provenanceStatus: termRow.provenanceStatus,
    structuredPayload: termRow.structuredPayload,
  };
}
