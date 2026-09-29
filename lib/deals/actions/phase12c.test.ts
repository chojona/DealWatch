import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { activityExtractionPrompt, deterministicExtractorIdentity } from "@/lib/ai/activity/extractActivityFacts";
import { ACTIVITY_EXTRACTOR_VERSION } from "@/lib/ai/activity/prompt";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { analyzeSourceMessage, ingestSourceMessage } from "@/lib/messages/service";
import { reviewActivityFact } from "@/lib/messages/review";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { getDealActionState } from "./service";

const fixedNow = new Date("2026-09-29T16:00:00Z");

function actionPayload(payload: unknown): { kind?: string; fulfillsFactId?: string | null; dueAt?: string | null; dueText?: string | null } | undefined {
  return (payload as { action?: { kind?: string; fulfillsFactId?: string | null; dueAt?: string | null; dueText?: string | null } }).action;
}

describe("Phase 12C explicit fulfillment pipeline", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
  });

  async function reviewedRequest(deal: { id: string; workspaceId: string }, body: string, sentAt: string) {
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: body,
      subject: "Request",
      sourceType: "MANUAL",
      senderAddress: "landlord@example.test",
      sentAt: new Date(sentAt),
    });
    await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
    const fact = await db.activityFact.findFirstOrThrow({
      where: { sourceMessageId: message.id },
      orderBy: { createdAt: "asc" },
    });
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    return { message, fact };
  }

  async function fulfill(dealId: string, body: string, sentAt: string) {
    const message = await ingestSourceMessage(db, {
      dealId,
      bodyText: body,
      subject: "Fulfillment",
      sourceType: "MANUAL",
      senderAddress: "tenant@example.test",
      sentAt: new Date(sentAt),
    });
    const first = await analyzeSourceMessage(db, message.id, { speakerSide: "OUR_SIDE" });
    const second = await analyzeSourceMessage(db, message.id, { speakerSide: "OUR_SIDE" });
    const facts = await db.activityFact.findMany({ where: { sourceMessageId: message.id } });
    return { message, first, second, facts };
  }

  test("A/U/V/W/X/Y explicit fulfillment stays open until review, then closes only the linked action", async () => {
    const deal = await createTestDeal(db);
    const proposal = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const insurance = await reviewedRequest(deal, "Please send the insurance certificate.", "2026-09-21T15:00:00Z");
    const beforeTerms = await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } });
    const sent = await fulfill(deal.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    assert.equal(sent.second.idempotent, true);
    assert.equal(sent.facts.length, 1);
    const fulfillment = sent.facts[0]!;
    const linked = actionPayload(fulfillment.structuredPayload);
    assert.equal(linked?.kind, "FULFILLMENT");
    assert.equal(linked?.fulfillsFactId, proposal.fact.id);
    assert.equal(fulfillment.assertionStatus, "ACCEPTED");
    assert.equal(fulfillment.provenanceStatus, "EXACT");
    assert.equal(fulfillment.evidenceQuote, "Attached is the revised proposal you requested.");

    const unreviewed = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(unreviewed?.actions.find((action) => action.source.factId === proposal.fact.id)?.status, "OPEN");
    assert.equal(unreviewed?.actions.find((action) => action.source.factId === proposal.fact.id)?.fulfillment, null);
    assert.equal(unreviewed?.outstandingActions.length, 2);

    await reviewActivityFact(db, {
      sourceMessageId: sent.message.id,
      activityFactId: fulfillment.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    const reviewed = await getDealActionState(db, deal.id, { now: fixedNow });
    const closed = reviewed?.actions.find((action) => action.source.factId === proposal.fact.id);
    const stillOpen = reviewed?.actions.find((action) => action.source.factId === insurance.fact.id);
    assert.equal(closed?.status, "CLOSED");
    assert.equal(closed?.source.evidenceQuote, "Please send the revised proposal.");
    assert.equal(closed?.source.messageId, proposal.message.id);
    assert.equal(closed?.source.href, `/messages/${proposal.message.id}`);
    assert.equal(closed?.fulfillment?.factId, fulfillment.id);
    assert.equal(closed?.fulfillment?.messageId, sent.message.id);
    assert.equal(closed?.fulfillment?.href, `/messages/${sent.message.id}`);
    assert.equal(closed?.fulfillment?.evidenceQuote, "Attached is the revised proposal you requested.");
    assert.equal(closed?.fulfillment?.timestamp, "2026-09-22T15:00:00.000Z");
    assert.equal(stillOpen?.status, "OPEN");
    assert.equal(stillOpen?.fulfillment, null);
    assert.equal(await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), beforeTerms);
  });

  test("B financials you requested links to the financials request only", async () => {
    const deal = await createTestDeal(db);
    const financials = await reviewedRequest(deal, "Please send the latest financials.", "2026-09-20T15:00:00Z");
    await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T16:00:00Z");
    const sent = await fulfill(deal.id, "Attached are the financials you requested.", "2026-09-22T15:00:00Z");
    assert.equal(actionPayload(sent.facts[0]?.structuredPayload)?.fulfillsFactId, financials.fact.id);
  });

  test("C/D/O delivery without an explicit reference does not link the only open action", async () => {
    const deal = await createTestDeal(db);
    const request = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const financials = await fulfill(deal.id, "Attached are the financials.", "2026-09-22T15:00:00Z");
    const proposal = await fulfill(deal.id, "Here is the proposal.", "2026-09-22T16:00:00Z");
    assert.equal(financials.facts.length, 0);
    assert.equal(proposal.facts.length, 0);
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.outstandingActions.length, 1);
    assert.equal(state?.outstandingActions[0]?.source.factId, request.fact.id);
  });

  test("E as requested links one identifiable reviewed request", async () => {
    const deal = await createTestDeal(db);
    const request = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const sent = await fulfill(deal.id, "Sending this as requested.", "2026-09-22T15:00:00Z");
    assert.equal(actionPayload(sent.facts[0]?.structuredPayload)?.fulfillsFactId, request.fact.id);
  });

  test("F two proposal requests produce fulfillment evidence with no automatic link", async () => {
    const deal = await createTestDeal(db);
    const revised = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const updated = await reviewedRequest(deal, "Please send the updated proposal.", "2026-09-20T16:00:00Z");
    const sent = await fulfill(deal.id, "Attached is the proposal you requested.", "2026-09-22T15:00:00Z");
    assert.equal(sent.facts.length, 1);
    assert.equal(actionPayload(sent.facts[0]?.structuredPayload)?.fulfillsFactId, null);
    await reviewActivityFact(db, {
      sourceMessageId: sent.message.id,
      activityFactId: sent.facts[0]!.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.actions.find((action) => action.source.factId === revised.fact.id)?.status, "OPEN");
    assert.equal(state?.actions.find((action) => action.source.factId === updated.fact.id)?.status, "OPEN");
  });

  test("G/H rejected and unreviewed requests are not trusted targets", async () => {
    const rejectedDeal = await createTestDeal(db);
    const rejectedMessage = await ingestSourceMessage(db, {
      dealId: rejectedDeal.id,
      bodyText: "Please send the revised proposal.",
      subject: "Rejected request",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-20T15:00:00Z"),
    });
    await analyzeSourceMessage(db, rejectedMessage.id, { speakerSide: "COUNTERPARTY" });
    const rejectedFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: rejectedMessage.id } });
    await reviewActivityFact(db, {
      sourceMessageId: rejectedMessage.id,
      activityFactId: rejectedFact.id,
      state: "INCORRECT",
      expectedWorkspaceId: rejectedDeal.workspaceId,
    });
    const rejectedFulfillment = await fulfill(rejectedDeal.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    assert.equal(actionPayload(rejectedFulfillment.facts[0]?.structuredPayload)?.fulfillsFactId, null);

    const unreviewedDeal = await createTestDeal(db);
    const unreviewedMessage = await ingestSourceMessage(db, {
      dealId: unreviewedDeal.id,
      bodyText: "Please send the revised proposal.",
      subject: "Unreviewed request",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-20T15:00:00Z"),
    });
    await analyzeSourceMessage(db, unreviewedMessage.id, { speakerSide: "COUNTERPARTY" });
    const unreviewedFulfillment = await fulfill(unreviewedDeal.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    assert.equal(actionPayload(unreviewedFulfillment.facts[0]?.structuredPayload)?.fulfillsFactId, null);
    const state = await getDealActionState(db, unreviewedDeal.id, { now: fixedNow });
    assert.equal(state?.actions.length, 0);
  });

  test("I/J fulfillment does not link across deals or workspaces", async () => {
    const deal = await createTestDeal(db);
    const request = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const otherDeal = await createTestDeal(db);
    const crossDeal = await fulfill(otherDeal.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    assert.equal(actionPayload(crossDeal.facts[0]?.structuredPayload)?.fulfillsFactId, null);
    assert.equal((await getDealActionState(db, deal.id, { now: fixedNow }))?.outstandingActions[0]?.source.factId, request.fact.id);

    const otherWorkspace = await db.workspace.create({ data: { name: "Other firm" } });
    const foreign = await db.deal.create({
      data: {
        name: "Foreign deal",
        company: "Other Co",
        property: "1 Other Street",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: otherWorkspace.id,
      },
    });
    const foreignRequest = await reviewedRequest(foreign, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const crossWorkspace = await fulfill(deal.id, "Attached is the revised proposal you requested.", "2026-09-23T15:00:00Z");
    assert.notEqual(actionPayload(crossWorkspace.facts[0]?.structuredPayload)?.fulfillsFactId, foreignRequest.fact.id);
    assert.equal(actionPayload(crossWorkspace.facts[0]?.structuredPayload)?.fulfillsFactId, request.fact.id);
    const foreignState = await getDealActionState(db, foreign.id, { now: fixedNow });
    assert.equal(foreignState?.outstandingActions[0]?.status, "OPEN");
    assert.equal(foreignState?.outstandingActions[0]?.fulfillment, null);
  });

  test("K a later request cannot be fulfilled by an earlier message", async () => {
    const deal = await createTestDeal(db);
    const sent = await fulfill(deal.id, "Attached is the revised proposal you requested.", "2026-09-18T15:00:00Z");
    const request = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    assert.equal(actionPayload(sent.facts[0]?.structuredPayload)?.fulfillsFactId, null);
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.actions.find((action) => action.source.factId === request.fact.id)?.status, "OPEN");
  });

  test("L/M/N attachment presence, a shared due instant, and the nearest action do not link", async () => {
    const deal = await createTestDeal(db);
    const first = await reviewedRequest(deal, "Please send the revised proposal by November 15, 2026 at 5:00 PM ET.", "2026-09-20T15:00:00Z");
    const second = await reviewedRequest(deal, "Please send the updated proposal by November 15, 2026 at 5:00 PM ET.", "2026-09-21T15:00:00Z");
    const attached = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "See the attached file.",
      subject: "File only",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-22T15:00:00Z"),
    });
    await db.sourceMessageAttachment.create({
      data: {
        sourceMessageId: attached.id,
        filename: "proposal.pdf",
        contentType: "application/pdf",
        size: 128,
      },
    });
    await analyzeSourceMessage(db, attached.id);
    const nearest = await fulfill(deal.id, "Here is the proposal.", "2026-09-22T18:00:00Z");
    assert.equal(await db.activityFact.count({ where: { sourceMessageId: attached.id } }), 0);
    assert.equal(nearest.facts.length, 0);
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.actions.find((action) => action.source.factId === first.fact.id)?.status, "OPEN");
    assert.equal(state?.actions.find((action) => action.source.factId === second.fact.id)?.status, "OPEN");
    assert.equal(state?.actions.every((action) => action.fulfillment == null), true);
    assert.equal(state?.actions[0]?.dueAt, "2026-11-15T17:00:00-05:00");
  });

  test("Z/AA review rejection leaves the action open and a correction can name the target", async () => {
    const rejected = await createTestDeal(db);
    const rejectedRequest = await reviewedRequest(rejected, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const rejectedSent = await fulfill(rejected.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    await reviewActivityFact(db, {
      sourceMessageId: rejectedSent.message.id,
      activityFactId: rejectedSent.facts[0]!.id,
      state: "INCORRECT",
      expectedWorkspaceId: rejected.workspaceId,
    });
    const rejectedState = await getDealActionState(db, rejected.id, { now: fixedNow });
    assert.equal(rejectedState?.actions.find((action) => action.source.factId === rejectedRequest.fact.id)?.status, "OPEN");
    assert.equal(rejectedState?.outstandingActions[0]?.fulfillment, null);

    const corrected = await createTestDeal(db);
    const revised = await reviewedRequest(corrected, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const updated = await reviewedRequest(corrected, "Please send the updated proposal.", "2026-09-20T16:00:00Z");
    const sent = await fulfill(corrected.id, "Attached is the proposal you requested.", "2026-09-22T15:00:00Z");
    const original = sent.facts[0]!.structuredPayload as {
      display: string;
      numeric: null;
      unit: null;
      negotiation: null;
      action: {
        kind: "FULFILLMENT";
        responsibleSide: "OUR_SIDE" | "COUNTERPARTY" | "BOTH" | "UNKNOWN";
        responsibleLabel: null;
        counterpartyLabel: null;
        dueAt: null;
        dueText: null;
        occursAt: null;
        fulfillsFactId: string | null;
      };
    };
    assert.equal(original.action.fulfillsFactId, null);
    await reviewActivityFact(db, {
      sourceMessageId: sent.message.id,
      activityFactId: sent.facts[0]!.id,
      state: "INCORRECT",
      expectedWorkspaceId: corrected.workspaceId,
      correctedPayload: {
        ...original,
        action: { ...original.action, fulfillsFactId: revised.fact.id },
      },
      note: "Reviewer selected the revised proposal request",
    });
    const raw = await db.activityFact.findUniqueOrThrow({ where: { id: sent.facts[0]!.id } });
    assert.equal(actionPayload(raw.structuredPayload)?.fulfillsFactId, null);
    const state = await getDealActionState(db, corrected.id, { now: fixedNow });
    assert.equal(state?.actions.find((action) => action.source.factId === revised.fact.id)?.status, "CLOSED");
    assert.equal(state?.actions.find((action) => action.source.factId === revised.fact.id)?.fulfillment?.factId, sent.facts[0]!.id);
    assert.equal(state?.actions.find((action) => action.source.factId === updated.fact.id)?.status, "OPEN");
  });

  test("AB/AC/AD/AE/AF fulfillment linking does not mutate negotiation, legacy activity, or action reads", async () => {
    const deal = await createTestDeal(db);
    const legacy = await db.dealEvent.create({
      data: {
        dealId: deal.id,
        type: "EMAIL",
        description: "Please send the revised proposal. Landlord issued legacy counter at $72.50/RSF/year.",
        occurredAt: new Date("2026-09-16T12:00:00Z"),
        confidence: 1,
        evidenceQuote: "Please send the revised proposal. Base rent: $72.50/RSF/year",
      },
    });
    const request = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const before = {
      terms: await db.negotiationTerm.count(),
      events: await db.dealEvent.count({ where: { dealId: deal.id } }),
      facts: await db.activityFact.count({ where: { dealId: deal.id } }),
    };
    const sent = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Landlord proposes $70.00/RSF/year. Attached is the revised proposal you requested.",
      subject: "Delivery",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-22T15:00:00Z"),
    });
    const analyzed = await analyzeSourceMessage(db, sent.id, { speakerSide: "OUR_SIDE" });
    const again = await analyzeSourceMessage(db, sent.id, { speakerSide: "OUR_SIDE" });
    assert.equal(analyzed.idempotent, false);
    assert.equal(again.idempotent, true);
    const fulfillment = await db.activityFact.findFirstOrThrow({
      where: { sourceMessageId: sent.id, factType: "DOCUMENT_SENT" },
    });
    assert.equal(actionPayload(fulfillment.structuredPayload)?.fulfillsFactId, request.fact.id);
    assert.equal(await db.negotiationTerm.count(), before.terms);
    assert.equal(await db.dealEvent.count({ where: { dealId: deal.id } }), before.events);
    assert.equal(await db.activityFact.count({ where: { dealEventId: legacy.id } }), 0);
    const legacyAfter = await db.dealEvent.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.match(legacyAfter.description, /72\.50/);
    const prompt = activityExtractionPrompt();
    assert.equal(prompt.includes("fulfillsFactId"), false);
    assert.match(prompt, /Do not return an action object/);
    const serviceSource = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
    const deriveSource = readFileSync(new URL("./derive.ts", import.meta.url), "utf8");
    assert.equal(serviceSource.includes("openai"), false);
    assert.equal(deriveSource.includes("fulfillsFactId"), true);
    assert.equal(deriveSource.includes("bodyText"), false);
    const countsBeforeRead = await db.activityFact.count();
    const first = await getDealActionState(db, deal.id, { now: fixedNow });
    const second = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.deepEqual(second, first);
    assert.equal(await db.activityFact.count(), countsBeforeRead);
    assert.equal(first?.actions.find((action) => action.source.factId === request.fact.id)?.status, "OPEN");
  });

  test("AG/AH Phase 12A directives and Phase 12B timestamps stay intact", async () => {
    const deal = await createTestDeal(db);
    const directive = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send us the revised proposal by Friday.",
      subject: "Directive",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-20T15:00:00Z"),
    });
    await analyzeSourceMessage(db, directive.id, { speakerSide: "COUNTERPARTY" });
    const directiveFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: directive.id } });
    assert.equal(actionPayload(directiveFact.structuredPayload)?.kind, "DOCUMENT_REQUESTED");
    assert.equal(actionPayload(directiveFact.structuredPayload)?.dueText, "by Friday");
    assert.equal(actionPayload(directiveFact.structuredPayload)?.dueAt, null);
    assert.equal(actionPayload(directiveFact.structuredPayload)?.fulfillsFactId, null);
    assert.equal(directiveFact.extractorVersion, ACTIVITY_EXTRACTOR_VERSION);

    const dated = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send the rent roll by November 15, 2026 at 5:00 PM ET.",
      subject: "Dated",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-21T15:00:00Z"),
    });
    await analyzeSourceMessage(db, dated.id, { speakerSide: "COUNTERPARTY" });
    const datedFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: dated.id } });
    assert.equal(actionPayload(datedFact.structuredPayload)?.dueAt, "2026-11-15T17:00:00-05:00");
    assert.equal(actionPayload(datedFact.structuredPayload)?.dueText, "by November 15, 2026 at 5:00 PM ET");
    assert.equal(actionPayload(datedFact.structuredPayload)?.fulfillsFactId, null);
  });

  test("AI/AJ court, formal $67.00 rent, and the legacy $72.50 activity stay unchanged", async () => {
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
    const response = await reviewedRequest(deal, "Please respond by Friday.", "2026-09-20T15:00:00Z");
    const before = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(before?.court.value, "OUR_SIDE");
    const sent = await fulfill(deal.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    await reviewActivityFact(db, {
      sourceMessageId: sent.message.id,
      activityFactId: sent.facts[0]!.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    const after = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(after?.court.value, "OUR_SIDE");
    assert.equal(after?.actions.find((action) => action.source.factId === response.fact.id)?.status, "OPEN");
    assert.equal(actionPayload(sent.facts[0]?.structuredPayload)?.fulfillsFactId, null);
    const workspace = await getNegotiationWorkspace(db, deal.id);
    const rent = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(workspace?.summary.conflictCount, 0);
    assert.match(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : "", /67\.00/);
    const legacyAfter = await db.dealEvent.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.match(legacyAfter.description, /72\.50/);
    assert.equal(legacyAfter.evidenceQuote, "Base rent: $72.50/RSF/year");
    assert.equal(await db.activityFact.count({ where: { dealEventId: legacy.id } }), 0);
    assert.equal(ACTIVITY_EXTRACTOR_VERSION, "phase12c.1");
    assert.equal(deterministicExtractorIdentity().extractorVersion, "phase12c.1");
  });

  test("P–T adversarial wording does not create current fulfillment through analysis", async () => {
    const deal = await createTestDeal(db);
    await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    for (const body of [
      "We sent the proposal last month.",
      "They said \"attached is the proposal you requested.\"",
      "The financials were previously sent.",
      "If they request it, we'll send it.",
      "We may send the proposal.",
      "No proposal was sent.",
      "Did you send the proposal?",
    ]) {
      const sent = await fulfill(deal.id, body, "2026-09-22T15:00:00Z");
      assert.equal(sent.facts.filter((fact) => actionPayload(fact.structuredPayload)?.kind === "FULFILLMENT").length, 0, body);
    }
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.outstandingActions.length, 1);
    assert.equal(state?.outstandingActions[0]?.fulfillment, null);
  });

  test("a prior extractor run is left in place when the version changes", async () => {
    const deal = await createTestDeal(db);
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send the revised proposal.",
      subject: "Versioned",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-20T15:00:00Z"),
    });
    const historical = deterministicExtractorIdentity();
    await analyzeSourceMessage(db, message.id, {
      speakerSide: "COUNTERPARTY",
      extractor: { ...historical, extractorVersion: "phase12b.1" },
    });
    await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
    const runs = await db.activityExtractionRun.findMany({
      where: { sourceMessageId: message.id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(runs.map((run) => run.extractorVersion), ["phase12b.1", "phase12c.1"]);
    assert.equal(runs.every((run) => run.status === "SUCCEEDED"), true);
    const prior = await analyzeSourceMessage(db, message.id, {
      extractor: { ...historical, extractorVersion: "phase12b.1" },
    });
    assert.equal(prior.idempotent, true);
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
