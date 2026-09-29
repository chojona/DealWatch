import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { analyzeSourceMessage, ingestSourceMessage } from "@/lib/messages/service";
import { reviewActivityFact } from "@/lib/messages/review";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { deriveDealActionState } from "./derive";
import { getDealActionState } from "./service";

const fixedNow = new Date("2026-09-29T16:00:00Z");

describe("Phase 12A action directive pipeline", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
  });

  test("P extraction alone does not create a reviewed Phase 11 obligation", async () => {
    const deal = await createTestDeal(db);
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send us the revised proposal by Friday.",
      subject: "Proposal request",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-28T15:00:00Z"),
    });
    await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.ok(state);
    assert.equal(state.court.value, "UNKNOWN");
    assert.equal(state.actions.length, 0);
    assert.equal(state.outstandingActions.length, 0);
    const stored = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    const payload = stored.structuredPayload as { action?: { kind?: string } };
    assert.equal(payload.action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(stored.factType, "OTHER");
  });

  test("Q/R reviewed evidence is consumed with provenance intact", async () => {
    const deal = await createTestDeal(db);
    const beforeTerms = await db.negotiationTerm.count();
    const beforeEvents = await db.dealEvent.count();
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send us the revised proposal by Friday.",
      subject: "Proposal request",
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
    assert.equal(state?.court.value, "OUR_SIDE");
    const action = state?.outstandingActions[0];
    assert.equal(action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(action?.responsibleSide, "OUR_SIDE");
    assert.equal(action?.dueText, "by Friday");
    assert.equal(action?.dueAt, null);
    assert.equal(action?.confidence, "REVIEWED");
    assert.equal(action?.status, "OPEN");
    assert.equal(action?.source.factId, fact.id);
    assert.equal(action?.source.messageId, message.id);
    assert.equal(action?.source.href, `/messages/${message.id}`);
    assert.equal(action?.source.evidenceQuote, "Please send us the revised proposal by Friday.");
    assert.equal(action?.source.timestamp, "2026-09-28T15:00:00.000Z");
    assert.equal(await db.negotiationTerm.count(), beforeTerms);
    assert.equal(await db.dealEvent.count(), beforeEvents);
  });

  test("S/T/U/V/W reads do not mutate negotiation, activity, or the rent split", async () => {
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
        description: "Landlord issued legacy counter at $72.50/RSF/year.",
        occurredAt: new Date("2026-09-16T12:00:00Z"),
        confidence: 1,
        evidenceQuote: "Base rent: $72.50/RSF/year",
      },
    });
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "We discussed sending a proposal. The legacy note mentioned November 15.",
      subject: "Historical note",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-20T12:00:00Z"),
    });
    await analyzeSourceMessage(db, message.id);
    const before = {
      facts: await db.activityFact.count(),
      terms: await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }),
      events: await db.dealEvent.count({ where: { dealId: deal.id } }),
      runs: await db.activityExtractionRun.count(),
    };
    const serviceSource = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
    const deriveSource = readFileSync(new URL("./derive.ts", import.meta.url), "utf8");
    assert.equal(serviceSource.includes("openai"), false);
    assert.equal(serviceSource.includes("extractActivityFacts"), false);
    assert.equal(deriveSource.includes("openai"), false);
    assert.equal(deriveSource.includes("bodyText"), false);
    const first = await getDealActionState(db, deal.id, { now: fixedNow });
    const second = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.deepEqual(second, first);
    assert.equal(first?.court.value, "UNKNOWN");
    assert.equal(first?.actions.length, 0);
    const derived = deriveDealActionState({
      now: fixedNow,
      facts: [],
      openTerms: [],
      changes: [],
      discrepancies: [],
    });
    assert.deepEqual(deriveDealActionState({
      now: fixedNow,
      facts: [],
      openTerms: [],
      changes: [],
      discrepancies: [],
    }), derived);
    assert.deepEqual({
      facts: await db.activityFact.count(),
      terms: await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }),
      events: await db.dealEvent.count({ where: { dealId: deal.id } }),
      runs: await db.activityExtractionRun.count(),
    }, before);
    const workspace = await getNegotiationWorkspace(db, deal.id);
    const rent = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(workspace?.summary.conflictCount, 0);
    assert.match(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : "", /67\.00/);
    const legacyAfter = await db.dealEvent.findFirstOrThrow({ where: { id: legacy.id } });
    assert.match(legacyAfter.description, /72\.50/);
    assert.equal(legacyAfter.evidenceQuote, "Base rent: $72.50/RSF/year");
    assert.equal(await db.activityFact.count({ where: { dealEventId: legacy.id } }), 0);
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
