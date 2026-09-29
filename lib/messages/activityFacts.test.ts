import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { FIXTURE_500_TEST_STREET } from "@/lib/ai/activity/fixtures";
import { deterministicExtractorIdentity } from "@/lib/ai/activity/extractActivityFacts";
import { getActivityPage } from "@/lib/activity/service";
import { buildSourceChronology } from "@/lib/deals/reconciliation/present";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { createWorkspace } from "@/lib/entities/workspace";
import { resolveCurrentState } from "@/lib/negotiation/resolveCurrentState";
import type { NegotiationRoundRecord } from "@/lib/negotiation/types";
import { analyzeSourceMessage, getMessageSource, ingestSourceMessage } from "./service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

async function counts() {
  const [messages, runs, facts, terms, people, companies, observations, relationships, reviews, events] = await Promise.all([
    prisma.sourceMessage.count(),
    prisma.activityExtractionRun.count(),
    prisma.activityFact.count(),
    prisma.negotiationTerm.count(),
    prisma.person.count(),
    prisma.company.count(),
    prisma.entityObservation.count(),
    prisma.relationshipObservation.count(),
    prisma.reviewDecision.count(),
    prisma.dealEvent.count(),
  ]);
  return { messages, runs, facts, terms, people, companies, observations, relationships, reviews, events };
}

async function rentRound(dealId: string, numeric: number, roundNumber: number, date: string) {
  return prisma.negotiationRound.create({
    data: {
      dealId,
      side: "LANDLORD",
      roundNumber,
      documentName: `Landlord ${roundNumber}`,
      documentText: "Stored negotiation text",
      documentDate: new Date(date),
      sourceType: "PASTED_TEXT",
      terms: {
        create: {
          canonicalType: "BASE_RENT",
          normalizedValue: `$${numeric.toFixed(2)} / RSF / year`,
          normalizedNumeric: numeric,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: `$${numeric.toFixed(2)} per RSF per year`,
          status: "PROPOSED",
          side: "LANDLORD",
          roundNumber,
          confidence: 1,
          evidenceQuote: "Base rent evidence",
          structuredPayload: { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: numeric } },
        },
      },
    },
    include: { terms: true },
  });
}

describe("structured message activity", () => {
  test("before", async () => {
    const db = await createTestDatabase();
    prisma = db.prisma;
    cleanup = db.cleanup;
  });

  test("A C message storage and recipient roles", async () => {
    const deal = await createTestDeal(prisma);
    const message = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      subject: FIXTURE_500_TEST_STREET.subject,
      senderName: FIXTURE_500_TEST_STREET.senderName,
      senderAddress: FIXTURE_500_TEST_STREET.senderAddress,
      sentAt: new Date("2026-09-22T15:00:00Z"),
      receivedAt: new Date("2026-09-22T15:01:00Z"),
      bodyText: FIXTURE_500_TEST_STREET.bodyText,
      sourceType: "FIXTURE",
      externalMessageId: "fixture-500",
      participants: [
        { role: "TO", displayName: "Alex Rivera", address: "alex.rivera@example-landlord.test" },
        { role: "CC", displayName: "Jordan Hale", address: "jordan.hale@example-tenant.test" },
        { role: "BCC", address: "archive@example-broker.test" },
      ],
    });
    assert.equal(message.workspaceId, deal.workspaceId);
    assert.equal(message.subject, "Re: 500 Test Street Proposal");
    assert.deepEqual(
      message.participants.map((item) => item.role).sort(),
      ["BCC", "CC", "FROM", "TO"]
    );
    const before = await counts();
    const analyzed = await analyzeSourceMessage(prisma, message.id);
    assert.equal(analyzed.factCount, 5);
    const again = await analyzeSourceMessage(prisma, message.id);
    assert.equal(again.idempotent, true);
    assert.equal(again.runId, analyzed.runId);
    assert.equal((await counts()).facts, before.facts + 5);
    const view = await getMessageSource(prisma, message.id);
    assert.equal(view?.facts.length, 5);
    assert.equal(view?.facts.filter((fact) => fact.canonicalType === "BASE_RENT" && fact.assertionStatus === "PROPOSED")[0]?.value, "$68.00 / RSF / year");
    assert.equal(view?.facts.find((fact) => fact.canonicalType === "TI_ALLOWANCE")?.value, "$105.00 / RSF");
    assert.equal(view?.facts.find((fact) => fact.canonicalType === "FREE_RENT")?.value, "5 months");
    assert.equal(view?.facts.find((fact) => fact.canonicalType === "LEASE_TERM")?.value, "10 years");
    const rent = view?.facts.find((fact) => fact.canonicalType === "BASE_RENT" && fact.assertionStatus === "PROPOSED");
    assert.equal(rent?.extractionMethod, "DETERMINISTIC");
    assert.equal(rent?.provenanceStatus, "EXACT");
    assert.equal(view?.bodyText.slice(rent!.evidenceStartOffset!, rent!.evidenceEndOffset!), rent?.evidenceQuote);
  });

  test("B workspace isolation", async () => {
    const deal = await createTestDeal(prisma);
    const otherWorkspace = await createWorkspace(prisma, { name: "Other firm" });
    const otherDeal = await prisma.deal.create({
      data: { name: "Other", company: "Other", property: "Elsewhere", stage: "LOI", status: "ACTIVE", workspaceId: otherWorkspace.id },
    });
    const hidden = await ingestSourceMessage(prisma, {
      dealId: otherDeal.id,
      bodyText: "Landlord proposes $10/RSF/year.",
      sourceType: "MANUAL",
      subject: "Hidden",
    });
    await analyzeSourceMessage(prisma, hidden.id);
    const page = await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id });
    assert.equal(page?.events.some((event) => event.sourceId === hidden.id), false);
    const reconciliation = await getDealReconciliation(prisma, deal.id);
    assert.equal(reconciliation?.links.some((link) => link.eventValue?.numeric === 10), false);
    const visible = await getMessageSource(prisma, hidden.id);
    assert.equal(visible?.deal.id, otherDeal.id);
    assert.equal(visible?.facts.every((fact) => fact.value.includes("10")), true);
  });

  test("S T U same run, new model, and immutable facts", async () => {
    const deal = await createTestDeal(prisma);
    const message = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      bodyText: "Landlord proposes $70/RSF/year.",
      sourceType: "MANUAL",
      subject: "Rent",
    });
    const first = await analyzeSourceMessage(prisma, message.id);
    const stored = await prisma.activityFact.findMany({ where: { sourceMessageId: message.id } });
    const second = await analyzeSourceMessage(prisma, message.id);
    assert.equal(second.runId, first.runId);
    const still = await prisma.activityFact.findMany({ where: { sourceMessageId: message.id } });
    assert.deepEqual(still.map((fact) => fact.id), stored.map((fact) => fact.id));
    assert.deepEqual(still.map((fact) => fact.structuredPayload), stored.map((fact) => fact.structuredPayload));
    const next = await analyzeSourceMessage(prisma, message.id, {
      extractor: { ...deterministicExtractorIdentity(), model: "phase9c-model-b" },
    });
    assert.notEqual(next.runId, first.runId);
    assert.equal(await prisma.activityExtractionRun.count({ where: { sourceMessageId: message.id } }), 2);
    assert.equal(await prisma.activityFact.count({ where: { activityExtractionRunId: first.runId } }), 1);
    const view = await getMessageSource(prisma, message.id);
    assert.equal(view?.facts.length, 1);
    assert.equal(view?.facts[0]?.value, "$70.00 / RSF / year");
  });

  test("V W facts do not create negotiation truth", async () => {
    const deal = await createTestDeal(prisma);
    const round = await rentRound(deal.id, 67, 1, "2026-09-18T00:00:00Z");
    const before = await counts();
    const message = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      bodyText: "Landlord proposes $72.50/RSF/year.",
      sourceType: "MANUAL",
    });
    await analyzeSourceMessage(prisma, message.id);
    const after = await counts();
    assert.equal(after.terms, before.terms);
    assert.equal(after.people, before.people);
    assert.equal(after.companies, before.companies);
    assert.equal(after.observations, before.observations);
    assert.equal(after.relationships, before.relationships);
    assert.equal(after.reviews, before.reviews);
    const records: NegotiationRoundRecord[] = [{
      id: round.id,
      side: "LANDLORD",
      roundNumber: 1,
      documentName: round.documentName,
      documentText: "",
      documentDate: round.documentDate,
      createdAt: round.createdAt,
      terms: round.terms.map((term) => ({
        id: term.id,
        canonicalType: "BASE_RENT",
        normalizedValue: term.normalizedValue,
        normalizedNumeric: term.normalizedNumeric,
        normalizedUnit: term.normalizedUnit,
        rawValue: term.rawValue,
        status: "PROPOSED",
        side: "LANDLORD",
        roundNumber: 1,
        confidence: 1,
        evidenceQuote: term.evidenceQuote,
        sourceLocation: null,
      })),
    }];
    assert.equal(resolveCurrentState(records, "BASE_RENT").currentLandlordTerm?.normalizedNumeric, 67);
  });

  test("X Y Z reconciliation relationships", async () => {
    const currentDeal = await createTestDeal(prisma);
    await rentRound(currentDeal.id, 67, 1, "2026-09-18T00:00:00Z");
    const currentMessage = await ingestSourceMessage(prisma, {
      dealId: currentDeal.id,
      bodyText: "Landlord proposes $67/RSF/year.",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-22T00:00:00Z"),
    });
    await analyzeSourceMessage(prisma, currentMessage.id);
    const current = await getDealReconciliation(prisma, currentDeal.id);
    assert.equal(current?.links.find((link) => link.canonicalType === "BASE_RENT")?.relationship, "MATCHES_CURRENT");

    const historicalDeal = await createTestDeal(prisma);
    await rentRound(historicalDeal.id, 72.5, 1, "2026-09-08T00:00:00Z");
    await rentRound(historicalDeal.id, 67, 2, "2026-09-18T00:00:00Z");
    const historicalMessage = await ingestSourceMessage(prisma, {
      dealId: historicalDeal.id,
      bodyText: "Landlord proposes $72.50/RSF/year.",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-22T00:00:00Z"),
    });
    await analyzeSourceMessage(prisma, historicalMessage.id);
    const historical = await getDealReconciliation(prisma, historicalDeal.id);
    assert.equal(historical?.links.find((link) => link.canonicalType === "BASE_RENT")?.relationship, "MATCHES_HISTORICAL");

    const differsDeal = await createTestDeal(prisma);
    await rentRound(differsDeal.id, 67, 1, "2026-09-18T00:00:00Z");
    const differsMessage = await ingestSourceMessage(prisma, {
      dealId: differsDeal.id,
      bodyText: "Landlord countered at $72.50/RSF/year.",
      sourceType: "MANUAL",
      sentAt: new Date("2026-09-22T00:00:00Z"),
      subject: "Counter received",
    });
    await analyzeSourceMessage(prisma, differsMessage.id);
    const differs = await getDealReconciliation(prisma, differsDeal.id);
    const link = differs?.links.find((link) => link.canonicalType === "BASE_RENT");
    assert.equal(link?.relationship, "DIFFERS_FROM_CURRENT");
    assert.equal(link?.eventSource.href, `/messages/${differsMessage.id}`);
    const chronology = buildSourceChronology({
      canonicalType: "BASE_RENT",
      currentTenant: null,
      currentLandlord: "$67.00 / RSF / year",
      links: differs?.links ?? [],
      observations: [{
        id: "round",
        roundId: "round",
        roundName: "Revised Counterproposal",
        roundDate: "2026-09-18T00:00:00.000Z",
        side: "LANDLORD",
        valueDisplay: "$67.00 / RSF / year",
        href: null,
        sourceLabel: "Revised Counterproposal",
      }],
    });
    assert.equal(chronology.entries.filter((entry) => entry.sourceKind === "NEGOTIATION_ROUND").length, 1);
    const email = chronology.entries.find((entry) => entry.sourceKind === "DEAL_ACTIVITY");
    assert.equal(email?.sourceLabel, "Email");
    assert.match(email?.statement ?? "", /72\.50/);
    assert.equal(email?.href, `/messages/${differsMessage.id}`);
    assert.equal(email?.roundId, null);
  });

  test("incompatible units, activity-only facts, legacy fallback, and dedupe", async () => {
    const deal = await createTestDeal(prisma);
    await rentRound(deal.id, 67, 1, "2026-09-18T00:00:00Z");
    const legacy = await prisma.dealEvent.create({
      data: {
        dealId: deal.id,
        type: "COUNTER_RECEIVED",
        description: "Landlord countered at $72.50/RSF/year, 4 months free rent.",
        occurredAt: new Date("2026-09-22T00:00:00Z"),
        confidence: 1,
        evidenceQuote: "Landlord countered at $72.50/RSF/year, 4 months free rent.",
      },
    });
    const prose = await getDealReconciliation(prisma, deal.id);
    assert.equal(prose?.links.some((link) => link.relationship === "DIFFERS_FROM_CURRENT" && link.eventValue?.numeric === 72.5), true);
    assert.equal(prose?.links.every((link) => link.activityEventId === `deal-event:${legacy.id}`), true);

    const linked = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      bodyText: "Landlord countered at $72.50/RSF/year.",
      sourceType: "FIXTURE",
      legacyDealEventId: legacy.id,
      sentAt: new Date("2026-09-22T00:00:00Z"),
      subject: "Counter received",
    });
    await analyzeSourceMessage(prisma, linked.id);
    const deduped = await getDealReconciliation(prisma, deal.id);
    assert.equal(deduped?.links.every((link) => link.activityEventId === `source-message:${linked.id}`), true);
    assert.equal(await prisma.dealEvent.count({ where: { id: legacy.id } }), 1);

    const monthly = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      bodyText: "Landlord proposes $5000 total monthly rent.",
      sourceType: "MANUAL",
    });
    await analyzeSourceMessage(prisma, monthly.id, {
      complete: async () => JSON.stringify({
        facts: [{
          factType: "NEGOTIATION_VALUE",
          canonicalType: "BASE_RENT",
          side: "LANDLORD",
          assertionStatus: "PROPOSED",
          evidenceQuote: "Landlord proposes $5000 total monthly rent.",
          display: "$5,000.00 total monthly",
          numeric: 5000,
          unit: "USD_PER_MONTH",
          negotiation: null,
        }],
      }),
      extractor: { ...deterministicExtractorIdentity(), model: "unit-model" },
    });
    const units = await getDealReconciliation(prisma, deal.id);
    assert.equal(units?.links.some((link) => link.explanationCode === "INCOMPATIBLE_UNITS"), true);

    const meeting = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      bodyText: "Let's meet Tuesday.",
      sourceType: "MANUAL",
      subject: "Tour follow up",
    });
    await analyzeSourceMessage(prisma, meeting.id, {
      complete: async () => JSON.stringify({
        facts: [{
          factType: "MEETING",
          canonicalType: null,
          side: "UNKNOWN",
          assertionStatus: "PROPOSED",
          evidenceQuote: "Let's meet Tuesday.",
          display: "Meeting",
          numeric: null,
          unit: null,
          negotiation: null,
        }],
      }),
      extractor: { ...deterministicExtractorIdentity(), model: "meeting-model" },
    });
    const activityOnly = await getDealReconciliation(prisma, deal.id);
    assert.equal(activityOnly?.links.some((link) => link.activityEventId === `source-message:${meeting.id}` && link.explanationCode === "NON_ECONOMIC_ACTIVITY"), true);
    const page = await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id });
    const email = page?.events.find((event) => event.sourceId === linked.id);
    assert.equal(email?.sourceType, "SOURCE_MESSAGE");
    assert.equal(page?.events.some((event) => event.sourceId === legacy.id), false);
    assert.match(email?.description ?? "", /negotiation fact/);
  });

  test("message, activity, and negotiation reads do not write", async () => {
    const deal = await createTestDeal(prisma);
    const message = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      bodyText: "Landlord proposes $68/RSF/year.",
      sourceType: "MANUAL",
    });
    await analyzeSourceMessage(prisma, message.id);
    const before = await counts();
    await getMessageSource(prisma, message.id);
    await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id });
    await getDealReconciliation(prisma, deal.id);
    assert.deepEqual(await counts(), before);
  });

  test("R canonical participation side is explicit", async () => {
    const deal = await createTestDeal(prisma);
    const person = await prisma.person.create({
      data: {
        workspaceId: deal.workspaceId,
        canonicalName: "Alex Tenant",
        identifiers: {
          create: {
            workspaceId: deal.workspaceId,
            kind: "EMAIL",
            value: "alex@tenant.test",
            normalizedValue: "alex@tenant.test",
          },
        },
      },
    });
    await prisma.dealParticipation.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        personId: person.id,
        role: "TENANT",
        assertionSource: "MANUAL",
      },
    });
    const message = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      senderAddress: "alex@tenant.test",
      bodyText: "We propose $64/RSF/year.",
      sourceType: "MANUAL",
    });
    await analyzeSourceMessage(prisma, message.id);
    const conservative = await prisma.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    assert.equal(conservative.side, "UNKNOWN");
    await analyzeSourceMessage(prisma, message.id, {
      allowParticipationSideLookup: true,
      extractor: { ...deterministicExtractorIdentity(), model: "participation-side" },
    });
    const viewed = await getMessageSource(prisma, message.id);
    assert.equal(viewed?.facts[0]?.side, "TENANT");
  });

  test("message fact view keeps the stored extraction method", async () => {
    const deal = await createTestDeal(prisma);
    const message = await ingestSourceMessage(prisma, {
      dealId: deal.id,
      bodyText: "Landlord proposes $72.00/RSF/year.",
      sourceType: "MANUAL",
      subject: "Revised rent",
    });
    await analyzeSourceMessage(prisma, message.id);
    const deterministic = await getMessageSource(prisma, message.id);
    const rent = deterministic?.facts.find((fact) => fact.canonicalType === "BASE_RENT");
    assert.equal(rent?.value, "$72.00 / RSF / year");
    assert.equal(rent?.extractionMethod, "DETERMINISTIC");
    await prisma.activityFact.update({
      where: { id: rent!.id },
      data: { extractionMethod: "MODEL" },
    });
    const modeled = await getMessageSource(prisma, message.id);
    assert.equal(modeled?.facts.find((fact) => fact.id === rent!.id)?.extractionMethod, "MODEL");
  });

  test("after", async () => {
    await cleanup();
  });
});
