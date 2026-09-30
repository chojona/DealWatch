import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { reviewActivityFact } from "@/lib/messages/review";
import { getDealBrief } from "./service";
import { BRIEF_SECTION_CAPS, hiddenCount } from "./presentation";

const fixedNow = new Date("2026-09-29T16:00:00Z");

async function statusRound(
  db: PrismaClient,
  dealId: string,
  input: {
    canonicalType: string;
    status: "PROPOSED" | "AGREED" | "REJECTED" | "WITHDRAWN" | "UNRESOLVED";
    date: string;
    roundNumber: number;
  }
) {
  return db.negotiationRound.create({
    data: {
      dealId,
      side: "LANDLORD",
      roundNumber: input.roundNumber,
      documentName: `${input.canonicalType} ${input.status}`,
      documentText: "Formal source",
      documentDate: new Date(input.date),
      sourceType: "PASTED_TEXT",
      terms: {
        create: [{
          canonicalType: input.canonicalType,
          normalizedValue: input.canonicalType,
          rawValue: input.canonicalType,
          status: input.status,
          side: "LANDLORD",
          roundNumber: input.roundNumber,
          confidence: 1,
          evidenceQuote: `${input.canonicalType} is ${input.status}`,
          provenanceStatus: "EXACT",
        }],
      },
    },
  });
}

describe("Deal Brief status, counts, and truncation", { concurrency: 1 }, () => {
  test("rejected and withdrawn formal terms stay out of openCount and use explicit attention", async () => {
    const database = await createTestDatabase();
    const db = database.prisma;
    try {
      const deal = await createTestDeal(db);
      const rounds: Array<{
        canonicalType: string;
        status: "PROPOSED" | "AGREED" | "REJECTED" | "WITHDRAWN" | "UNRESOLVED";
      }> = [
        { canonicalType: "BASE_RENT", status: "PROPOSED" },
        { canonicalType: "TI_ALLOWANCE", status: "UNRESOLVED" },
        { canonicalType: "LEASE_TERM", status: "AGREED" },
        { canonicalType: "FREE_RENT", status: "REJECTED" },
        { canonicalType: "SECURITY_DEPOSIT", status: "WITHDRAWN" },
        { canonicalType: "PARKING", status: "PROPOSED" },
        { canonicalType: "RENEWAL_OPTIONS", status: "PROPOSED" },
        { canonicalType: "EXPANSION_RIGHTS", status: "PROPOSED" },
        { canonicalType: "ASSIGNMENT_SUBLETTING", status: "PROPOSED" },
        { canonicalType: "DELIVERY_CONDITION", status: "PROPOSED" },
      ];
      for (const [index, round] of rounds.entries()) {
        await statusRound(db, deal.id, {
          ...round,
          roundNumber: index + 1,
          date: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
        });
      }

      for (let index = 0; index < 8; index += 1) {
        await db.sourceMessage.create({
          data: {
            workspaceId: deal.workspaceId,
            dealId: deal.id,
            sourceType: "FIXTURE",
            sourceProvider: "brief-correctness",
            externalMessageId: `brief-message-${index}`,
            subject: `Communication ${index}`,
            senderName: "Derek Broker",
            senderAddress: "derek@example.test",
            sentAt: new Date(`2026-09-${String(index + 10).padStart(2, "0")}T12:00:00Z`),
            bodyText: "Message evidence",
          },
        });
      }
      await db.sourceMessage.create({
        data: {
          workspaceId: deal.workspaceId,
          dealId: deal.id,
          sourceType: "FIXTURE",
          sourceProvider: "brief-correctness",
          externalMessageId: "brief-failed-message",
          subject: "Failed analysis",
          senderName: "Derek Broker",
          senderAddress: "derek@example.test",
          sentAt: new Date("2026-09-20T12:00:00Z"),
          bodyText: "Analysis failed.",
          extractionRuns: {
            create: {
              workspaceId: deal.workspaceId,
              extractor: "fixture",
              extractorVersion: "brief",
              contractVersion: "1",
              model: "brief-failed-message",
              status: "FAILED",
              failureCode: "EXTRACTION_FAILED",
              failureReason: "Fixture extraction failure",
              factCount: 0,
              completedAt: new Date("2026-09-20T12:00:00Z"),
            },
          },
        },
      });
      await db.document.create({
        data: {
          dealId: deal.id,
          filename: "failed-proposal.pdf",
          originalFilename: "failed-proposal.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          sha256: "c".repeat(64),
          documentType: "PROPOSAL",
          documentDate: new Date("2026-09-19T12:00:00Z"),
          negotiationSide: "LANDLORD",
          ingestionStatus: "FAILED",
          failureCode: "ANALYSIS_FAILED",
          failureReason: "Fixture document failure",
          storageKey: `${"c".repeat(64)}/failed-proposal.pdf`,
          graphExtractionStatus: "SUCCEEDED",
          pages: { create: [{ pageNumber: 1, text: "Failed." }] },
        },
      });

      const staleAt = new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000);
      const staleMessage = await db.sourceMessage.create({
        data: {
          workspaceId: deal.workspaceId,
          dealId: deal.id,
          sourceType: "FIXTURE",
          sourceProvider: "brief-correctness",
          externalMessageId: "stale-action",
          subject: "Stale follow-up",
          senderName: "Derek Broker",
          senderAddress: "derek@example.test",
          sentAt: staleAt,
          bodyText: "Please send the exhibits.",
        },
      });
      const staleRun = await db.activityExtractionRun.create({
        data: {
          workspaceId: deal.workspaceId,
          sourceMessageId: staleMessage.id,
          extractor: "fixture",
          extractorVersion: "brief",
          contractVersion: "1",
          model: "stale-action",
          status: "SUCCEEDED",
          factCount: 1,
          completedAt: staleAt,
        },
      });
      const stalePayload: Prisma.InputJsonValue = {
        display: "Structured fact",
        numeric: null,
        unit: null,
        negotiation: null,
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
      };
      const staleFact = await db.activityFact.create({
        data: {
          workspaceId: deal.workspaceId,
          dealId: deal.id,
          sourceMessageId: staleMessage.id,
          activityExtractionRunId: staleRun.id,
          factType: "OTHER",
          side: "UNKNOWN",
          assertionStatus: "PROPOSED",
          structuredPayload: stalePayload,
          evidenceQuote: "Please send the exhibits.",
          provenanceStatus: "EXACT",
          extractionMethod: "DETERMINISTIC",
          extractorVersion: "brief",
          model: "stale-action",
        },
      });
      await reviewActivityFact(db, {
        sourceMessageId: staleMessage.id,
        activityFactId: staleFact.id,
        state: "CONFIRMED",
        expectedWorkspaceId: deal.workspaceId,
      });

      const brief = await getDealBrief(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow });
      assert.ok(brief);
      const byType = new Map(brief.negotiation.terms.map((term) => [term.canonicalType, term]));
      assert.equal(byType.get("FREE_RENT")?.status, "REJECTED");
      assert.equal(byType.get("FREE_RENT")?.briefStatus, "REJECTED");
      assert.equal(byType.get("FREE_RENT")?.statusLabel, "Rejected");
      assert.notEqual(byType.get("FREE_RENT")?.statusLabel, "Open");
      assert.equal(byType.get("SECURITY_DEPOSIT")?.status, "WITHDRAWN");
      assert.equal(byType.get("SECURITY_DEPOSIT")?.briefStatus, "WITHDRAWN");
      assert.equal(byType.get("SECURITY_DEPOSIT")?.statusLabel, "Withdrawn");
      assert.notEqual(byType.get("SECURITY_DEPOSIT")?.statusLabel, "Open");
      assert.equal(byType.get("BASE_RENT")?.briefStatus, "OPEN");
      assert.equal(byType.get("TI_ALLOWANCE")?.briefStatus, "OPEN");
      assert.equal(byType.get("LEASE_TERM")?.briefStatus, "AGREED");
      assert.equal(brief.negotiation.summary.openCount, 7);
      assert.equal(brief.negotiation.summary.rejectedCount, 1);
      assert.equal(brief.negotiation.summary.withdrawnCount, 1);

      assert.equal(brief.productAttention.some((item) => item.type === "NEGOTIATION_REJECTED"), false);
      assert.equal(brief.productAttention.some((item) => item.type === "NEGOTIATION_WITHDRAWN"), false);
      assert.equal(brief.productAttention.some((item) => item.type === "NEGOTIATION_UNRESOLVED"), false);
      assert.equal(brief.productAttention.some((item) => item.label === "Base rent remains open"), false);
      assert.equal(brief.productAttention.some((item) => item.label === "TI allowance is unresolved"), false);
      assert.equal(brief.productAttention.some((item) => item.label === "Free rent / abatement was rejected"), false);
      assert.equal(brief.productAttention.some((item) => item.label === "Security deposit was withdrawn"), false);

      const attentionHidden = hiddenCount(brief.preview.attention.total, BRIEF_SECTION_CAPS.attention);
      assert.equal(brief.preview.attention.total, brief.productAttention.length);
      assert.equal(attentionHidden, Math.max(0, brief.productAttention.length - BRIEF_SECTION_CAPS.attention));
      assert.deepEqual(
        brief.productAttention.map((item) => item.id),
        [...brief.productAttention].sort((left, right) => left.priority - right.priority
          || (right.timestamp ?? "").localeCompare(left.timestamp ?? "")
          || left.id.localeCompare(right.id)).map((item) => item.id)
      );

      assert.ok(brief.preview.changes.total > BRIEF_SECTION_CAPS.changes);
      assert.equal(
        hiddenCount(brief.preview.changes.total, BRIEF_SECTION_CAPS.changes),
        brief.preview.changes.total - BRIEF_SECTION_CAPS.changes
      );
      assert.ok(brief.preview.changes.returned <= brief.preview.changes.total);

      assert.equal(brief.preview.communications.total, 10);
      assert.equal(
        hiddenCount(brief.preview.communications.total, BRIEF_SECTION_CAPS.communications),
        4
      );
      assert.ok(brief.preview.communications.returned <= brief.preview.communications.total);

      assert.ok(brief.preview.timeline.total > BRIEF_SECTION_CAPS.timeline);
      assert.equal(brief.preview.timeline.returned, Math.min(brief.preview.timeline.total, 16));
      assert.equal(
        hiddenCount(brief.preview.timeline.total, BRIEF_SECTION_CAPS.timeline),
        brief.preview.timeline.total - BRIEF_SECTION_CAPS.timeline
      );

      assert.equal(brief.productAttention.some((item) => item.type === "MESSAGE_ANALYSIS_FAILED" || item.type === "DOCUMENT_ANALYSIS_FAILED"), false);
      assert.ok(brief.systemAttention.some((item) => item.type === "MESSAGE_ANALYSIS_FAILED" && item.category === "SYSTEM_REVIEW"));
      assert.ok(brief.systemAttention.some((item) => item.type === "DOCUMENT_ANALYSIS_FAILED" && item.category === "SYSTEM_REVIEW"));

      const stale = brief.actions.outstandingActions.find((action) => action.description === "Please send the exhibits.");
      assert.equal(stale?.stale, true);

      const foreign = await db.workspace.create({ data: { name: "Foreign correctness workspace" } });
      assert.equal(await getDealBrief(db, deal.id, { expectedWorkspaceId: foreign.id, now: fixedNow }), null);
      const isolated = await getDealBrief(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow });
      assert.equal(isolated?.negotiation.summary.openCount, brief.negotiation.summary.openCount);
    } finally {
      await database.cleanup();
    }
  });
});
