import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { extractActivityFacts, extractActivityFactsWithModel } from "@/lib/ai/activity/extractActivityFacts";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { getDealBrief } from "@/lib/deals/brief/service";
import { reviewActivityFact } from "@/lib/messages/review";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { deriveDealActionState } from "./derive";
import { DealActionQueryError, parseDealActionQuery } from "./query";
import { getDealActionState } from "./service";
import { ACTION_DAY_MS, ACTION_INTELLIGENCE_THRESHOLDS } from "./thresholds";

const fixedNow = new Date("2026-09-29T16:00:00Z");

function directive(input: {
  kind: string;
  responsibleSide?: "OUR_SIDE" | "COUNTERPARTY" | "BOTH" | "UNKNOWN";
  dueAt?: string | null;
  dueText?: string | null;
  occursAt?: string | null;
  fulfillsFactId?: string | null;
  responsibleLabel?: string | null;
  counterpartyLabel?: string | null;
}): Prisma.InputJsonValue {
  return {
    kind: input.kind,
    responsibleSide: input.responsibleSide ?? "UNKNOWN",
    responsibleLabel: input.responsibleLabel ?? null,
    counterpartyLabel: input.counterpartyLabel ?? null,
    dueAt: input.dueAt ?? null,
    dueText: input.dueText ?? null,
    occursAt: input.occursAt ?? null,
    fulfillsFactId: input.fulfillsFactId ?? null,
  };
}

function payload(input: {
  display?: string;
  numeric?: number | null;
  unit?: string | null;
  action?: Prisma.InputJsonValue | null;
}): Prisma.InputJsonValue {
  return {
    display: input.display ?? "Structured fact",
    numeric: input.numeric ?? null,
    unit: input.unit ?? null,
    negotiation: null,
    ...(input.action === undefined ? {} : { action: input.action }),
  };
}

function rentPayload(amount: number): Prisma.InputJsonValue {
  return { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: amount } };
}

describe("Phase 11 deterministic action intelligence", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;
  let sequence = 0;

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
  });

  async function record(deal: { id: string; workspaceId: string }, input: {
    subject: string;
    body: string;
    sentAt: string;
    factType: "NEGOTIATION_VALUE" | "DEADLINE" | "DOCUMENT_RECEIVED" | "DOCUMENT_SENT" | "MEETING" | "CALL" | "OTHER";
    assertionStatus?: "PROPOSED" | "ACCEPTED";
    side?: "LANDLORD" | "TENANT" | "UNKNOWN";
    canonicalType?: string | null;
    payload: Prisma.InputJsonValue;
    quote: string;
    review?: boolean;
    sender?: string;
  }) {
    sequence += 1;
    const message = await db.sourceMessage.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceType: "FIXTURE",
        sourceProvider: "phase11-test",
        externalMessageId: `phase11-${sequence}`,
        subject: input.subject,
        senderName: input.sender ?? "Latest Sender",
        senderAddress: "latest@example.test",
        sentAt: new Date(input.sentAt),
        bodyText: input.body,
        participants: {
          create: [
            { role: "FROM", displayName: input.sender ?? "Latest Sender", address: "latest@example.test" },
            { role: "TO", displayName: "Alex Chen", address: "alex@example.test" },
          ],
        },
      },
    });
    const run = await db.activityExtractionRun.create({
      data: {
        workspaceId: deal.workspaceId,
        sourceMessageId: message.id,
        extractor: "fixture",
        extractorVersion: "phase11",
        contractVersion: "1",
        model: "deterministic-fixture",
        status: "SUCCEEDED",
        factCount: 1,
        completedAt: new Date(input.sentAt),
      },
    });
    const fact = await db.activityFact.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceMessageId: message.id,
        activityExtractionRunId: run.id,
        factType: input.factType,
        canonicalType: input.canonicalType ?? null,
        side: input.side ?? "UNKNOWN",
        assertionStatus: input.assertionStatus ?? "PROPOSED",
        structuredPayload: input.payload,
        evidenceQuote: input.quote,
        provenanceStatus: "EXACT",
        extractionMethod: "DETERMINISTIC",
        extractorVersion: "phase11",
        model: "deterministic-fixture",
      },
    });
    if (input.review) {
      await reviewActivityFact(db, {
        sourceMessageId: message.id,
        activityFactId: fact.id,
        state: "CONFIRMED",
        expectedWorkspaceId: deal.workspaceId,
      });
    }
    return { message, fact };
  }

  async function formalRent(dealId: string, amount: number, date = "2026-09-18T12:00:00Z") {
    return db.negotiationRound.create({
      data: {
        dealId,
        side: "LANDLORD",
        roundNumber: 1,
        documentName: "Landlord formal proposal",
        documentText: "Formal source",
        documentDate: new Date(date),
        sourceType: "PASTED_TEXT",
        terms: {
          create: {
            canonicalType: "BASE_RENT",
            normalizedValue: `$${amount.toFixed(2)} / RSF / year`,
            normalizedNumeric: amount,
            normalizedUnit: "USD_PER_RSF_YEAR",
            rawValue: `$${amount.toFixed(2)}`,
            status: "PROPOSED",
            side: "LANDLORD",
            roundNumber: 1,
            confidence: 1,
            evidenceQuote: `Base rent is $${amount.toFixed(2)} per RSF.`,
            provenanceStatus: "EXACT",
            structuredPayload: rentPayload(amount),
          },
        },
      },
    });
  }

  test("B/U prose and model output do not create action directives", async () => {
    assert.deepEqual(extractActivityFacts({ bodyText: "Please send the revised proposal by Friday." }), []);
    const facts = await extractActivityFactsWithModel(
      { bodyText: "Please send the revised proposal." },
      async () => JSON.stringify({
        facts: [{
          factType: "OTHER",
          canonicalType: null,
          side: "UNKNOWN",
          assertionStatus: "PROPOSED",
          evidenceQuote: "Please send the revised proposal.",
          display: "Request",
          numeric: null,
          unit: null,
          negotiation: null,
          action: directive({ kind: "RESPONSE_REQUESTED", responsibleSide: "OUR_SIDE" }),
        }],
      })
    );
    assert.equal(facts.length, 1);
    assert.equal("action" in facts[0]!, false);
  });

  test("A/C/D/E/F/W reviewed response request is outstanding, dated, and sourced", async () => {
    const deal = await createTestDeal(db);
    await record(deal, {
      subject: "Response requested",
      body: "Please send the revised proposal.",
      sentAt: "2026-09-28T15:00:00Z",
      factType: "OTHER",
      quote: "Please send the revised proposal.",
      review: true,
      payload: payload({
        display: "Revised proposal requested",
        action: directive({
          kind: "RESPONSE_REQUESTED",
          responsibleSide: "OUR_SIDE",
          responsibleLabel: "Our team",
          counterpartyLabel: "Landlord broker",
          dueAt: "2026-10-02T15:00:00-04:00",
          dueText: "Friday",
        }),
      }),
    });
    await record(deal, {
      subject: "Unreviewed request",
      body: "Please respond.",
      sentAt: "2026-09-28T16:00:00Z",
      factType: "OTHER",
      quote: "Please respond.",
      payload: payload({
        action: directive({ kind: "RESPONSE_REQUESTED", responsibleSide: "OUR_SIDE" }),
      }),
    });
    await record(deal, {
      subject: "Undated request",
      body: "Please confirm receipt.",
      sentAt: "2026-09-28T17:00:00Z",
      factType: "OTHER",
      quote: "Please confirm receipt.",
      review: true,
      payload: payload({
        action: directive({ kind: "RESPONSE_REQUESTED", responsibleSide: "OUR_SIDE", dueText: "soon" }),
      }),
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.ok(state);
    assert.equal(state.court.value, "OUR_SIDE");
    assert.ok(state.court.evidence.length > 0);
    assert.equal(state.court.evidence.every((item) => item.factId && item.href && item.evidenceQuote), true);
    const dated = state.outstandingActions.find((action) => action.dueText === "Friday");
    assert.equal(dated?.kind, "RESPONSE_REQUESTED");
    assert.equal(dated?.dueAt, "2026-10-02T15:00:00-04:00");
    assert.equal(dated?.responsibleSide, "OUR_SIDE");
    assert.equal(dated?.confidence, "REVIEWED");
    assert.equal(dated?.status, "OPEN");
    assert.equal(dated?.source.evidenceQuote, "Please send the revised proposal.");
    assert.equal(state.outstandingActions.some((action) => action.description === "Please respond."), false);
    const undated = state.outstandingActions.find((action) => action.description === "Please confirm receipt.");
    assert.equal(undated?.dueAt, null);
    assert.equal(state.deadlines.some((deadline) => deadline.dueAt === "2026-10-02T15:00:00-04:00" && deadline.dueText === "Friday"), true);
    assert.equal(state.actions.every((action) => action.source.factId && action.source.timestamp && action.source.href), true);
  });

  test("B reviewed prose without a directive creates no action", async () => {
    const deal = await createTestDeal(db);
    await record(deal, {
      subject: "Narrative",
      body: "Please send the revised proposal.",
      sentAt: "2026-09-28T15:00:00Z",
      factType: "OTHER",
      quote: "Please send the revised proposal.",
      review: true,
      payload: payload({ display: "Please send the revised proposal." }),
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.deepEqual(state?.actions, []);
    assert.equal(state?.court.value, "UNKNOWN");
  });

  test("E a deadline fact does not invent an instant", async () => {
    const deal = await createTestDeal(db);
    await record(deal, {
      subject: "Friday mention",
      body: "Response due Friday.",
      sentAt: "2026-09-28T15:00:00Z",
      factType: "DEADLINE",
      quote: "Response due Friday.",
      review: true,
      payload: payload({ display: "Friday" }),
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.equal(state?.deadlines.length, 1);
    assert.equal(state?.deadlines[0]?.kind, "HARD_DEADLINE");
    assert.equal(state?.deadlines[0]?.dueAt, null);
    assert.equal(state?.deadlines[0]?.dueText, "Friday");
    assert.equal(state?.deadlines[0]?.passed, false);
    assert.equal(state?.actions.length, 0);
  });

  test("G/H/I/J/K court follows explicit responsibility and ignores sender or open paper", async () => {
    const counterparty = await createTestDeal(db);
    await record(counterparty, {
      subject: "Their action",
      body: "Landlord will send the survey.",
      sentAt: "2026-09-28T15:00:00Z",
      factType: "OTHER",
      quote: "Landlord will send the survey.",
      review: true,
      sender: "Our Broker",
      payload: payload({
        action: directive({ kind: "DOCUMENT_REQUESTED", responsibleSide: "COUNTERPARTY", counterpartyLabel: "Landlord" }),
      }),
    });
    assert.equal((await getDealActionState(db, counterparty.id, { now: fixedNow }))?.court.value, "COUNTERPARTY");

    const both = await createTestDeal(db);
    await record(both, {
      subject: "Ours",
      body: "We owe a response.",
      sentAt: "2026-09-28T15:00:00Z",
      factType: "OTHER",
      quote: "We owe a response.",
      review: true,
      payload: payload({ action: directive({ kind: "RESPONSE_REQUESTED", responsibleSide: "OUR_SIDE" }) }),
    });
    await record(both, {
      subject: "Theirs",
      body: "They owe the exhibits.",
      sentAt: "2026-09-28T16:00:00Z",
      factType: "OTHER",
      quote: "They owe the exhibits.",
      review: true,
      payload: payload({ action: directive({ kind: "INFORMATION_REQUESTED", responsibleSide: "COUNTERPARTY" }) }),
    });
    const bothState = await getDealActionState(db, both.id, { now: fixedNow });
    assert.equal(bothState?.court.value, "BOTH");
    assert.equal(bothState?.court.evidence.length, 2);

    const unknown = await createTestDeal(db);
    await record(unknown, {
      subject: "Unassigned",
      body: "Someone should follow up.",
      sentAt: "2026-09-28T15:00:00Z",
      factType: "OTHER",
      quote: "Someone should follow up.",
      review: true,
      payload: payload({ action: directive({ kind: "FOLLOW_UP_REQUESTED", responsibleSide: "UNKNOWN" }) }),
    });
    assert.equal((await getDealActionState(db, unknown.id, { now: fixedNow }))?.court.value, "UNKNOWN");

    const sender = await createTestDeal(db);
    await record(sender, {
      subject: "Latest email",
      body: "Landlord proposes $70.00/RSF/year.",
      sentAt: "2026-09-28T18:00:00Z",
      factType: "NEGOTIATION_VALUE",
      canonicalType: "BASE_RENT",
      side: "LANDLORD",
      quote: "Landlord proposes $70.00/RSF/year.",
      review: true,
      sender: "Landlord Broker",
      payload: payload({ display: "$70.00 / RSF / year", numeric: 70, unit: "USD_PER_RSF_YEAR" }),
    });
    assert.equal((await getDealActionState(db, sender.id, { now: fixedNow }))?.court.value, "UNKNOWN");

    const paper = await createTestDeal(db);
    await formalRent(paper.id, 67);
    const paperState = await getDealActionState(db, paper.id, { now: fixedNow });
    assert.equal(paperState?.court.value, "UNKNOWN");
    assert.equal(paperState?.actions.length, 0);
  });

  test("L/M fulfillment closes only through an explicit structured link", async () => {
    const closed = await createTestDeal(db);
    const request = await record(closed, {
      subject: "Send proposal",
      body: "Please send the revised proposal.",
      sentAt: "2026-09-20T15:00:00Z",
      factType: "OTHER",
      quote: "Please send the revised proposal.",
      review: true,
      payload: payload({ action: directive({ kind: "DOCUMENT_REQUESTED", responsibleSide: "COUNTERPARTY" }) }),
    });
    await record(closed, {
      subject: "Proposal attached",
      body: "Attached is the revised proposal.",
      sentAt: "2026-09-22T15:00:00Z",
      factType: "DOCUMENT_RECEIVED",
      assertionStatus: "ACCEPTED",
      quote: "Attached is the revised proposal.",
      review: true,
      payload: payload({
        display: "Revised proposal received",
        action: directive({ kind: "FULFILLMENT", responsibleSide: "COUNTERPARTY", fulfillsFactId: request.fact.id }),
      }),
    });
    const closedState = await getDealActionState(db, closed.id, { now: fixedNow });
    assert.equal(closedState?.actions[0]?.status, "CLOSED");
    assert.equal(closedState?.outstandingActions.length, 0);
    assert.equal(closedState?.court.value, "NONE");
    assert.equal(closedState?.actions[0]?.source.evidenceQuote, "Please send the revised proposal.");
    assert.equal(closedState?.actions[0]?.fulfillment?.evidenceQuote, "Attached is the revised proposal.");
    assert.ok(closedState?.court.evidence.length);

    const ambiguous = await createTestDeal(db);
    await record(ambiguous, {
      subject: "Send proposal",
      body: "Please send the revised proposal.",
      sentAt: "2026-09-20T15:00:00Z",
      factType: "OTHER",
      quote: "Please send the revised proposal.",
      review: true,
      payload: payload({ action: directive({ kind: "DOCUMENT_REQUESTED", responsibleSide: "OUR_SIDE" }) }),
    });
    await record(ambiguous, {
      subject: "Attachment note",
      body: "Attached is the revised proposal.",
      sentAt: "2026-09-22T15:00:00Z",
      factType: "DOCUMENT_RECEIVED",
      assertionStatus: "ACCEPTED",
      quote: "Attached is the revised proposal.",
      review: true,
      payload: payload({ display: "Revised proposal received" }),
    });
    await record(ambiguous, {
      subject: "Unreviewed fulfillment",
      body: "This fulfills the request.",
      sentAt: "2026-09-23T15:00:00Z",
      factType: "DOCUMENT_RECEIVED",
      assertionStatus: "ACCEPTED",
      quote: "This fulfills the request.",
      payload: payload({
        action: directive({ kind: "FULFILLMENT", fulfillsFactId: "not-used" }),
      }),
    });
    const openState = await getDealActionState(db, ambiguous.id, { now: fixedNow });
    assert.equal(openState?.outstandingActions.length, 1);
    assert.equal(openState?.outstandingActions[0]?.status, "OPEN");
    assert.equal(openState?.outstandingActions[0]?.fulfillment, null);
  });

  test("N/O/P staleness, deadline rank, and meetings stay narrow", async () => {
    const deal = await createTestDeal(db);
    const staleAt = new Date(fixedNow.getTime() - (ACTION_INTELLIGENCE_THRESHOLDS.staleAfterDays + 1) * ACTION_DAY_MS).toISOString();
    const freshAt = new Date(fixedNow.getTime() - 2 * ACTION_DAY_MS).toISOString();
    await record(deal, {
      subject: "Old rent note",
      body: "Landlord proposes $70.00/RSF/year.",
      sentAt: staleAt,
      factType: "NEGOTIATION_VALUE",
      canonicalType: "BASE_RENT",
      side: "LANDLORD",
      quote: "Landlord proposes $70.00/RSF/year.",
      review: true,
      payload: payload({ display: "$70.00 / RSF / year", numeric: 70, unit: "USD_PER_RSF_YEAR" }),
    });
    await record(deal, {
      subject: "Stale follow-up",
      body: "Please send the exhibits.",
      sentAt: staleAt,
      factType: "OTHER",
      quote: "Please send the exhibits.",
      review: true,
      payload: payload({ action: directive({ kind: "INFORMATION_REQUESTED", responsibleSide: "COUNTERPARTY" }) }),
    });
    await record(deal, {
      subject: "Recent follow-up",
      body: "Please send the insurance certificate.",
      sentAt: freshAt,
      factType: "OTHER",
      quote: "Please send the insurance certificate.",
      review: true,
      payload: payload({ action: directive({ kind: "INFORMATION_REQUESTED", responsibleSide: "COUNTERPARTY" }) }),
    });
    await record(deal, {
      subject: "Passed deadline",
      body: "Response was due Monday.",
      sentAt: "2026-09-21T15:00:00Z",
      factType: "DEADLINE",
      quote: "Response was due Monday.",
      review: true,
      payload: payload({
        display: "Monday deadline",
        action: directive({
          kind: "RESPONSE_REQUESTED",
          responsibleSide: "OUR_SIDE",
          dueAt: "2026-09-21T15:00:00Z",
          dueText: "Monday",
        }),
      }),
    });
    await record(deal, {
      subject: "Tuesday call",
      body: "Call Tuesday at 10.",
      sentAt: "2026-09-22T15:00:00Z",
      factType: "CALL",
      quote: "Call Tuesday at 10.",
      review: true,
      payload: payload({
        display: "Tuesday call",
        action: directive({
          kind: "SCHEDULED",
          occursAt: "2026-10-06T14:00:00Z",
        }),
      }),
    });
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    assert.ok(state);
    assert.equal(state.staleItems.length, 1);
    assert.equal(state.staleItems[0]?.description, "Please send the exhibits.");
    assert.match(state.staleItems[0]?.timingLabel ?? "", /^Outstanding for \d+ days$/);
    assert.equal(state.outstandingActions.some((action) => action.description === "Please send the insurance certificate." && action.stale), false);
    assert.equal(state.actions.find((action) => action.dueText === "Monday")?.timingLabel, "Past due");
    const passedRank = state.ranked.findIndex((item) => item.priority === "DEADLINE_PASSED");
    const staleRank = state.ranked.findIndex((item) => item.priority === "STALE_OUTSTANDING");
    const meetingRank = state.ranked.findIndex((item) => item.priority === "UPCOMING_MEETING");
    assert.ok(passedRank >= 0 && passedRank < staleRank);
    assert.ok(meetingRank >= 0 && meetingRank < staleRank);
    assert.equal(state.meetings[0]?.kind, "CALL");
    assert.equal(state.meetings[0]?.occursAt, "2026-10-06T14:00:00Z");
    assert.equal(state.meetings[0]?.participants.some((person) => person.address === "alex@example.test"), true);
    assert.equal(state.deadlines.some((deadline) => deadline.kind === "HARD_DEADLINE" && deadline.passed), true);
    assert.equal(state.meetings.every((meeting) => state.deadlines.every((deadline) => deadline.id !== meeting.id)), true);
  });

  test("Q/R/S preparation reads formal state and discrepancies without changing either", async () => {
    const deal = await createTestDeal(db);
    await formalRent(deal.id, 67, "2026-09-20T12:00:00Z");
    await record(deal, {
      subject: "Communicated rent",
      body: "Landlord said $72.00/RSF/year.",
      sentAt: "2026-09-22T15:00:00Z",
      factType: "NEGOTIATION_VALUE",
      canonicalType: "BASE_RENT",
      side: "LANDLORD",
      quote: "Landlord said $72.00/RSF/year.",
      review: true,
      payload: payload({ display: "$72.00 / RSF / year", numeric: 72, unit: "USD_PER_RSF_YEAR" }),
    });
    await record(deal, {
      subject: "Prep meeting",
      body: "Meeting next week.",
      sentAt: "2026-09-25T15:00:00Z",
      factType: "MEETING",
      quote: "Meeting next week.",
      review: true,
      payload: payload({
        display: "Negotiation meeting",
        action: directive({ kind: "SCHEDULED", occursAt: "2026-10-03T15:00:00Z" }),
      }),
    });
    const beforeTerms = await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } });
    const before = await getNegotiationWorkspace(db, deal.id);
    const state = await getDealActionState(db, deal.id, { now: fixedNow });
    const after = await getNegotiationWorkspace(db, deal.id);
    assert.equal(await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), beforeTerms);
    assert.deepEqual(
      after?.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition,
      before?.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition
    );
    const prep = state?.preparation[0];
    assert.ok(prep);
    assert.match(prep.openTerms.find((term) => term.canonicalType === "BASE_RENT")?.summary ?? "", /67/);
    assert.equal(prep.discrepancies.some((item) => item.communicationValue.includes("72") && item.formalValue?.includes("67")), true);
    assert.equal(prep.discrepancies[0]?.priority, "PAPER_COMMUNICATION_DISCREPANCY");
    assert.ok(prep.changes.some((change) => change.label.includes("Landlord proposal")));
    assert.equal(state?.ranked.some((item) => item.priority === "PAPER_COMMUNICATION_DISCREPANCY"), true);
    const rankGap = (state?.ranked.findIndex((item) => item.kind === "DISCREPANCY") ?? -1);
    const staleGap = state?.ranked.findIndex((item) => item.priority === "STALE_OUTSTANDING") ?? -1;
    assert.ok(rankGap >= 0);
    assert.ok(staleGap === -1 || rankGap < staleGap);
  });

  test("T/U/V/X/Y reads do not write, call a model, or cross workspaces", async () => {
    const deal = await createTestDeal(db);
    await record(deal, {
      subject: "Owned response",
      body: "Please reply.",
      sentAt: "2026-09-28T15:00:00Z",
      factType: "OTHER",
      quote: "Please reply.",
      review: true,
      payload: payload({ action: directive({ kind: "RESPONSE_REQUESTED", responsibleSide: "OUR_SIDE" }) }),
    });
    const before = {
      facts: await db.activityFact.count(),
      terms: await db.negotiationTerm.count(),
      events: await db.dealEvent.count(),
      runs: await db.activityExtractionRun.count(),
      reviews: await db.activityFactReview.count(),
      decisions: await db.messageReviewDecision.count(),
    };
    const first = await getDealActionState(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow });
    const second = await getDealActionState(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow });
    assert.deepEqual(second, first);
    assert.deepEqual({
      facts: await db.activityFact.count(),
      terms: await db.negotiationTerm.count(),
      events: await db.dealEvent.count(),
      runs: await db.activityExtractionRun.count(),
      reviews: await db.activityFactReview.count(),
      decisions: await db.messageReviewDecision.count(),
    }, before);
    const foreign = await db.workspace.create({ data: { name: "Foreign action workspace" } });
    assert.equal(await getDealActionState(db, deal.id, { expectedWorkspaceId: foreign.id, now: fixedNow }), null);
    assert.throws(
      () => parseDealActionQuery(new URLSearchParams("workspaceId=client-controlled")),
      (error) => error instanceof DealActionQueryError
    );
  });

  test("Z/AA DealBrief stays valid and 200 Clarendon formal truth is unchanged", async () => {
    const deal = await createTestDeal(db);
    await formalRent(deal.id, 67);
    await db.dealEvent.create({
      data: {
        dealId: deal.id,
        type: "EMAIL",
        description: "Landlord issued legacy counter at $72.50/RSF/year.",
        occurredAt: new Date("2026-09-16T12:00:00Z"),
        confidence: 1,
        evidenceQuote: "Base rent: $72.50/RSF/year",
      },
    });
    const before = await db.negotiationTerm.findFirstOrThrow({
      where: { round: { dealId: deal.id }, canonicalType: "BASE_RENT" },
    });
    const brief = await getDealBrief(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow });
    const again = await getDealBrief(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow });
    assert.deepEqual(again, brief);
    assert.equal(brief?.actions.court.value, "UNKNOWN");
    assert.equal(brief?.negotiation.summary.conflictCount, 0);
    const landlord = brief?.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition;
    assert.match(landlord?.kind === "VALUE" ? landlord.value.summary : "", /67\.00/);
    assert.match(brief?.timeline.find((item) => item.type === "LEGACY_ACTIVITY")?.description ?? "", /72\.50/);
    const after = await db.negotiationTerm.findFirstOrThrow({ where: { id: before.id } });
    assert.equal(after.normalizedNumeric, 67);
    assert.equal(after.normalizedValue, before.normalizedValue);
    assert.equal(await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), 1);
  });

  test("direct derivation ranks a discrepancy ahead of a generic stale action", () => {
    const staleAt = new Date(fixedNow.getTime() - 8 * ACTION_DAY_MS).toISOString();
    const state = deriveDealActionState({
      now: fixedNow,
      openTerms: [],
      changes: [],
      discrepancies: [{
        id: "paper-communication:rent",
        canonicalType: "BASE_RENT",
        label: "Base Rent",
        formalValue: "$67.00 / RSF / year",
        communicationValue: "$72.00 / RSF / year",
        href: "/messages/rent",
        priority: "PAPER_COMMUNICATION_DISCREPANCY",
      }],
      facts: [{
        id: "stale-fact",
        messageId: "message-stale",
        factType: "OTHER",
        assertionStatus: "PROPOSED",
        evidenceQuote: "Please circle back.",
        timestamp: staleAt,
        subject: "Follow up",
        href: "/messages/stale",
        display: "Follow up",
        participants: [],
        reviewed: true,
        payload: payload({ action: directive({ kind: "NEXT_STEP", responsibleSide: "UNKNOWN" }) }),
      }],
    });
    const discrepancy = state.ranked.findIndex((item) => item.kind === "DISCREPANCY");
    const stale = state.ranked.findIndex((item) => item.priority === "STALE_OUTSTANDING");
    assert.ok(discrepancy >= 0 && discrepancy < stale);
    assert.equal(state.actions[0]?.priority, "STALE_OUTSTANDING");
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
