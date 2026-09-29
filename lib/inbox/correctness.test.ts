import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { NegotiationExtractionError } from "@/lib/ai/negotiation/extractTerms";
import type { NegotiationTermExtractor } from "@/lib/documents/ingestNegotiationPdf";
import { analyzeNegotiationDocument, ingestNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { getDocumentStorage, LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase } from "@/lib/documents/testDb";
import { createWorkspace } from "@/lib/entities/service";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getDealBrief } from "@/lib/deals/brief/service";
import { isOperationalAnalysisAttention, processingIssuesInboxHref } from "@/lib/deals/brief/presentation";
import { deriveMessageLifecycle } from "@/lib/messages/state";
import { INBOX_MESSAGE_LIMIT } from "./types";
import { getInbox } from "./service";
import {
  matchesInboxFilter,
  matchesMessageInboxFilter,
  messageNextAction,
  nextActionFor,
} from "./status";
import type { InboxPageModel } from "./types";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let sequence = 0;

describe("Inbox source work queue", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test.after(async () => cleanup());

  test("review filters follow document and message lifecycle, not a leftover complete check", async () => {
    assert.equal(matchesInboxFilter("NOT_READY", false, "NEEDS_REVIEW"), false);
    assert.equal(matchesInboxFilter("READY_TO_PREPARE", false, "NEEDS_REVIEW"), false);
    assert.equal(matchesInboxFilter("READY_TO_ANALYZE", false, "PROCESSING"), false);
    assert.equal(matchesInboxFilter("ANALYZING", false, "PROCESSING"), true);
    assert.equal(matchesInboxFilter("REVIEW_REQUIRED", true, "NEEDS_REVIEW"), true);
    assert.equal(matchesInboxFilter("REVIEWED", false, "COMPLETE"), true);
    assert.equal(matchesInboxFilter("FAILED", false, "FAILED"), true);
    assert.equal(matchesInboxFilter("FAILED", false, "NEEDS_REVIEW"), false);
    assert.equal(matchesMessageInboxFilter({ analysisState: "NOT_ANALYZED", lifecycleState: "IMPORTED" }, "NEEDS_REVIEW"), false);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYZING", lifecycleState: "ANALYZING" }, "PROCESSING"), true);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYZING", lifecycleState: "ANALYZING" }, "NEEDS_REVIEW"), false);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYSIS_FAILED", lifecycleState: "ANALYSIS_FAILED" }, "FAILED"), true);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYSIS_FAILED", lifecycleState: "ANALYSIS_FAILED" }, "NEEDS_REVIEW"), false);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYZED", lifecycleState: "REVIEW_REQUIRED" }, "NEEDS_REVIEW"), true);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYZED", lifecycleState: "REVIEW_REQUIRED" }, "COMPLETE"), false);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYZED", lifecycleState: "REVIEWED" }, "COMPLETE"), true);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYZED", lifecycleState: "ANALYZED" }, "NEEDS_REVIEW"), false);
    assert.equal(matchesMessageInboxFilter({ analysisState: "ANALYZED", lifecycleState: "ANALYZED" }, "COMPLETE"), false);

    const confirmedButUnacknowledged = deriveMessageLifecycle({
      runs: [{ id: "run-1", status: "SUCCEEDED", factCount: 1, createdAt: new Date("2026-09-01T00:00:00Z"), completedAt: new Date("2026-09-01T00:00:00Z") }],
      decisions: [],
      currentFactIds: ["fact-1"],
      facts: [{ structuredPayload: { display: "$70" }, reviews: [{ id: "review-1" }] }],
    });
    assert.equal(confirmedButUnacknowledged.reviewState, "REVIEW_REQUIRED");
    assert.equal(confirmedButUnacknowledged.evidenceSettled, false);
    assert.equal(matchesMessageInboxFilter(confirmedButUnacknowledged, "NEEDS_REVIEW"), true);

    const acknowledgedWithPendingAction = deriveMessageLifecycle({
      runs: [{ id: "run-2", status: "SUCCEEDED", factCount: 1, createdAt: new Date("2026-09-02T00:00:00Z"), completedAt: new Date("2026-09-02T00:00:00Z") }],
      decisions: [{
        id: "decision-1",
        decision: "ACKNOWLEDGED",
        activityExtractionRunId: "run-2",
        presentedFactIds: ["fact-2"],
        createdAt: new Date("2026-09-02T01:00:00Z"),
      }],
      currentFactIds: ["fact-2"],
      facts: [{
        structuredPayload: {
          action: {
            kind: "INFORMATION_REQUESTED",
            responsibleSide: "COUNTERPARTY",
            responsibleLabel: null,
            counterpartyLabel: null,
            dueAt: null,
            dueText: null,
            occursAt: null,
            fulfillsFactId: null,
          },
        },
        reviews: [],
      }],
    });
    assert.equal(acknowledgedWithPendingAction.reviewState, "REVIEWED");
    assert.equal(acknowledgedWithPendingAction.actionReviewState, "PENDING");
    assert.equal(acknowledgedWithPendingAction.lifecycleState, "REVIEW_REQUIRED");
    assert.equal(messageNextAction({ ...acknowledgedWithPendingAction, href: "/messages/m" }).label, "Review action evidence");
    assert.equal(messageNextAction({
      analysisState: "ANALYSIS_FAILED",
      reviewState: "NOT_REVIEWED",
      actionReviewState: "NOT_APPLICABLE",
      evidenceSettled: false,
      href: "/messages/failed",
    }).label, "Retry analysis");
  });

  test("mixed sources, filters, ordering, recovery, and workspace scope", async () => {
    const workspace = await ensureDefaultWorkspace(prisma);
    const alpha = await dealIn(workspace.id, "Deal A");
    const beta = await dealIn(workspace.id, "Deal B");
    const stamp = new Date("2026-08-01T15:00:00.000Z");
    const reviewedDocument = await documentOn(alpha.id, {
      originalFilename: "Reviewed.pdf",
      ingestionStatus: "COMPLETE",
      documentDate: stamp,
    });
    const failedDocument = await documentOn(alpha.id, {
      originalFilename: "AnalysisFailed.pdf",
      ingestionStatus: "FAILED",
      failureCode: "ANALYSIS_FAILED",
      failureReason: "Negotiation analysis failed.",
      documentDate: new Date("2026-08-02T15:00:00.000Z"),
    });
    const scanned = await documentOn(alpha.id, {
      originalFilename: "Scanned.pdf",
      ingestionStatus: "FAILED",
      failureCode: "SCANNED_OR_EMPTY",
      failureReason: "This PDF has no usable embedded text.",
      documentDate: new Date("2026-08-03T15:00:00.000Z"),
    });
    const storageFailed = await documentOn(alpha.id, {
      originalFilename: "Storage.pdf",
      ingestionStatus: "FAILED",
      failureCode: "STORAGE_FAILED",
      failureReason: "The file could not be stored.",
    });
    const needsMetadata = await documentOn(beta.id, {
      originalFilename: "NeedsMetadata.pdf",
      ingestionStatus: "UPLOADED",
      negotiationSide: null,
      documentDate: null,
      pageCount: 0,
    });
    const analyzing = await documentOn(beta.id, {
      originalFilename: "Analyzing.pdf",
      ingestionStatus: "ANALYZING",
    });
    const needsReview = await documentOn(beta.id, {
      originalFilename: "NeedsReview.pdf",
      ingestionStatus: "COMPLETE",
      documentDate: new Date("2026-08-04T15:00:00.000Z"),
    });
    await prisma.negotiationRound.create({
      data: {
        dealId: beta.id,
        side: "TENANT",
        roundNumber: 1,
        documentName: "NeedsReview.pdf",
        documentText: "Base rent is $65.",
        documentDate: new Date("2026-08-04T15:00:00.000Z"),
        sourceType: "PDF_UPLOAD",
        documentId: needsReview.id,
        terms: {
          create: {
            canonicalType: "BASE_RENT",
            normalizedValue: "$65.00/RSF/year",
            normalizedNumeric: 65,
            normalizedUnit: "USD_PER_RSF_YEAR",
            rawValue: "$65",
            status: "PROPOSED",
            side: "TENANT",
            roundNumber: 1,
            confidence: 1,
            evidenceQuote: "Base rent is $65.",
            sourceLocation: "Rent",
            provenanceStatus: "EXACT",
          },
        },
      },
    });
    const ready = await documentOn(alpha.id, {
      originalFilename: "Ready.pdf",
      ingestionStatus: "UPLOADED",
      pageCount: 0,
      documentDate: new Date("2026-08-05T15:00:00.000Z"),
    });
    const stored = await getDocumentStorage().put({
      documentId: ready.id,
      filename: "Ready.pdf",
      bytes: buildTextPdf(["Ready to analyze."]),
    });
    await prisma.document.update({ where: { id: ready.id }, data: { storageKey: stored.storageKey } });
    const knowledgeFailed = await documentOn(alpha.id, {
      originalFilename: "Knowledge.pdf",
      ingestionStatus: "COMPLETE",
      graphExtractionStatus: "FAILED",
      failureReason: null,
      documentDate: new Date("2026-08-06T15:00:00.000Z"),
    });
    await prisma.document.update({
      where: { id: knowledgeFailed.id },
      data: { graphFailureReason: "Entity extraction failed." },
    });

    const reviewedMessage = await messageOn(alpha, {
      subject: "Reviewed message",
      sentAt: stamp,
      runStatus: "SUCCEEDED",
      amount: 70,
      acknowledged: true,
    });
    const unacknowledged = await messageOn(beta, {
      subject: "Needs review message",
      sentAt: new Date("2026-08-04T15:00:01.000Z"),
      runStatus: "SUCCEEDED",
      amount: 71,
      confirmFact: true,
    });
    const failedMessage = await messageOn(alpha, {
      subject: "Failed message",
      sentAt: new Date("2026-08-07T15:00:00.000Z"),
      runStatus: "FAILED",
    });
    const importedMessage = await messageOn(beta, {
      subject: "Imported message",
      sentAt: new Date("2026-08-08T15:00:00.000Z"),
    });

    const all = await getInbox(prisma, { workspaceId: workspace.id });
    assert.equal(all.sourceCounts.DOCUMENTS, 9);
    assert.equal(all.sourceCounts.MESSAGES, 4);
    assert.equal(all.sourceCounts.ALL, 13);
    assert.equal(all.sourceItems.length, 13);
    assert.equal(all.messageWindow.truncated, false);
    assert.equal(all.messageWindow.limit, INBOX_MESSAGE_LIMIT);
    assert.deepEqual(kinds(await getInbox(prisma, { workspaceId: workspace.id, source: "DOCUMENTS" })), Array(9).fill("DOCUMENT"));
    assert.deepEqual(kinds(await getInbox(prisma, { workspaceId: workspace.id, source: "MESSAGES" })), Array(4).fill("MESSAGE"));
    assert.equal((await getInbox(prisma, { workspaceId: workspace.id, source: "MESSAGES", filter: "COMPLETE" })).sourceItems.length, 1);

    const ordered = all.sourceItems.map((item) => item.kind === "DOCUMENT" ? item.document.document.id : item.message.id);
    const sorted = [...ordered].sort((left, right) => {
      const leftItem = all.sourceItems.find((item) => (item.kind === "DOCUMENT" ? item.document.document.id : item.message.id) === left)!;
      const rightItem = all.sourceItems.find((item) => (item.kind === "DOCUMENT" ? item.document.document.id : item.message.id) === right)!;
      return rightItem.occurredAt.localeCompare(leftItem.occurredAt) || right.localeCompare(left);
    });
    assert.deepEqual(ordered, sorted);
    const sameTime = all.sourceItems.filter((item) => item.occurredAt === stamp.toISOString());
    assert.equal(sameTime.length, 2);
    assert.equal(sameTime[0]?.kind === "DOCUMENT" ? sameTime[0].document.document.id : sameTime[0]?.message.id, [reviewedDocument.id, reviewedMessage.message.id].sort((left, right) => right.localeCompare(left))[0]);

    const byName = names(all);
    assert.equal(byName.get("NeedsMetadata.pdf")?.status, "READY_TO_PREPARE");
    assert.equal(byName.get("NeedsMetadata.pdf")?.action, "Prepare document");
    assert.equal(byName.get("Analyzing.pdf")?.status, "ANALYZING");
    assert.equal(byName.get("Ready.pdf")?.status, "READY_TO_ANALYZE");
    assert.equal(byName.get("Ready.pdf")?.action, "Analyze document");
    assert.equal(byName.get("AnalysisFailed.pdf")?.status, "FAILED");
    assert.equal(byName.get("AnalysisFailed.pdf")?.action, "Retry analysis");
    assert.equal(byName.get("AnalysisFailed.pdf")?.href, `/documents/${failedDocument.id}/review`);
    assert.equal(byName.get("AnalysisFailed.pdf")?.retry, true);
    assert.equal(byName.get("Scanned.pdf")?.action, "View failure");
    assert.equal(byName.get("Scanned.pdf")?.retry, false);
    assert.equal(byName.get("Scanned.pdf")?.href, `/documents/${scanned.id}/review`);
    assert.equal(byName.get("Storage.pdf")?.retry, false);
    assert.equal(byName.get("Knowledge.pdf")?.label, "Knowledge extraction failed");
    assert.equal(byName.get("NeedsReview.pdf")?.status, "REVIEW_REQUIRED");
    assert.equal(byName.get("NeedsReview.pdf")?.action, "Review document");
    assert.equal(byName.get("Reviewed.pdf")?.status, "REVIEWED");

    const needsReviewPage = await getInbox(prisma, { workspaceId: workspace.id, filter: "NEEDS_REVIEW" });
    assert.ok(needsReviewPage.sourceItems.some((item) => item.kind === "DOCUMENT" && item.document.document.id === needsReview.id));
    assert.ok(needsReviewPage.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === unacknowledged.message.id));
    assert.equal(needsReviewPage.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === importedMessage.message.id), false);
    assert.equal(needsReviewPage.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === failedMessage.message.id), false);
    assert.equal(needsReviewPage.sourceItems.some((item) => item.kind === "DOCUMENT" && item.document.document.id === reviewedDocument.id), false);
    assert.equal(needsReviewPage.counts.NEEDS_REVIEW, needsReviewPage.sourceItems.length);

    const reviewedPage = await getInbox(prisma, { workspaceId: workspace.id, filter: "COMPLETE" });
    assert.ok(reviewedPage.sourceItems.some((item) => item.kind === "DOCUMENT" && item.document.document.id === reviewedDocument.id));
    assert.ok(reviewedPage.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === reviewedMessage.message.id));
    assert.equal(reviewedPage.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === unacknowledged.message.id), false);

    const failedPage = await getInbox(prisma, { workspaceId: workspace.id, filter: "FAILED" });
    const failedIds = new Set(failedPage.sourceItems.map((item) => item.kind === "DOCUMENT" ? item.document.document.id : item.message.id));
    assert.deepEqual(
      [...failedIds].sort(),
      [failedDocument.id, scanned.id, storageFailed.id, knowledgeFailed.id, failedMessage.message.id].sort()
    );
    const failedMessageRow = failedPage.sourceItems.find((item) => item.kind === "MESSAGE");
    assert.equal(failedMessageRow?.kind === "MESSAGE" ? failedMessageRow.message.nextAction.label : "", "Retry analysis");
    assert.equal(failedMessageRow?.kind === "MESSAGE" ? failedMessageRow.message.href : "", `/messages/${failedMessage.message.id}`);
    assert.equal(failedMessageRow?.kind === "MESSAGE" ? failedMessageRow.message.failureReason : "", "Fixture extraction failure");
    assert.equal(failedPage.counts.FAILED, failedPage.sourceItems.length);

    const betaOnly = await getInbox(prisma, { workspaceId: workspace.id, dealId: beta.id });
    assert.ok(betaOnly.sourceItems.every((item) => (item.kind === "DOCUMENT" ? item.document.deal.id : item.message.deal.id) === beta.id));
    assert.equal(betaOnly.sourceCounts.ALL, betaOnly.sourceItems.length);
    assert.ok(betaOnly.sourceCounts.DOCUMENTS > 0);
    assert.ok(betaOnly.sourceCounts.MESSAGES > 0);

    const other = await createWorkspace(prisma, { name: `Hidden ${++sequence}` });
    const hiddenDeal = await dealIn(other.id, "Hidden");
    const hiddenDocument = await documentOn(hiddenDeal.id, { originalFilename: "Hidden.pdf", ingestionStatus: "COMPLETE" });
    await messageOn({ id: hiddenDeal.id, workspaceId: other.id }, { subject: "Hidden message" });
    const isolated = await getInbox(prisma, { workspaceId: workspace.id });
    assert.equal(isolated.sourceItems.some((item) => item.kind === "DOCUMENT" && item.document.document.id === hiddenDocument.id), false);
    assert.equal(isolated.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.subject === "Hidden message"), false);

    const brief = await getDealBrief(prisma, alpha.id);
    assert.ok(brief);
    const issues = brief.systemAttention.filter((item) => isOperationalAnalysisAttention(item.type));
    const alphaFailed = await getInbox(prisma, { workspaceId: workspace.id, dealId: alpha.id, filter: "FAILED" });
    assert.equal(processingIssuesInboxHref(alpha.id), `/inbox?dealId=${alpha.id}&filter=FAILED`);
    assert.equal(issues.length, alphaFailed.sourceItems.length);
    assert.deepEqual(
      issues.map((item) => item.sourceId).sort(),
      alphaFailed.sourceItems.map((item) => item.kind === "DOCUMENT" ? item.document.document.id : item.message.id).sort()
    );

    assert.equal(needsMetadata.id.length > 0, true);
    assert.equal(analyzing.id.length > 0, true);
    assert.equal(nextActionFor({ processingStatus: "FAILED", canRetry: false, reviewHref: "/documents/x/review" }).label, "View failure");
  });

  test("a retried analysis failure leaves the failed work queue", async () => {
    const workspace = await ensureDefaultWorkspace(prisma);
    const deal = await dealIn(workspace.id, "Recovery");
    const storage = new LocalDocumentStorage(`/tmp/dealwatch-inbox-recovery-${sequence}`);
    let fail = true;
    const extractTerms: NegotiationTermExtractor = async () => {
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
    const failed = await ingestNegotiationPdf({
      dealId: deal.id,
      bytes: buildTextPdf(["Base Rent shall be $65.00 per rentable square foot."]),
      filename: "recovery.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-01T00:00:00.000Z"),
      documentType: "LOI",
      storage,
      prisma,
      extractGraph: null,
      extractTerms,
    });
    const before = await getInbox(prisma, { workspaceId: workspace.id, dealId: deal.id, filter: "FAILED" });
    assert.equal(before.sourceItems.length, 1);
    assert.equal(before.sourceItems[0]?.kind === "DOCUMENT" ? before.sourceItems[0].document.nextAction.href : "", `/documents/${failed.document.id}/review`);
    const briefBefore = await getDealBrief(prisma, deal.id);
    assert.equal(briefBefore?.systemAttention.filter((item) => isOperationalAnalysisAttention(item.type)).length, 1);
    fail = false;
    await analyzeNegotiationDocument({ documentId: failed.document.id, prisma, extractTerms });
    const after = await getInbox(prisma, { workspaceId: workspace.id, dealId: deal.id, filter: "FAILED" });
    assert.equal(after.sourceItems.length, 0);
    const briefAfter = await getDealBrief(prisma, deal.id);
    assert.equal(briefAfter?.systemAttention.some((item) => item.type === "DOCUMENT_ANALYSIS_FAILED" && item.sourceId === failed.document.id), false);
    const refreshed = await getInbox(prisma, { workspaceId: workspace.id, dealId: deal.id });
    const row = refreshed.sourceItems.find((item) => item.kind === "DOCUMENT" && item.document.document.id === failed.document.id);
    assert.equal(row?.kind === "DOCUMENT" ? row.document.processingStatus : "", "REVIEW_REQUIRED");
  });

  test("message filters run after the import-time window and the read stays bounded", async () => {
    const workspace = await createWorkspace(prisma, { name: `Volume ${++sequence}` });
    const deal = await dealIn(workspace.id, "Volume");
    const base = Date.UTC(2026, 0, 1);
    await prisma.sourceMessage.createMany({
      data: Array.from({ length: INBOX_MESSAGE_LIMIT + 1 }, (_, index) => ({
        workspaceId: workspace.id,
        dealId: deal.id,
        sourceType: "MANUAL" as const,
        subject: `Volume ${index}`,
        senderName: "Volume Sender",
        bodyText: "Bounded queue fixture.",
        createdAt: new Date(base + index * 1000),
      })),
    });
    const outside = await prisma.sourceMessage.findFirstOrThrow({ where: { dealId: deal.id, subject: "Volume 0" } });
    const inside = await prisma.sourceMessage.findFirstOrThrow({ where: { dealId: deal.id, subject: `Volume ${INBOX_MESSAGE_LIMIT}` } });
    await failedRun(workspace.id, outside.id, "outside-window");
    await failedRun(workspace.id, inside.id, "inside-window");
    await documentOn(deal.id, {
      originalFilename: "VolumeDoc.pdf",
      ingestionStatus: "COMPLETE",
      documentDate: new Date("2026-09-01T00:00:00.000Z"),
    });

    const counter = countQueries(prisma);
    const page = await getInbox(counter.prisma, { workspaceId: workspace.id });
    assert.ok(counter.queries <= 8, `expected a bounded read, saw ${counter.queries} queries`);
    assert.equal(page.messageWindow.truncated, true);
    assert.equal(page.messageWindow.loaded, INBOX_MESSAGE_LIMIT);
    assert.equal(page.messageWindow.limit, INBOX_MESSAGE_LIMIT);
    assert.equal(page.sourceCounts.MESSAGES, INBOX_MESSAGE_LIMIT);
    assert.equal(page.sourceCounts.DOCUMENTS, 1);
    assert.equal(page.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === outside.id), false);
    assert.equal(page.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === inside.id), true);
    assert.equal(page.sourceItems.some((item) => item.kind === "DOCUMENT"), true);

    const failed = await getInbox(prisma, { workspaceId: workspace.id, filter: "FAILED", source: "MESSAGES" });
    assert.deepEqual(failed.sourceItems.map((item) => item.kind === "MESSAGE" ? item.message.id : ""), [inside.id]);
    assert.equal(failed.counts.FAILED, 1);
    assert.equal(failed.sourceCounts.DOCUMENTS, 1);

    const exact = await createWorkspace(prisma, { name: `Exact ${++sequence}` });
    const exactDeal = await dealIn(exact.id, "Exact");
    await prisma.sourceMessage.createMany({
      data: Array.from({ length: INBOX_MESSAGE_LIMIT }, (_, index) => ({
        workspaceId: exact.id,
        dealId: exactDeal.id,
        sourceType: "MANUAL" as const,
        subject: `Exact ${index}`,
        bodyText: "Exact bound.",
        createdAt: new Date(base + index * 1000),
      })),
    });
    const atBound = await getInbox(prisma, { workspaceId: exact.id });
    assert.equal(atBound.messageWindow.truncated, false);
    assert.equal(atBound.messageWindow.loaded, INBOX_MESSAGE_LIMIT);

    const below = await createWorkspace(prisma, { name: `Below ${++sequence}` });
    const belowDeal = await dealIn(below.id, "Below");
    await prisma.sourceMessage.createMany({
      data: Array.from({ length: INBOX_MESSAGE_LIMIT - 1 }, (_, index) => ({
        workspaceId: below.id,
        dealId: belowDeal.id,
        sourceType: "MANUAL" as const,
        subject: `Below ${index}`,
        bodyText: "Below bound.",
        createdAt: new Date(base + index * 1000),
      })),
    });
    const under = await getInbox(prisma, { workspaceId: below.id });
    assert.equal(under.messageWindow.truncated, false);
    assert.equal(under.sourceCounts.MESSAGES, INBOX_MESSAGE_LIMIT - 1);
    assert.equal(under.sourceItems.length, INBOX_MESSAGE_LIMIT - 1);
  });
});

function kinds(page: InboxPageModel): Array<"DOCUMENT" | "MESSAGE"> {
  return page.sourceItems.map((item) => item.kind);
}

function names(page: InboxPageModel) {
  const map = new Map<string, { status: string; action: string; href: string; retry: boolean; label: string }>();
  for (const item of page.sourceItems) {
    if (item.kind !== "DOCUMENT") continue;
    map.set(item.document.document.originalFilename, {
      status: item.document.processingStatus,
      action: item.document.nextAction.label,
      href: item.document.nextAction.href,
      retry: item.document.canRetry,
      label: item.document.lifecycle.primaryLabel,
    });
  }
  return map;
}

async function dealIn(workspaceId: string, name: string) {
  return prisma.deal.create({
    data: {
      workspaceId,
      name: `${name} ${++sequence}`,
      company: "Acme Corp",
      property: "200 Clarendon",
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
      documentDate: overrides.documentDate === undefined ? new Date("2026-09-26T00:00:00.000Z") : overrides.documentDate,
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

async function messageOn(
  deal: { id: string; workspaceId: string },
  input: {
    subject: string;
    sentAt?: Date;
    runStatus?: "SUCCEEDED" | "FAILED";
    amount?: number;
    acknowledged?: boolean;
    confirmFact?: boolean;
  }
) {
  const message = await prisma.sourceMessage.create({
    data: {
      workspaceId: deal.workspaceId,
      dealId: deal.id,
      sourceType: "FIXTURE",
      sourceProvider: "inbox-correctness",
      externalMessageId: `inbox-${++sequence}`,
      subject: input.subject,
      senderName: "Derek Broker",
      senderAddress: "derek@example.test",
      sentAt: input.sentAt ?? null,
      bodyText: input.amount === undefined ? "Message body." : `Landlord proposes $${input.amount.toFixed(2)}/RSF/year.`,
    },
  });
  if (!input.runStatus) return { message, factId: null as string | null };
  const run = await prisma.activityExtractionRun.create({
    data: {
      workspaceId: deal.workspaceId,
      sourceMessageId: message.id,
      extractor: "fixture",
      extractorVersion: "inbox-correctness",
      contractVersion: "1",
      model: message.id,
      status: input.runStatus,
      failureCode: input.runStatus === "FAILED" ? "EXTRACTION_FAILED" : null,
      failureReason: input.runStatus === "FAILED" ? "Fixture extraction failure" : null,
      factCount: input.runStatus === "SUCCEEDED" && input.amount !== undefined ? 1 : 0,
      completedAt: input.sentAt ?? new Date("2026-09-01T00:00:00.000Z"),
    },
  });
  let factId: string | null = null;
  if (input.runStatus === "SUCCEEDED" && input.amount !== undefined) {
    const fact = await prisma.activityFact.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceMessageId: message.id,
        activityExtractionRunId: run.id,
        factType: "NEGOTIATION_VALUE",
        canonicalType: "BASE_RENT",
        side: "LANDLORD",
        assertionStatus: "PROPOSED",
        structuredPayload: { display: `$${input.amount.toFixed(2)} / RSF / year`, numeric: input.amount, unit: "USD_PER_RSF_YEAR", negotiation: null },
        evidenceQuote: `Landlord proposes $${input.amount.toFixed(2)}/RSF/year.`,
        provenanceStatus: "EXACT",
        extractionMethod: "DETERMINISTIC",
      },
    });
    factId = fact.id;
    if (input.confirmFact || input.acknowledged) {
      await prisma.activityFactReview.create({
        data: {
          workspaceId: deal.workspaceId,
          sourceMessageId: message.id,
          activityFactId: fact.id,
          state: "CONFIRMED",
          actor: "MANUAL_REVIEW",
        },
      });
    }
    if (input.acknowledged) {
      await prisma.messageReviewDecision.create({
        data: {
          workspaceId: deal.workspaceId,
          sourceMessageId: message.id,
          decision: "ACKNOWLEDGED",
          activityExtractionRunId: run.id,
          presentedFactIds: [fact.id],
          actor: "MANUAL_REVIEW",
        },
      });
    }
  }
  return { message, factId };
}

async function failedRun(workspaceId: string, sourceMessageId: string, model: string) {
  await prisma.activityExtractionRun.create({
    data: {
      workspaceId,
      sourceMessageId,
      extractor: "fixture",
      extractorVersion: "inbox-correctness",
      contractVersion: "1",
      model,
      status: "FAILED",
      failureCode: "EXTRACTION_FAILED",
      failureReason: "Fixture extraction failure",
      factCount: 0,
      completedAt: new Date("2026-01-02T00:00:00.000Z"),
    },
  });
}

function countQueries(client: PrismaClient): { prisma: PrismaClient; readonly queries: number } {
  const state = { queries: 0 };
  const wrapped = new Proxy(client, {
    get(target, prop, receiver) {
      const model = Reflect.get(target, prop, receiver);
      if (typeof model !== "object" || model === null || typeof prop === "symbol" || prop.startsWith("$")) return model;
      return new Proxy(model, {
        get(modelTarget, method, modelReceiver) {
          const fn = Reflect.get(modelTarget, method, modelReceiver);
          if (typeof fn !== "function") return fn;
          return (...args: unknown[]) => {
            state.queries += 1;
            return fn.apply(modelTarget, args);
          };
        },
      });
    },
  }) as PrismaClient;
  return {
    prisma: wrapped,
    get queries() {
      return state.queries;
    },
  };
}
