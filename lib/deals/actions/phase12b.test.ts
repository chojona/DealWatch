import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { analyzeSourceMessage, ingestSourceMessage } from "@/lib/messages/service";
import { reviewActivityFact } from "@/lib/messages/review";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { getDealActionState } from "./service";

const fixedNow = new Date("2026-09-29T16:00:00Z");

async function counts(db: PrismaClient, dealId: string) {
  return {
    facts: await db.activityFact.count(),
    terms: await db.negotiationTerm.count({ where: { round: { dealId } } }),
    events: await db.dealEvent.count({ where: { dealId } }),
    runs: await db.activityExtractionRun.count(),
    reviews: await db.activityFactReview.count(),
  };
}

describe("Phase 12B temporal normalization pipeline", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
  });

  test("Q unreviewed normalized evidence creates no Phase 11 obligation", async () => {
    const deal = await createTestDeal(db);
    const before = await counts(db, deal.id);
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send the rent roll by November 15, 2026 at 5:00 PM ET.",
      subject: "Rent roll",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-28T15:00:00Z"),
    });
    await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    const stored = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    const payload = stored.structuredPayload as { action?: { dueAt?: string | null; dueText?: string | null } };
    assert.equal(payload.action?.dueAt, "2026-11-15T17:00:00-05:00");
    assert.equal(payload.action?.dueText, "by November 15, 2026 at 5:00 PM ET");
    assert.equal(state?.court.value, "UNKNOWN");
    assert.equal(state?.actions.length, 0);
    assert.equal(state?.deadlines.length, 0);
    assert.equal(state?.meetings.length, 0);
    assert.equal(await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), before.terms);
  });

  test("R reviewed normalized evidence is consumed with provenance intact", async () => {
    const deal = await createTestDeal(db);
    const beforeTerms = await db.negotiationTerm.count();
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send the rent roll by November 15, 2026 at 5:00 PM ET.",
      subject: "Rent roll",
      sourceType: "MANUAL",
      senderAddress: "landlord@example.test",
      sentAt: new Date("2026-09-28T15:00:00Z"),
    });
    await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    const action = state?.outstandingActions[0];
    assert.equal(state?.court.value, "OUR_SIDE");
    assert.equal(action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(action?.dueAt, "2026-11-15T17:00:00-05:00");
    assert.equal(action?.dueText, "by November 15, 2026 at 5:00 PM ET");
    assert.equal(action?.confidence, "REVIEWED");
    assert.equal(action?.source.factId, fact.id);
    assert.equal(action?.source.messageId, message.id);
    assert.equal(action?.source.href, `/messages/${message.id}`);
    assert.equal(action?.source.evidenceQuote, "Please send the rent roll by November 15, 2026 at 5:00 PM ET.");
    assert.equal(action?.source.timestamp, "2026-09-28T15:00:00.000Z");
    assert.equal(state?.deadlines[0]?.dueAt, "2026-11-15T17:00:00-05:00");
    assert.equal(state?.deadlines[0]?.dueText, "by November 15, 2026 at 5:00 PM ET");
    assert.equal(await db.negotiationTerm.count(), beforeTerms);
  });

  test("AB court stays unknown when speaker direction is absent", async () => {
    const deal = await createTestDeal(db);
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send the rent roll by November 15, 2026 at 5:00 PM ET.",
      subject: "Rent roll",
      sourceType: "MANUAL",
      senderAddress: "landlord@example.test",
      sentAt: new Date("2026-09-28T15:00:00Z"),
    });
    await analyzeSourceMessage(db, message.id);
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.court.value, "UNKNOWN");
    assert.equal(state?.outstandingActions[0]?.dueAt, "2026-11-15T17:00:00-05:00");
    assert.equal(state?.outstandingActions[0]?.responsibleSide, "UNKNOWN");
  });

  test("S/T passed and approaching deadlines use existing Phase 11 timing", async () => {
    const deal = await createTestDeal(db);
    const bodies = [
      "Please send the rent roll by September 21, 2026 at 3:00 PM ET.",
      "Please send the insurance certificate by October 1, 2026 at 12:00 PM ET.",
      "Please send the budget by October 9, 2026 at 12:00 PM ET.",
    ];
    for (const bodyText of bodies) {
      const message = await ingestSourceMessage(db, {
        dealId: deal.id,
        bodyText,
        subject: "Deadline",
        sourceType: "MANUAL",
        sentAt: new Date("2026-09-20T15:00:00Z"),
      });
      await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
      const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
      await reviewActivityFact(db, {
        sourceMessageId: message.id,
        activityFactId: fact.id,
        state: "CONFIRMED",
        expectedWorkspaceId: deal.workspaceId,
      });
    }
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    const past = state?.actions.find((action) => action.dueText?.includes("September 21"));
    const approaching = state?.deadlines.find((deadline) => deadline.dueText?.includes("October 1"));
    const later = state?.deadlines.find((deadline) => deadline.dueText?.includes("October 9"));
    const approachingAction = state?.actions.find((action) => action.dueText?.includes("October 1"));
    const laterAction = state?.actions.find((action) => action.dueText?.includes("October 9"));
    assert.equal(past?.dueAt, "2026-09-21T15:00:00-04:00");
    assert.equal(past?.timingLabel, "Past due");
    assert.equal(past?.priority, "DEADLINE_PASSED");
    assert.equal(approaching?.dueAt, "2026-10-01T12:00:00-04:00");
    assert.equal(approaching?.passed, false);
    assert.equal(approaching?.approaching, true);
    assert.equal(approaching?.timingLabel, "Deadline approaching");
    assert.equal(approachingAction?.priority, "DEADLINE_APPROACHING");
    assert.equal(later?.dueAt, "2026-10-09T12:00:00-04:00");
    assert.equal(later?.approaching, false);
    assert.equal(later?.timingLabel, "Upcoming");
    assert.equal(laterAction?.priority, "OUR_SIDE_RESPONSE");
  });

  test("U/V reviewed meetings normalize only when the occurrence is explicit", async () => {
    const deal = await createTestDeal(db);
    const explicit = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Let's meet November 15, 2026 at 2:00 PM ET.",
      subject: "Meeting",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-28T15:00:00Z"),
    });
    const vague = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Let's meet Tuesday.",
      subject: "Tuesday",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-28T15:00:00Z"),
    });
    await analyzeSourceMessage(db, explicit.id);
    await analyzeSourceMessage(db, vague.id);
    for (const messageId of [explicit.id, vague.id]) {
      const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: messageId } });
      await reviewActivityFact(db, {
        sourceMessageId: messageId,
        activityFactId: fact.id,
        state: "CONFIRMED",
        expectedWorkspaceId: deal.workspaceId,
      });
    }
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    const dated = state?.meetings.find((meeting) => meeting.occursAt === "2026-11-15T14:00:00-05:00");
    assert.ok(dated);
    assert.equal(dated.kind, "MEETING");
    assert.equal(dated.source.evidenceQuote, "Let's meet November 15, 2026 at 2:00 PM ET.");
    assert.equal(state?.deadlines.some((deadline) => deadline.dueAt === "2026-11-15T14:00:00-05:00"), false);
    assert.equal(state?.meetings.some((meeting) => meeting.source.evidenceQuote === "Let's meet Tuesday." && meeting.occursAt), false);
    const tuesday = state?.actions.find((action) => action.source.evidenceQuote === "Let's meet Tuesday.");
    assert.equal(tuesday?.dueAt, null);
  });

  test("X/Y/Z/AC/AD reads do not mutate negotiation, legacy activity, or court inputs", async () => {
    const deal = await createTestDeal(db);
    await db.negotiationRound.create({
      data: {
        dealId: deal.id,
        side: "LANDLORD",
        roundNumber: 1,
        documentName: "Landlord formal proposal",
        documentText: "Formal source",
        documentDate: new Date("2026-09-18T12:00:00Z"),
        sourceType: "PASTED_TEXT",
        terms: {
          create: {
            canonicalType: "BASE_RENT",
            normalizedValue: "$67.00 / RSF / year",
            normalizedNumeric: 67,
            normalizedUnit: "USD_PER_RSF_YEAR",
            rawValue: "$67.00",
            status: "PROPOSED",
            side: "LANDLORD",
            roundNumber: 1,
            confidence: 1,
            evidenceQuote: "Base rent is $67.00 per RSF.",
            provenanceStatus: "EXACT",
            structuredPayload: { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: 67 } },
          },
        },
      },
    });
    const legacy = await db.dealEvent.create({
      data: {
        dealId: deal.id,
        type: "EMAIL",
        description: "Execute lease by November 15, 2026 per landlord deadline. Landlord issued legacy counter at $72.50/RSF/year.",
        occurredAt: new Date("2026-09-16T12:00:00Z"),
        confidence: 1,
        evidenceQuote: "Base rent: $72.50/RSF/year. We need a lease execution by November 15, 2026.",
      },
    });
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "We need a lease execution by November 15, 2026 to fit our Q4 schedule. The legacy note mentioned November 15.",
      subject: "200 Clarendon historical note",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-20T12:00:00Z"),
    });
    await analyzeSourceMessage(db, message.id);
    const before = await counts(db, deal.id);
    const serviceSource = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
    const deriveSource = readFileSync(new URL("./derive.ts", import.meta.url), "utf8");
    const temporalSource = readFileSync(new URL("../../ai/activity/temporal.ts", import.meta.url), "utf8");
    assert.equal(serviceSource.includes("openai"), false);
    assert.equal(serviceSource.includes("extractActivityFacts"), false);
    assert.equal(deriveSource.includes("openai"), false);
    assert.equal(deriveSource.includes("normalizeTemporalEvidence"), false);
    assert.equal(deriveSource.includes("bodyText"), false);
    assert.equal(temporalSource.includes("openai"), false);
    const first = await getDealActionState(db, deal.id, { now: fixedNow });
    const second = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.deepEqual(second, first);
    assert.equal(first?.court.value, "UNKNOWN");
    assert.equal(first?.actions.length, 0);
    assert.equal(first?.deadlines.length, 0);
    assert.deepEqual(await counts(db, deal.id), before);
    const workspace = await getNegotiationWorkspace(db, deal.id);
    const rent = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(workspace?.summary.conflictCount, 0);
    assert.match(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : "", /67\.00/);
    const legacyAfter = await db.dealEvent.findFirstOrThrow({ where: { id: legacy.id } });
    assert.match(legacyAfter.description, /72\.50/);
    assert.match(legacyAfter.description, /November 15, 2026/);
    assert.equal(legacyAfter.evidenceQuote, "Base rent: $72.50/RSF/year. We need a lease execution by November 15, 2026.");
    assert.equal(await db.activityFact.count({ where: { dealEventId: legacy.id } }), 0);
    assert.equal(await db.activityFact.count({ where: { sourceMessageId: message.id, factType: "DEADLINE" } }), 0);
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
