import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getDealActionState } from "@/lib/deals/actions/service";
import { getDealBrief } from "@/lib/deals/brief/service";
import { getDealIntelligence } from "@/lib/deals/intelligence/service";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { reviewActivityFact } from "@/lib/messages/review";
import { filterNegotiationTerms, getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";

const fixedNow = new Date("2026-09-29T16:00:00Z");

async function statusRound(
  db: PrismaClient,
  dealId: string,
  input: {
    canonicalType: string;
    status: "PROPOSED" | "AGREED" | "REJECTED" | "WITHDRAWN" | "UNRESOLVED";
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
      documentDate: new Date(`2026-09-${String(input.roundNumber).padStart(2, "0")}T12:00:00Z`),
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

describe("Formal status consistency across surfaces", { concurrency: 1 }, () => {
  test("Brief, Negotiation, overview, and meeting prep share one open set", async () => {
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
      ];
      for (const [index, round] of rounds.entries()) {
        await statusRound(db, deal.id, { ...round, roundNumber: index + 1 });
      }

      const message = await db.sourceMessage.create({
        data: {
          workspaceId: deal.workspaceId,
          dealId: deal.id,
          sourceType: "FIXTURE",
          sourceProvider: "formal-status-test",
          externalMessageId: "formal-status-meeting",
          subject: "Prep meeting",
          senderName: "Alex",
          senderAddress: "alex@example.test",
          bodyText: "Meeting next week.",
          sentAt: new Date("2026-09-25T15:00:00Z"),
        },
      });
      const run = await db.activityExtractionRun.create({
        data: {
          workspaceId: deal.workspaceId,
          sourceMessageId: message.id,
          extractor: "fixture",
          extractorVersion: "formal-status",
          contractVersion: "1",
          model: "deterministic-fixture",
          status: "SUCCEEDED",
          factCount: 1,
          completedAt: new Date("2026-09-25T15:00:00Z"),
        },
      });
      const fact = await db.activityFact.create({
        data: {
          workspaceId: deal.workspaceId,
          dealId: deal.id,
          sourceMessageId: message.id,
          activityExtractionRunId: run.id,
          factType: "MEETING",
          side: "UNKNOWN",
          assertionStatus: "PROPOSED",
          structuredPayload: {
            display: "Negotiation meeting",
            numeric: null,
            unit: null,
            negotiation: null,
            action: {
              kind: "SCHEDULED",
              responsibleSide: "UNKNOWN",
              responsibleLabel: null,
              counterpartyLabel: null,
              dueAt: null,
              dueText: null,
              occursAt: "2026-10-03T15:00:00Z",
              fulfillsFactId: null,
            },
          } satisfies Prisma.InputJsonValue,
          evidenceQuote: "Meeting next week.",
          provenanceStatus: "EXACT",
          extractionMethod: "DETERMINISTIC",
          extractorVersion: "formal-status",
          model: "deterministic-fixture",
        },
      });
      await reviewActivityFact(db, {
        sourceMessageId: message.id,
        activityFactId: fact.id,
        state: "CONFIRMED",
        expectedWorkspaceId: deal.workspaceId,
      });

      const [brief, workspace, actions, intelligence] = await Promise.all([
        getDealBrief(db, deal.id, { now: fixedNow }),
        getNegotiationWorkspace(db, deal.id),
        getDealActionState(db, deal.id, { now: fixedNow }),
        getDealIntelligence(db, deal.id),
      ]);
      assert.ok(brief);
      assert.ok(workspace);
      assert.ok(actions);
      assert.ok(intelligence);

      const openTypes = ["BASE_RENT", "TI_ALLOWANCE"];
      const prep = actions.preparation[0];
      assert.ok(prep);
      const prepTypes = prep.openTerms.map((term) => term.canonicalType).sort();
      const overviewTypes = intelligence.openItems.map((item) => item.canonicalType).sort();
      const filterTypes = filterNegotiationTerms(workspace.terms, "OPEN").map((term) => term.canonicalType).sort();

      assert.equal(brief.negotiation.summary.openCount, 2);
      assert.equal(workspace.summary.openCount, brief.negotiation.summary.openCount);
      assert.equal(workspace.unresolvedCount, brief.negotiation.summary.openCount);
      assert.equal(intelligence.health.openTermCount, brief.negotiation.summary.openCount);
      assert.deepEqual(prepTypes, openTypes);
      assert.deepEqual(overviewTypes, openTypes);
      assert.deepEqual(filterTypes, openTypes);
      assert.equal(prep.openTerms.some((term) => term.status === "REJECTED" || term.status === "WITHDRAWN"), false);

      const rejected = workspace.terms.find((term) => term.canonicalType === "FREE_RENT");
      const withdrawn = workspace.terms.find((term) => term.canonicalType === "SECURITY_DEPOSIT");
      assert.equal(rejected?.status, "REJECTED");
      assert.equal(rejected?.history.length, 1);
      assert.equal(withdrawn?.status, "WITHDRAWN");
      assert.equal(withdrawn?.history.length, 1);
      assert.equal(brief.negotiation.terms.find((term) => term.canonicalType === "FREE_RENT")?.status, "REJECTED");
      assert.equal(brief.negotiation.terms.find((term) => term.canonicalType === "SECURITY_DEPOSIT")?.status, "WITHDRAWN");
    } finally {
      await database.cleanup();
    }
  });
});
