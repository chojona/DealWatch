import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { ActionEvidenceReviewList } from "@/components/deals/action-evidence-review";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { getDealActionState } from "@/lib/deals/actions/service";
import { getActionEvidenceReview, reviewActionEvidence } from "@/lib/deals/actions/evidenceReview";
import { decideMessageReview, reviewActivityFact } from "@/lib/messages/review";
import { analyzeSourceMessage, getMessageSource, ingestSourceMessage } from "@/lib/messages/service";
import { parseAnalyzeRequestBody } from "@/lib/messages/speakerSide";

const fixedNow = new Date("2026-09-29T16:00:00Z");

describe("message speaker side and action review", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
  });

  async function message(dealId: string, body: string, sentAt: string, senderName = "Jane Smith") {
    return ingestSourceMessage(db, {
      dealId,
      bodyText: body,
      subject: "Request",
      sourceType: "MANUAL",
      senderName,
      senderAddress: `${senderName.split(" ")[0]?.toLowerCase() ?? "sender"}@example.test`,
      sentAt: new Date(sentAt),
    });
  }

  test("analysis requires an explicit speaker choice and does not guess from the address", () => {
    assert.throws(() => parseAnalyzeRequestBody({}), /Choose who is speaking/);
    assert.throws(() => parseAnalyzeRequestBody({ speakerSide: "TENANT" }), /Choose who is speaking/);
    assert.deepEqual(parseAnalyzeRequestBody({ speakerSide: "UNKNOWN" }), { speakerSide: null, recorded: "UNKNOWN" });
    assert.deepEqual(parseAnalyzeRequestBody({ speakerSide: "OUR_SIDE" }), { speakerSide: "OUR_SIDE", recorded: "OUR_SIDE" });
    assert.throws(() => parseAnalyzeRequestBody({ speakerSide: "COUNTERPARTY", workspaceId: "nope" }), /workspaceId is server-controlled/);
  });

  test("our side, counterparty, both, and unknown court follow reviewed evidence", async () => {
    const deal = await createTestDeal(db);
    const viewSource = readFileSync(new URL("../../components/messages/message-source-view.tsx", import.meta.url), "utf8");
    assert.match(viewSource, /Who is speaking\?/);
    assert.match(viewSource, /DealWatch does not guess this from the sender address/);
    assert.match(viewSource, /speakerSide === ""/);
    assert.match(viewSource, /Action evidence is still pending, so follow-up is not resolved/);
    assert.match(viewSource, /same review used on the deal/);
    assert.equal(viewSource.includes("fully reviewed"), false);
    const unanalyzed = await message(deal.id, "Please send the revised proposal.", "2026-09-18T15:00:00Z");
    const beforeView = await getMessageSource(db, unanalyzed.id);
    assert.equal(beforeView?.analysisState, "NOT_ANALYZED");
    assert.equal(beforeView?.speakerSide, null);

    const ours = await message(deal.id, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const parsed = parseAnalyzeRequestBody({ speakerSide: "COUNTERPARTY" });
    await analyzeSourceMessage(db, ours.id, { speakerSide: parsed.speakerSide, recordSpeakerSide: parsed.recorded });
    const again = await analyzeSourceMessage(db, ours.id, { speakerSide: "OUR_SIDE", recordSpeakerSide: "OUR_SIDE" });
    assert.equal(again.idempotent, true);
    const run = await db.activityExtractionRun.findFirstOrThrow({ where: { sourceMessageId: ours.id, status: "SUCCEEDED" } });
    assert.equal(run.speakerSide, "COUNTERPARTY");
    const oursFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: ours.id } });
    const raw = oursFact.structuredPayload as { action?: { responsibleSide?: string } };
    assert.equal(raw.action?.responsibleSide, "OUR_SIDE");
    assert.equal((await getDealActionState(db, deal.id, { now: fixedNow }))?.court.value, "UNKNOWN");

    await decideMessageReview(db, { sourceMessageId: ours.id, decision: "ACKNOWLEDGED" });
    const acknowledged = await getMessageSource(db, ours.id);
    assert.equal(acknowledged?.reviewState, "REVIEWED");
    assert.equal(acknowledged?.actionReviewState, "PENDING");
    assert.equal(acknowledged?.evidenceSettled, false);
    assert.equal(acknowledged?.lifecycleState, "REVIEW_REQUIRED");
    const pendingQueue = await getActionEvidenceReview(db, deal.id);
    assert.equal(pendingQueue?.items.some((item) => item.messageId === ours.id), true);
    await assert.rejects(
      () => reviewActivityFact(db, {
        sourceMessageId: ours.id,
        activityFactId: oursFact.id,
        state: "CONFIRMED",
        commercialReview: true,
      }),
      /action evidence decision/,
    );

    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: ours.id,
      activityFactId: oursFact.id,
      decision: "confirm",
      expectedWorkspaceId: deal.workspaceId,
    });
    assert.equal((await getDealActionState(db, deal.id, { now: fixedNow }))?.court.value, "OUR_SIDE");
    const settled = await getMessageSource(db, ours.id);
    assert.equal(settled?.actionReviewState, "REVIEWED");
    assert.equal(settled?.evidenceSettled, true);
    assert.deepEqual((await db.activityFact.findUniqueOrThrow({ where: { id: oursFact.id } })).structuredPayload, oursFact.structuredPayload);

    const counterDeal = await createTestDeal(db);
    const counter = await message(counterDeal.id, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    await analyzeSourceMessage(db, counter.id, { speakerSide: "OUR_SIDE", recordSpeakerSide: "OUR_SIDE" });
    const counterFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: counter.id } });
    assert.equal((counterFact.structuredPayload as { action?: { responsibleSide?: string } }).action?.responsibleSide, "COUNTERPARTY");
    await reviewActionEvidence(db, {
      dealId: counterDeal.id,
      sourceMessageId: counter.id,
      activityFactId: counterFact.id,
      decision: "confirm",
      expectedWorkspaceId: counterDeal.workspaceId,
    });
    assert.equal((await getDealActionState(db, counterDeal.id, { now: fixedNow }))?.court.value, "COUNTERPARTY");

    const bothDeal = await createTestDeal(db);
    const fromThem = await message(bothDeal.id, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const fromUs = await message(bothDeal.id, "Please send the insurance certificate.", "2026-09-21T15:00:00Z", "Alex Chen");
    await analyzeSourceMessage(db, fromThem.id, { speakerSide: "COUNTERPARTY", recordSpeakerSide: "COUNTERPARTY" });
    await analyzeSourceMessage(db, fromUs.id, { speakerSide: "OUR_SIDE", recordSpeakerSide: "OUR_SIDE" });
    for (const sourceId of [fromThem.id, fromUs.id]) {
      const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: sourceId } });
      await reviewActionEvidence(db, {
        dealId: bothDeal.id,
        sourceMessageId: sourceId,
        activityFactId: fact.id,
        decision: "confirm",
        expectedWorkspaceId: bothDeal.workspaceId,
      });
    }
    const both = await getDealActionState(db, bothDeal.id, { now: fixedNow });
    assert.equal(both?.court.value, "BOTH");
    assert.equal(both?.outstandingActions.length, 2);

    const unknownDeal = await createTestDeal(db);
    const unknown = await message(unknownDeal.id, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const unknownChoice = parseAnalyzeRequestBody({ speakerSide: "UNKNOWN" });
    await analyzeSourceMessage(db, unknown.id, { speakerSide: unknownChoice.speakerSide, recordSpeakerSide: unknownChoice.recorded });
    const unknownRun = await db.activityExtractionRun.findFirstOrThrow({ where: { sourceMessageId: unknown.id } });
    assert.equal(unknownRun.speakerSide, "UNKNOWN");
    const unknownFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: unknown.id } });
    await reviewActionEvidence(db, {
      dealId: unknownDeal.id,
      sourceMessageId: unknown.id,
      activityFactId: unknownFact.id,
      decision: "confirm",
      expectedWorkspaceId: unknownDeal.workspaceId,
    });
    assert.equal((await getDealActionState(db, unknownDeal.id, { now: fixedNow }))?.court.value, "UNKNOWN");
  });

  test("fulfillment, rejection, and correction stay on reviewed action evidence", async () => {
    const deal = await createTestDeal(db);
    const proposal = await message(deal.id, "Please send the revised proposal.", "2026-09-08T15:00:00Z");
    const updated = await message(deal.id, "Please send the updated proposal.", "2026-09-10T15:00:00Z", "John Doe");
    await message(deal.id, "Please send the insurance certificate.", "2026-09-11T15:00:00Z", "Pat Lee");
    for (const source of [proposal, updated]) {
      await analyzeSourceMessage(db, source.id, { speakerSide: "COUNTERPARTY", recordSpeakerSide: "COUNTERPARTY" });
      const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: source.id } });
      await reviewActionEvidence(db, {
        dealId: deal.id,
        sourceMessageId: source.id,
        activityFactId: fact.id,
        decision: "confirm",
        expectedWorkspaceId: deal.workspaceId,
      });
    }
    const insurance = await db.sourceMessage.findFirstOrThrow({ where: { dealId: deal.id, senderAddress: "pat@example.test" } });
    await analyzeSourceMessage(db, insurance.id, { speakerSide: "COUNTERPARTY", recordSpeakerSide: "COUNTERPARTY" });
    const insuranceFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: insurance.id } });
    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: insurance.id,
      activityFactId: insuranceFact.id,
      decision: "confirm",
      expectedWorkspaceId: deal.workspaceId,
    });

    const sent = await message(deal.id, "Attached is the proposal you requested.", "2026-09-12T15:00:00Z", "Alex Chen");
    await analyzeSourceMessage(db, sent.id, { speakerSide: "OUR_SIDE", recordSpeakerSide: "OUR_SIDE" });
    const sentFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: sent.id } });
    assert.equal((sentFact.structuredPayload as { action?: { fulfillsFactId?: string | null } }).action?.fulfillsFactId, null);
    const queue = await getActionEvidenceReview(db, deal.id, { expectedWorkspaceId: deal.workspaceId });
    const item = queue?.items.find((entry) => entry.factId === sentFact.id);
    const proposalFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: proposal.id } });
    const updatedFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: updated.id } });
    assert.deepEqual(item?.choices.map((choice) => choice.factId).sort(), [proposalFact.id, updatedFact.id].sort());
    const html = renderToStaticMarkup(createElement(ActionEvidenceReviewList, { items: item ? [item] : [], submit: async () => undefined }));
    assert.match(html, /Please send the revised proposal\./);
    assert.match(html, /Please send the updated proposal\./);
    assert.match(html, /None \/ cannot determine/);
    assert.equal(html.includes("insurance certificate"), false);

    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: sent.id,
      activityFactId: sentFact.id,
      decision: "correct",
      correction: { fulfillsFactId: proposalFact.id },
      expectedWorkspaceId: deal.workspaceId,
    });
    const afterFulfill = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(afterFulfill?.actions.find((action) => action.source.factId === proposalFact.id)?.status, "CLOSED");
    assert.equal(afterFulfill?.actions.find((action) => action.source.factId === updatedFact.id)?.status, "OPEN");
    assert.equal(afterFulfill?.actions.find((action) => action.source.factId === insuranceFact.id)?.status, "OPEN");

    const rejectedDeal = await createTestDeal(db);
    const rejected = await message(rejectedDeal.id, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    await analyzeSourceMessage(db, rejected.id, { speakerSide: "COUNTERPARTY", recordSpeakerSide: "COUNTERPARTY" });
    const rejectedFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: rejected.id } });
    const rejectedRaw = rejectedFact.structuredPayload;
    await reviewActionEvidence(db, {
      dealId: rejectedDeal.id,
      sourceMessageId: rejected.id,
      activityFactId: rejectedFact.id,
      decision: "reject",
      expectedWorkspaceId: rejectedDeal.workspaceId,
    });
    assert.equal((await getDealActionState(db, rejectedDeal.id, { now: fixedNow }))?.actions.length, 0);
    assert.deepEqual((await db.activityFact.findUniqueOrThrow({ where: { id: rejectedFact.id } })).structuredPayload, rejectedRaw);

    const correctedDeal = await createTestDeal(db);
    const corrected = await message(correctedDeal.id, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    await analyzeSourceMessage(db, corrected.id, { speakerSide: "COUNTERPARTY", recordSpeakerSide: "COUNTERPARTY" });
    const correctedFact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: corrected.id } });
    const correctedRaw = correctedFact.structuredPayload;
    await reviewActionEvidence(db, {
      dealId: correctedDeal.id,
      sourceMessageId: corrected.id,
      activityFactId: correctedFact.id,
      decision: "correct",
      correction: { kind: "INFORMATION_REQUESTED", responsibleSide: "COUNTERPARTY" },
      expectedWorkspaceId: correctedDeal.workspaceId,
    });
    const state = await getDealActionState(db, correctedDeal.id, { now: fixedNow });
    assert.equal(state?.court.value, "COUNTERPARTY");
    assert.equal(state?.actions[0]?.kind, "INFORMATION_REQUESTED");
    assert.equal(state?.actions[0]?.responsibleSide, "COUNTERPARTY");
    assert.deepEqual((await db.activityFact.findUniqueOrThrow({ where: { id: correctedFact.id } })).structuredPayload, correctedRaw);
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
