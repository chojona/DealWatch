import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { GET as getBriefRoute } from "@/app/api/deals/[id]/brief/route";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { DealBriefQueryError, parseDealBriefPageQuery, parseDealBriefQuery } from "./query";
import { getDealBrief } from "./service";

const boundary = new Date("2026-09-29T10:00:00Z");
const now = new Date("2026-09-29T12:00:00Z");

function negotiationPayload(amount: number): Prisma.InputJsonValue {
  return {
    display: `$${amount.toFixed(2)} / RSF / year`,
    numeric: amount,
    unit: "USD_PER_RSF_YEAR",
    negotiation: null,
  };
}

const actionPayload: Prisma.InputJsonValue = {
  display: "Send the revised proposal",
  numeric: null,
  unit: null,
  negotiation: null,
  action: {
    kind: "INFORMATION_REQUESTED",
    responsibleSide: "OUR_SIDE",
    responsibleLabel: "Leasing team",
    counterpartyLabel: null,
    dueAt: null,
    dueText: null,
    occursAt: null,
    fulfillsFactId: null,
  },
};

async function addFormalPosition(db: PrismaClient, dealId: string) {
  return db.negotiationRound.create({
    data: {
      dealId,
      side: "LANDLORD",
      roundNumber: 1,
      documentName: "Landlord proposal at $67",
      documentText: "Base rent is $67.00 / RSF / year.",
      documentDate: new Date("2026-09-29T09:30:00Z"),
      sourceType: "PASTED_TEXT",
      createdAt: new Date("2026-09-29T09:30:00Z"),
      terms: {
        create: [{
          canonicalType: "BASE_RENT",
          normalizedValue: "$67.00 / RSF / year",
          normalizedNumeric: 67,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: "$67.00 / RSF / year",
          status: "PROPOSED",
          side: "LANDLORD",
          roundNumber: 1,
          confidence: 1,
          evidenceQuote: "Base rent is $67.00 / RSF / year.",
          provenanceStatus: "EXACT",
          structuredPayload: {
            termType: "BASE_RENT",
            rent: { kind: "simple", amountPerRSFYear: 67 },
          },
          createdAt: new Date("2026-09-29T09:30:00Z"),
        }],
      },
    },
  });
}

async function addMessage(
  db: PrismaClient,
  deal: { id: string; workspaceId: string },
  input: {
    key: string;
    subject: string;
    sentAt: string;
    reviewAt?: string;
    amount?: number;
    action?: boolean;
    failed?: boolean;
  }
) {
  const sentAt = new Date(input.sentAt);
  const message = await db.sourceMessage.create({
    data: {
      workspaceId: deal.workspaceId,
      dealId: deal.id,
      sourceType: "FIXTURE",
      sourceProvider: "project-8-catch-up",
      externalMessageId: input.key,
      subject: input.subject,
      senderName: "Derek Broker",
      senderAddress: "derek@example.test",
      sentAt,
      createdAt: sentAt,
      bodyText: input.failed ? "Analysis could not complete." : input.subject,
    },
  });
  const run = await db.activityExtractionRun.create({
    data: {
      workspaceId: deal.workspaceId,
      sourceMessageId: message.id,
      extractor: "fixture",
      extractorVersion: "project-8",
      contractVersion: "1",
      model: input.key,
      status: input.failed ? "FAILED" : "SUCCEEDED",
      failureCode: input.failed ? "EXTRACTION_FAILED" : null,
      failureReason: input.failed ? "Deterministic fixture failure" : null,
      factCount: Number(input.amount !== undefined) + Number(Boolean(input.action)),
      createdAt: sentAt,
      completedAt: sentAt,
    },
  });
  const reviewedFactIds: string[] = [];
  if (input.amount !== undefined) {
    const fact = await db.activityFact.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceMessageId: message.id,
        activityExtractionRunId: run.id,
        factType: "NEGOTIATION_VALUE",
        canonicalType: "BASE_RENT",
        side: "LANDLORD",
        assertionStatus: "PROPOSED",
        structuredPayload: negotiationPayload(input.amount),
        evidenceQuote: `Landlord proposes $${input.amount.toFixed(2)} / RSF / year.`,
        provenanceStatus: "EXACT",
        extractionMethod: "DETERMINISTIC",
        extractorVersion: "project-8",
        model: input.key,
        createdAt: sentAt,
      },
    });
    reviewedFactIds.push(fact.id);
  }
  if (input.action) {
    const fact = await db.activityFact.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceMessageId: message.id,
        activityExtractionRunId: run.id,
        factType: "OTHER",
        side: "UNKNOWN",
        assertionStatus: "PROPOSED",
        structuredPayload: actionPayload,
        evidenceQuote: "Please send the revised proposal.",
        provenanceStatus: "EXACT",
        extractionMethod: "DETERMINISTIC",
        extractorVersion: "project-8",
        model: input.key,
        createdAt: sentAt,
      },
    });
    reviewedFactIds.push(fact.id);
  }
  if (input.reviewAt) {
    for (const activityFactId of reviewedFactIds) {
      await db.activityFactReview.create({
        data: {
          workspaceId: deal.workspaceId,
          sourceMessageId: message.id,
          activityFactId,
          state: "CONFIRMED",
          actor: "MANUAL_REVIEW",
          createdAt: new Date(input.reviewAt),
        },
      });
    }
  }
  return { message, reviewedFactIds };
}

describe("Deal Brief catch-up correctness", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;
  let deal: Awaited<ReturnType<typeof createTestDeal>>;
  let oldComparisonFactId: string;
  let oldActionFactId: string;
  let exactMessageId: string;
  let afterMessageId: string;
  let laterMessageId: string;
  let failedMessageId: string;

  test("setup deterministic events before, at, and after the catch-up boundary", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
    deal = await createTestDeal(db);
    await addFormalPosition(db, deal.id);

    const old = await addMessage(db, deal, {
      key: "before",
      subject: "09:00 old rent communication",
      sentAt: "2026-09-29T09:00:00Z",
      reviewAt: "2026-09-29T09:10:00Z",
      amount: 72,
      action: true,
    });
    [oldComparisonFactId, oldActionFactId] = old.reviewedFactIds;
    await db.sourceMessage.createMany({
      data: Array.from({ length: 99 }, (_, index) => ({
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceType: "FIXTURE" as const,
        sourceProvider: "project-8-catch-up",
        externalMessageId: `historical-${index}`,
        subject: `Historical communication ${index}`,
        senderName: "Derek Broker",
        senderAddress: "derek@example.test",
        sentAt: new Date(`2026-09-28T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`),
        createdAt: new Date(`2026-09-28T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`),
        bodyText: "Historical message outside the catch-up window.",
      })),
    });
    const exact = await addMessage(db, deal, {
      key: "boundary",
      subject: "10:00 boundary communication",
      sentAt: "2026-09-29T10:00:00Z",
      reviewAt: "2026-09-29T10:00:00Z",
      amount: 71,
    });
    exactMessageId = exact.message.id;
    const afterMessage = await addMessage(db, deal, {
      key: "after",
      subject: "10:30 new rent and action communication",
      sentAt: "2026-09-29T10:30:00Z",
      reviewAt: "2026-09-29T11:30:00Z",
      amount: 74,
      action: true,
    });
    afterMessageId = afterMessage.message.id;
    const laterMessage = await addMessage(db, deal, {
      key: "later",
      subject: "11:00 later communication",
      sentAt: "2026-09-29T11:00:00Z",
    });
    laterMessageId = laterMessage.message.id;
    const failure = await addMessage(db, deal, {
      key: "processing-failure",
      subject: "11:45 processing failure",
      sentAt: "2026-09-29T11:45:00Z",
      failed: true,
    });
    failedMessageId = failure.message.id;

    const document = await db.document.create({
      data: {
        dealId: deal.id,
        filename: "historical-paper.pdf",
        originalFilename: "historical-paper.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        sha256: "8".repeat(64),
        documentType: "PROPOSAL",
        documentDate: new Date("2026-09-15T00:00:00Z"),
        negotiationSide: "LANDLORD",
        ingestionStatus: "COMPLETE",
        storageKey: `project-8/${deal.id}/historical-paper.pdf`,
        graphExtractionStatus: "SUCCEEDED",
        createdAt: new Date("2026-09-29T09:00:00Z"),
      },
    });
    await db.documentMilestone.create({
      data: {
        documentId: document.id,
        kind: "ANALYZED",
        dedupeKey: `project-8:${document.id}:analyzed`,
        occurredAt: new Date("2026-09-29T10:15:00Z"),
      },
    });
  });

  test("accepts canonical and offset-aware instants and rejects malformed or impossible values", () => {
    assert.equal(
      parseDealBriefQuery(new URLSearchParams("since=2026-09-29T10%3A00%3A00Z")).since?.toISOString(),
      "2026-09-29T10:00:00.000Z"
    );
    assert.equal(
      parseDealBriefQuery(new URLSearchParams("since=2026-09-29T06%3A00%3A00-04%3A00")).since?.toISOString(),
      "2026-09-29T10:00:00.000Z"
    );
    for (const value of [
      "banana",
      "2026-09-29",
      "2026-02-30T10:00:00Z",
      "2026-09-29T25:00:00Z",
      "2026-09-29T10:00:00",
    ]) {
      assert.throws(
        () => parseDealBriefQuery(new URLSearchParams({ since: value })),
        (error) => error instanceof DealBriefQueryError
      );
    }
    assert.throws(
      () => parseDealBriefQuery(new URLSearchParams("since=2026-09-29T10%3A00%3A00Z&since=2026-09-29T11%3A00%3A00Z")),
      /since must be provided once/
    );
  });

  test("the Brief API returns the shared validation error before reading deal data", async () => {
    assert.deepEqual(parseDealBriefPageQuery({ since: "banana" }), {
      query: null,
      error: "since must be a valid offset-aware ISO-8601 date-time",
    });
    const response = await getBriefRoute(
      new NextRequest("http://dealwatch.test/api/deals/not-read/brief?since=banana"),
      { params: Promise.resolve({ id: "not-read" }) }
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "since must be a valid offset-aware ISO-8601 date-time",
    });
  });

  test("strictly filters communications, meaningful changes, timeline events, and their preview totals", async () => {
    const brief = await getDealBrief(db, deal.id, {
      expectedWorkspaceId: deal.workspaceId,
      since: boundary,
      now,
    });
    assert.ok(brief);
    assert.deepEqual(
      brief.communications.map((item) => item.id),
      [failedMessageId, laterMessageId, afterMessageId]
    );
    assert.equal(brief.communications.some((item) => item.id === exactMessageId), false);
    assert.equal(brief.preview.communications.returned, 3);
    assert.equal(brief.preview.communications.total, 3);

    assert.equal(brief.recentChanges.length, 2);
    assert.equal(brief.recentChanges.every((item) => new Date(item.timestamp) > boundary), true);
    assert.equal(brief.recentChanges.some((item) => item.source.id === exactMessageId), false);
    assert.equal(brief.recentChanges.some((item) => item.source.id === failedMessageId), false);
    assert.deepEqual(brief.preview.changes, { returned: 2, total: 2 });

    assert.deepEqual(
      brief.timeline.map((item) => item.id),
      [`communication:${failedMessageId}`, `communication:${laterMessageId}`, `communication:${afterMessageId}`]
    );
    assert.equal(brief.timeline.every((item) => new Date(item.occurredAt ?? item.recordedAt ?? 0) > boundary), true);
    assert.deepEqual(brief.preview.timeline, { returned: 3, total: 3 });
    assert.equal(brief.timeline.some((item) => item.type === "DOCUMENT_REVIEW" && item.title === "Analyzed"), false);
  });

  test("preserves formal state, outstanding actions, reconciliation, and processing issues", async () => {
    const brief = await getDealBrief(db, deal.id, {
      expectedWorkspaceId: deal.workspaceId,
      since: boundary,
      now,
    });
    assert.ok(brief);
    const rent = brief.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(rent?.landlordPosition?.kind, "VALUE");
    assert.match(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : "", /67/);
    assert.ok(brief.actions.outstandingActions.some((item) => item.source.factId === oldActionFactId));
    assert.ok(brief.comparisons.some((item) => item.communication.factId === oldComparisonFactId && item.outcome === "DIFFERS"));
    assert.ok(brief.systemAttention.some((item) => item.type === "MESSAGE_ANALYSIS_FAILED" && item.sourceId === failedMessageId));
    assert.equal(brief.productAttention.some((item) => item.type === "MESSAGE_ANALYSIS_FAILED"), false);
    assert.equal(brief.recentChanges.some((item) => item.source.id === failedMessageId), false);
  });

  test("a window after all activity is calm without becoming an empty deal", async () => {
    const since = new Date("2026-09-29T12:00:00Z");
    const brief = await getDealBrief(db, deal.id, {
      expectedWorkspaceId: deal.workspaceId,
      since,
      now,
    });
    assert.ok(brief);
    assert.deepEqual(brief.communications, []);
    assert.deepEqual(brief.recentChanges, []);
    assert.deepEqual(brief.timeline, []);
    assert.deepEqual(brief.preview.communications, { returned: 0, total: 0 });
    assert.deepEqual(brief.preview.changes, { returned: 0, total: 0 });
    assert.deepEqual(brief.preview.timeline, { returned: 0, total: 0 });
    assert.equal(brief.changeSummary.emptyState, "No meaningful changes since 2026-09-29T12:00:00.000Z.");
    assert.ok(brief.negotiation.terms.length > 0);
    assert.ok(brief.actions.outstandingActions.length > 0);
    assert.ok(brief.comparisons.length > 0);
    assert.ok(brief.systemAttention.some((item) => item.type === "MESSAGE_ANALYSIS_FAILED"));
  });

  test("workspace isolation still applies to catch-up reads", async () => {
    const foreign = await db.workspace.create({ data: { name: "Foreign catch-up workspace" } });
    assert.equal(await getDealBrief(db, deal.id, {
      expectedWorkspaceId: foreign.id,
      since: boundary,
      now,
    }), null);
  });

  after(async () => {
    await cleanup();
  });
});
