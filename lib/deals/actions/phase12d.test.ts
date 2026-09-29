import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { extractActivityFacts } from "@/lib/ai/activity/extractActivityFacts";
import { matchingFulfillmentTargets, resolveFulfillmentTarget } from "@/lib/ai/activity/fulfillment";
import { ActionEvidenceReviewList } from "@/components/deals/action-evidence-review";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { analyzeSourceMessage, ingestSourceMessage } from "@/lib/messages/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { getDealActionState } from "./service";
import { ActionEvidenceReviewError, getActionEvidenceReview, reviewActionEvidence } from "./evidenceReview";
import { formatStoredInstant, type ActionEvidenceReviewItem } from "./evidenceReviewView";

const fixedNow = new Date("2026-09-29T16:00:00Z");

function markup(items: ActionEvidenceReviewItem[]) {
  return renderToStaticMarkup(createElement(ActionEvidenceReviewList, {
    items,
    submit: async () => undefined,
  }));
}

describe("Phase 12D action evidence review", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
  });

  async function request(deal: { id: string; workspaceId: string }, body: string, sentAt: string, senderName = "Jane Smith") {
    const message = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: body,
      subject: "Request",
      sourceType: "MANUAL",
      senderName,
      senderAddress: `${senderName.split(" ")[0]?.toLowerCase() ?? "sender"}@example.test`,
      sentAt: new Date(sentAt),
    });
    await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    return { message, fact };
  }

  async function reviewedRequest(deal: { id: string; workspaceId: string }, body: string, sentAt: string, senderName = "Jane Smith") {
    const created = await request(deal, body, sentAt, senderName);
    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: created.message.id,
      activityFactId: created.fact.id,
      decision: "confirm",
      expectedWorkspaceId: deal.workspaceId,
    });
    return created;
  }

  async function fulfill(dealId: string, body: string, sentAt: string) {
    const message = await ingestSourceMessage(db, {
      dealId,
      bodyText: body,
      subject: "Fulfillment",
      sourceType: "MANUAL",
      senderName: "Alex Chen",
      senderAddress: "alex@example.test",
      sentAt: new Date(sentAt),
    });
    await analyzeSourceMessage(db, message.id, { speakerSide: "OUR_SIDE" });
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    return { message, fact };
  }

  test("A–G pending action evidence is shown in ordinary language", async () => {
    const deal = await createTestDeal(db);
    const explicit = await request(
      deal,
      "Please send us the revised proposal by November 15, 2026 at 5:00 PM ET.",
      "2026-09-28T15:00:00Z",
    );
    const unresolved = await request(deal, "Please send the rent roll by Friday.", "2026-09-27T15:00:00Z", "Pat Lee");
    const unknown = await ingestSourceMessage(db, {
      dealId: deal.id,
      bodyText: "Please send the insurance certificate.",
      subject: "Unknown side",
      sourceType: "MANUAL",
      senderName: "Pat Lee",
      senderAddress: "pat@example.test",
      sentAt: new Date("2026-09-26T15:00:00Z"),
    });
    await analyzeSourceMessage(db, unknown.id);
    const before = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(before?.court.value, "UNKNOWN");
    assert.equal(before?.needsYou.length, 0);

    const queue = await getActionEvidenceReview(db, deal.id, { expectedWorkspaceId: deal.workspaceId });
    const proposal = queue?.items.find((item) => item.factId === explicit.fact.id);
    const friday = queue?.items.find((item) => item.factId === unresolved.fact.id);
    const insurance = queue?.items.find((item) => item.evidenceQuote === "Please send the insurance certificate.");
    assert.equal(proposal?.headline, "ACTION DETECTED");
    assert.equal(proposal?.kindLabel, "Document requested");
    assert.equal(proposal?.evidenceQuote, "Please send us the revised proposal by November 15, 2026 at 5:00 PM ET.");
    assert.equal(proposal?.href, `/messages/${explicit.message.id}`);
    assert.equal(proposal?.dueAtLabel, "Nov 15, 2026 · 5:00 PM -05:00");
    assert.equal(proposal?.dueText, "by November 15, 2026 at 5:00 PM ET");
    assert.equal(formatStoredInstant("2026-11-15T17:00:00-05:00"), "Nov 15, 2026 · 5:00 PM -05:00");
    assert.equal(friday?.dueAtLabel, null);
    assert.equal(friday?.dueText, "by Friday");
    assert.equal(insurance?.responsibleSideLabel, "Unknown");

    const html = markup(queue?.items ?? []);
    assert.match(html, /ACTION DETECTED/);
    assert.match(html, /Document requested/);
    assert.equal(html.includes("DOCUMENT_REQUESTED"), false);
    assert.match(html, /Please send us the revised proposal by November 15, 2026 at 5:00 PM ET\./);
    assert.match(html, new RegExp(`/messages/${explicit.message.id}`));
    assert.match(html, /View message/);
    assert.match(html, /Nov 15, 2026 · 5:00 PM -05:00/);
    assert.match(html, /Source wording: by November 15, 2026 at 5:00 PM ET/);
    assert.match(html, /by Friday/);
    assert.equal(html.includes("Nov 27, 2026"), false);
    assert.match(html, />Unknown</);
    assert.match(html, /Reject/);
    assert.match(html, /Confirm/);
  });

  test("H/I/J confirming uses review and Phase 11; rejecting creates no obligation", async () => {
    const deal = await createTestDeal(db);
    const created = await request(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const before = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(before?.court.value, "UNKNOWN");
    assert.equal(before?.needsYou.length, 0);
    assert.equal(before?.outstandingActions.length, 0);
    const beforeTerms = await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } });
    const beforeEvents = await db.dealEvent.count({ where: { dealId: deal.id } });

    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: created.message.id,
      activityFactId: created.fact.id,
      decision: "confirm",
      expectedWorkspaceId: deal.workspaceId,
    });
    const confirmed = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(confirmed?.court.value, "OUR_SIDE");
    assert.equal(confirmed?.needsYou.length, 1);
    assert.equal(confirmed?.outstandingActions[0]?.source.evidenceQuote, "Please send the revised proposal.");
    assert.equal(confirmed?.actions[0]?.confidence, "REVIEWED");
    const stored = await db.activityFact.findUniqueOrThrow({ where: { id: created.fact.id } });
    assert.equal((stored.structuredPayload as { action?: { kind?: string } }).action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(await db.activityFactReview.count({ where: { activityFactId: created.fact.id, state: "CONFIRMED" } }), 1);

    const rejectedDeal = await createTestDeal(db);
    const rejected = await request(rejectedDeal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    await reviewActionEvidence(db, {
      dealId: rejectedDeal.id,
      sourceMessageId: rejected.message.id,
      activityFactId: rejected.fact.id,
      decision: "reject",
      expectedWorkspaceId: rejectedDeal.workspaceId,
    });
    const afterReject = await getDealActionState(db, rejectedDeal.id, { now: fixedNow });
    assert.equal(afterReject?.court.value, "UNKNOWN");
    assert.equal(afterReject?.actions.length, 0);
    assert.equal(afterReject?.outstandingActions.length, 0);
    assert.equal(await db.activityFact.count({ where: { id: rejected.fact.id } }), 1);
    assert.equal(await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), beforeTerms);
    assert.equal(await db.dealEvent.count({ where: { dealId: deal.id } }), beforeEvents);
    const queue = await getActionEvidenceReview(db, rejectedDeal.id, { expectedWorkspaceId: rejectedDeal.workspaceId });
    assert.equal(queue?.items.some((item) => item.factId === rejected.fact.id), false);
  });

  test("K/L fulfillment review shows both sides and confirmation closes only the linked request", async () => {
    const deal = await createTestDeal(db);
    const proposal = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const insurance = await reviewedRequest(deal, "Please send the insurance certificate.", "2026-09-21T15:00:00Z", "John Doe");
    const sent = await fulfill(deal.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    assert.equal((sent.fact.structuredPayload as { action?: { fulfillsFactId?: string | null } }).action?.fulfillsFactId, proposal.fact.id);
    const open = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(open?.outstandingActions.length, 2);
    assert.equal(open?.actions.find((action) => action.source.factId === proposal.fact.id)?.status, "OPEN");

    const queue = await getActionEvidenceReview(db, deal.id, { expectedWorkspaceId: deal.workspaceId });
    const item = queue?.items.find((entry) => entry.factId === sent.fact.id);
    assert.equal(item?.headline, "FULFILLMENT DETECTED");
    assert.equal(item?.evidenceQuote, "Attached is the revised proposal you requested.");
    assert.equal(item?.linkedRequest?.evidenceQuote, "Please send the revised proposal.");
    assert.equal(item?.linkedRequest?.href, `/messages/${proposal.message.id}`);
    const html = markup(queue?.items.filter((entry) => entry.factId === sent.fact.id) ?? []);
    assert.match(html, /FULFILLMENT DETECTED/);
    assert.match(html, /Attached is the revised proposal you requested\./);
    assert.match(html, /Please send the revised proposal\./);
    assert.match(html, /View request/);
    assert.match(html, /View message/);
    assert.match(html, /Confirming records that this later message fulfills that earlier request/);

    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: sent.message.id,
      activityFactId: sent.fact.id,
      decision: "confirm",
      expectedWorkspaceId: deal.workspaceId,
    });
    const closed = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(closed?.actions.find((action) => action.source.factId === proposal.fact.id)?.status, "CLOSED");
    assert.equal(closed?.actions.find((action) => action.source.factId === insurance.fact.id)?.status, "OPEN");
    assert.equal(closed?.outstandingActions.length, 1);
    assert.equal(closed?.court.value, "OUR_SIDE");

    const alone = await createTestDeal(db);
    const only = await reviewedRequest(alone, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    const onlySent = await fulfill(alone.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    const beforeClose = await getDealActionState(db, alone.id, { now: fixedNow });
    assert.equal(beforeClose?.outstandingActions.length, 1);
    await reviewActionEvidence(db, {
      dealId: alone.id,
      sourceMessageId: onlySent.message.id,
      activityFactId: onlySent.fact.id,
      decision: "confirm",
      expectedWorkspaceId: alone.workspaceId,
    });
    const afterClose = await getDealActionState(db, alone.id, { now: fixedNow });
    assert.equal(afterClose?.actions.find((action) => action.source.factId === only.fact.id)?.status, "CLOSED");
    assert.equal(afterClose?.outstandingActions.length, 0);
    assert.equal(afterClose?.court.value, "NONE");
  });

  test("M/N/O ambiguous fulfillment choices are limited to eligible requests", async () => {
    const deal = await createTestDeal(db);
    const revised = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-08T15:00:00Z", "Jane Smith");
    const updated = await reviewedRequest(deal, "Please send the updated proposal.", "2026-09-10T15:00:00Z", "John Doe");
    await reviewedRequest(deal, "Please send the insurance certificate.", "2026-09-11T15:00:00Z", "Pat Lee");
    const sent = await fulfill(deal.id, "Attached is the proposal you requested.", "2026-09-12T15:00:00Z");
    assert.equal((sent.fact.structuredPayload as { action?: { fulfillsFactId?: string | null } }).action?.fulfillsFactId, null);
    const queue = await getActionEvidenceReview(db, deal.id, { expectedWorkspaceId: deal.workspaceId });
    const item = queue?.items.find((entry) => entry.factId === sent.fact.id);
    assert.equal(item?.headline, "FULFILLMENT NEEDS REVIEW");
    assert.equal(item?.requiresTargetChoice, true);
    assert.deepEqual(item?.choices.map((choice) => choice.factId).sort(), [revised.fact.id, updated.fact.id].sort());
    assert.equal(item?.choices.some((choice) => choice.evidenceQuote.includes("insurance")), false);
    const html = markup(item ? [item] : []);
    assert.match(html, /Which request does this fulfill\?/);
    assert.match(html, /Please send the revised proposal\./);
    assert.match(html, /Please send the updated proposal\./);
    assert.match(html, /None \/ cannot determine/);
    assert.match(html, /Jane Smith/);
    assert.match(html, /John Doe/);
    assert.equal(html.includes("insurance certificate"), false);

    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: sent.message.id,
      activityFactId: sent.fact.id,
      decision: "correct",
      correction: { fulfillsFactId: revised.fact.id },
      expectedWorkspaceId: deal.workspaceId,
    });
    const selected = await db.activityFactCorrection.findFirstOrThrow({ where: { activityFactId: sent.fact.id } });
    assert.equal((selected.structuredPayload as { action?: { fulfillsFactId?: string | null } }).action?.fulfillsFactId, revised.fact.id);
    const afterSelect = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(afterSelect?.actions.find((action) => action.source.factId === revised.fact.id)?.status, "CLOSED");
    assert.equal(afterSelect?.actions.find((action) => action.source.factId === updated.fact.id)?.status, "OPEN");

    const other = await createTestDeal(db);
    const left = await reviewedRequest(other, "Please send the revised proposal.", "2026-09-08T15:00:00Z");
    await reviewedRequest(other, "Please send the updated proposal.", "2026-09-10T15:00:00Z", "John Doe");
    const otherSent = await fulfill(other.id, "Attached is the proposal you requested.", "2026-09-12T15:00:00Z");
    await reviewActionEvidence(db, {
      dealId: other.id,
      sourceMessageId: otherSent.message.id,
      activityFactId: otherSent.fact.id,
      decision: "correct",
      correction: { fulfillsFactId: null },
      expectedWorkspaceId: other.workspaceId,
    });
    const none = await db.activityFactCorrection.findFirstOrThrow({ where: { activityFactId: otherSent.fact.id } });
    assert.equal((none.structuredPayload as { action?: { fulfillsFactId?: string | null } }).action?.fulfillsFactId, null);
    const stillOpen = await getDealActionState(db, other.id, { now: fixedNow });
    assert.equal(stillOpen?.actions.find((action) => action.source.factId === left.fact.id)?.status, "OPEN");
    assert.equal(stillOpen?.outstandingActions.length, 2);
  });

  test("P–U ineligible fulfillment targets and duplicate reviews are rejected", async () => {
    const deal = await createTestDeal(db);
    const revised = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-08T15:00:00Z");
    await reviewedRequest(deal, "Please send the updated proposal.", "2026-09-10T15:00:00Z", "John Doe");
    const sent = await fulfill(deal.id, "Attached is the proposal you requested.", "2026-09-12T15:00:00Z");

    await assert.rejects(
      () => reviewActionEvidence(db, {
        dealId: deal.id,
        sourceMessageId: sent.message.id,
        activityFactId: sent.fact.id,
        decision: "correct",
        correction: { fulfillsFactId: "not-a-real-fact" },
        expectedWorkspaceId: deal.workspaceId,
      }),
      (error: unknown) => error instanceof ActionEvidenceReviewError && error.message === "Fulfillment target is not eligible",
    );

    const otherDeal = await createTestDeal(db);
    const crossDeal = await reviewedRequest(otherDeal, "Please send the revised proposal.", "2026-09-01T15:00:00Z");
    await assert.rejects(
      () => reviewActionEvidence(db, {
        dealId: deal.id,
        sourceMessageId: sent.message.id,
        activityFactId: sent.fact.id,
        decision: "correct",
        correction: { fulfillsFactId: crossDeal.fact.id },
        expectedWorkspaceId: deal.workspaceId,
      }),
      (error: unknown) => error instanceof ActionEvidenceReviewError && error.status === 400,
    );

    const otherWorkspace = await db.workspace.create({ data: { name: "Elsewhere" } });
    const foreign = await db.deal.create({
      data: {
        name: "Foreign",
        company: "Other",
        property: "1 Other",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: otherWorkspace.id,
      },
    });
    const foreignRequest = await reviewedRequest(foreign, "Please send the revised proposal.", "2026-09-01T15:00:00Z");
    await assert.rejects(
      () => reviewActionEvidence(db, {
        dealId: deal.id,
        sourceMessageId: sent.message.id,
        activityFactId: sent.fact.id,
        decision: "correct",
        correction: { fulfillsFactId: foreignRequest.fact.id },
        expectedWorkspaceId: deal.workspaceId,
      }),
      (error: unknown) => error instanceof ActionEvidenceReviewError && error.message === "Fulfillment target is not eligible",
    );
    await assert.rejects(
      () => reviewActionEvidence(db, {
        dealId: foreign.id,
        sourceMessageId: sent.message.id,
        activityFactId: sent.fact.id,
        decision: "confirm",
        expectedWorkspaceId: deal.workspaceId,
      }),
      (error: unknown) => error instanceof ActionEvidenceReviewError && error.status === 404,
    );

    const laterDeal = await createTestDeal(db);
    const earlier = await fulfill(laterDeal.id, "Attached is the proposal you requested.", "2026-09-01T15:00:00Z");
    const later = await reviewedRequest(laterDeal, "Please send the revised proposal.", "2026-09-20T15:00:00Z");
    await reviewedRequest(laterDeal, "Please send the updated proposal.", "2026-09-21T15:00:00Z", "John Doe");
    await assert.rejects(
      () => reviewActionEvidence(db, {
        dealId: laterDeal.id,
        sourceMessageId: earlier.message.id,
        activityFactId: earlier.fact.id,
        decision: "correct",
        correction: { fulfillsFactId: later.fact.id },
        expectedWorkspaceId: laterDeal.workspaceId,
      }),
      (error: unknown) => error instanceof ActionEvidenceReviewError && error.message === "Fulfillment target is not eligible",
    );

    const rejectedDeal = await createTestDeal(db);
    const rejected = await request(rejectedDeal, "Please send the revised proposal.", "2026-09-08T15:00:00Z");
    await reviewActionEvidence(db, {
      dealId: rejectedDeal.id,
      sourceMessageId: rejected.message.id,
      activityFactId: rejected.fact.id,
      decision: "reject",
      expectedWorkspaceId: rejectedDeal.workspaceId,
    });
    const unreviewed = await request(rejectedDeal, "Please send the updated proposal.", "2026-09-09T15:00:00Z", "John Doe");
    const untrusted = await fulfill(rejectedDeal.id, "Attached is the proposal you requested.", "2026-09-12T15:00:00Z");
    for (const targetId of [rejected.fact.id, unreviewed.fact.id]) {
      await assert.rejects(
        () => reviewActionEvidence(db, {
          dealId: rejectedDeal.id,
          sourceMessageId: untrusted.message.id,
          activityFactId: untrusted.fact.id,
          decision: "correct",
          correction: { fulfillsFactId: targetId },
          expectedWorkspaceId: rejectedDeal.workspaceId,
        }),
        (error: unknown) => error instanceof ActionEvidenceReviewError && error.message === "Fulfillment target is not eligible",
      );
    }
    assert.equal(await db.activityFactReview.count({ where: { activityFactId: untrusted.fact.id } }), 0);
    assert.equal((await getDealActionState(db, laterDeal.id, { now: fixedNow }))?.actions.find((action) => action.source.factId === later.fact.id)?.status, "OPEN");

    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: sent.message.id,
      activityFactId: sent.fact.id,
      decision: "correct",
      correction: { fulfillsFactId: revised.fact.id },
      expectedWorkspaceId: deal.workspaceId,
    });
    await assert.rejects(
      () => reviewActionEvidence(db, {
        dealId: deal.id,
        sourceMessageId: sent.message.id,
        activityFactId: sent.fact.id,
        decision: "confirm",
        expectedWorkspaceId: deal.workspaceId,
      }),
      (error: unknown) => error instanceof ActionEvidenceReviewError && error.status === 409,
    );
    assert.equal(await db.activityFactReview.count({ where: { activityFactId: sent.fact.id } }), 1);
  });

  test("V/W/X/Y review stays on the existing evidence path", async () => {
    const component = readFileSync(new URL("../../../components/deals/action-evidence-review.tsx", import.meta.url), "utf8");
    const reviewSource = readFileSync(new URL("./evidenceReview.ts", import.meta.url), "utf8");
    const brief = readFileSync(new URL("../../../components/deals/deal-brief.tsx", import.meta.url), "utf8");
    assert.equal(component.includes("deriveDealActionState"), false);
    assert.equal(component.includes("getDealActionState"), false);
    assert.equal(component.includes("court"), false);
    assert.equal(reviewSource.includes("deriveDealActionState"), false);
    assert.equal(reviewSource.includes("openai"), false);
    assert.equal(reviewSource.includes("extractActivityFacts"), false);
    assert.equal(reviewSource.includes("reviewActivityFact"), true);
    assert.match(brief, /<ActionPanel actions=\{brief\.actions\} \/>\s*<ActionEvidenceReview/);
    const deal = await createTestDeal(db);
    const before = {
      terms: await db.negotiationTerm.count(),
      events: await db.dealEvent.count(),
      runs: await db.activityExtractionRun.count(),
    };
    await getActionEvidenceReview(db, deal.id, { expectedWorkspaceId: deal.workspaceId });
    assert.deepEqual({
      terms: await db.negotiationTerm.count(),
      events: await db.dealEvent.count(),
      runs: await db.activityExtractionRun.count(),
    }, before);
    const html = markup([]);
    assert.match(html, /No action evidence needs review/);
  });

  test("Z/AA/AB/AC/AD earlier phases and the rent split stay intact", async () => {
    const extracted = extractActivityFacts({
      bodyText: "Please send the revised proposal by Friday.",
      speakerSide: "COUNTERPARTY",
    });
    assert.equal(extracted[0]?.action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(extracted[0]?.action?.dueAt, null);
    assert.equal(extracted[0]?.action?.dueText, "by Friday");
    assert.equal(extracted[0]?.action?.fulfillsFactId, null);

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
    const dated = await request(deal, "Please send the rent roll by November 15, 2026 at 5:00 PM ET.", "2026-09-20T15:00:00Z");
    const payload = dated.fact.structuredPayload as { action?: { dueAt?: string | null; dueText?: string | null; kind?: string } };
    assert.equal(payload.action?.kind, "DOCUMENT_REQUESTED");
    assert.equal(payload.action?.dueAt, "2026-11-15T17:00:00-05:00");
    assert.equal(payload.action?.dueText, "by November 15, 2026 at 5:00 PM ET");
    const proposal = await reviewedRequest(deal, "Please send the revised proposal.", "2026-09-21T15:00:00Z");
    const sent = await fulfill(deal.id, "Attached is the revised proposal you requested.", "2026-09-22T15:00:00Z");
    assert.equal((sent.fact.structuredPayload as { action?: { fulfillsFactId?: string | null } }).action?.fulfillsFactId, proposal.fact.id);
    const targets = [
      {
        id: "one",
        workspaceId: "ws",
        dealId: "deal",
        timestamp: "2026-09-01T00:00:00.000Z",
        assertionStatus: "PROPOSED",
        evidenceQuote: "Please send the revised proposal.",
        provenanceStatus: "EXACT",
        reviewed: true,
        actionKind: "DOCUMENT_REQUESTED",
      },
      {
        id: "two",
        workspaceId: "ws",
        dealId: "deal",
        timestamp: "2026-09-02T00:00:00.000Z",
        assertionStatus: "PROPOSED",
        evidenceQuote: "Please send the updated proposal.",
        provenanceStatus: "EXACT",
        reviewed: true,
        actionKind: "DOCUMENT_REQUESTED",
      },
    ];
    const scope = { workspaceId: "ws", dealId: "deal", timestamp: "2026-09-03T00:00:00.000Z" };
    const explicit = { factType: "DOCUMENT_SENT" as const, display: "Document sent", referents: [{ noun: "proposal", modifier: null }] };
    assert.equal(resolveFulfillmentTarget(explicit, targets, scope), null);
    assert.equal(matchingFulfillmentTargets(explicit, targets, scope).length, 2);

    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: dated.message.id,
      activityFactId: dated.fact.id,
      decision: "confirm",
      expectedWorkspaceId: deal.workspaceId,
    });
    await reviewActionEvidence(db, {
      dealId: deal.id,
      sourceMessageId: sent.message.id,
      activityFactId: sent.fact.id,
      decision: "confirm",
      expectedWorkspaceId: deal.workspaceId,
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.actions.find((action) => action.source.factId === proposal.fact.id)?.status, "CLOSED");
    assert.equal(state?.actions.find((action) => action.source.factId === dated.fact.id)?.status, "OPEN");
    assert.equal(state?.court.value, "OUR_SIDE");
    const workspace = await getNegotiationWorkspace(db, deal.id);
    const rent = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT");
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
