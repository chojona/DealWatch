import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import { readinessGuidance } from "@/lib/documents/readinessCopy";
import { createWorkspace, ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { resolveCurrentState } from "@/lib/negotiation/resolveCurrentState";
import type { NegotiationRoundRecord } from "@/lib/negotiation/types";
import { recordReviewDecision } from "@/lib/review/decisions";
import { buildSourceChronology } from "./present";
import { reconcileDealSources } from "./reconcile";
import { getDealReconciliation } from "./service";
import type { ReconciliationActivity, ReconciliationRound, ReconciliationTerm } from "./types";

function term(overrides: Partial<ReconciliationTerm> & Pick<ReconciliationTerm, "id" | "side" | "canonicalType">): ReconciliationTerm {
  return {
    normalizedValue: null,
    normalizedNumeric: null,
    normalizedUnit: null,
    rawValue: overrides.normalizedValue ?? overrides.canonicalType,
    status: "PROPOSED",
    evidenceQuote: `${overrides.canonicalType} evidence`,
    structuredPayload: null,
    pageNumber: null,
    ...overrides,
  };
}

function round(overrides: Partial<ReconciliationRound> & Pick<ReconciliationRound, "id" | "terms">): ReconciliationRound {
  return {
    dealId: "deal-1",
    side: "LANDLORD",
    roundNumber: 1,
    documentName: "Round",
    documentDate: new Date("2026-09-01T00:00:00Z"),
    createdAt: new Date("2026-09-01T00:00:00Z"),
    sourceType: "PASTED_TEXT",
    documentId: null,
    ...overrides,
  };
}

function activity(overrides: Partial<ReconciliationActivity> = {}): ReconciliationActivity {
  return {
    id: "event-1",
    dealId: "deal-1",
    type: "COUNTER_RECEIVED",
    description: "Landlord issued counter",
    evidenceQuote: "Base rent: $72.50/RSF",
    occurredAt: new Date("2026-09-10T00:00:00Z"),
    messageId: "message-1",
    message: { sender: "Broker <broker@jll.example>", sentAt: new Date("2026-09-10T00:00:00Z") },
    ...overrides,
  };
}

function rent(id: string, side: "TENANT" | "LANDLORD", numeric: number, display?: string): ReconciliationTerm {
  return term({
    id,
    side,
    canonicalType: "BASE_RENT",
    normalizedNumeric: numeric,
    normalizedUnit: "USD_PER_RSF_YEAR",
    normalizedValue: display ?? `$${numeric.toFixed(2)}/RSF/year`,
    rawValue: display ?? `$${numeric.toFixed(2)} per RSF per year`,
  });
}

function clarendonRounds(includeHistorical: boolean): ReconciliationRound[] {
  return [
    round({
      id: "tenant-loi",
      side: "TENANT",
      documentName: "Tenant LOI",
      documentDate: new Date("2026-09-01T00:00:00Z"),
      terms: [rent("tenant-64", "TENANT", 64)],
    }),
    ...(includeHistorical
      ? [round({
          id: "landlord-7250",
          side: "LANDLORD",
          documentName: "Landlord Counterproposal",
          documentDate: new Date("2026-09-06T00:00:00Z"),
          terms: [rent("landlord-7250", "LANDLORD", 72.5, "$72.50/RSF/year")],
        })]
      : []),
    round({
      id: "landlord-67",
      side: "LANDLORD",
      roundNumber: 2,
      documentName: "Revised Counterproposal",
      documentDate: new Date("2026-09-18T00:00:00Z"),
      terms: [rent("landlord-67", "LANDLORD", 67, "$67.00/RSF/year")],
    }),
  ];
}

function asResolverRounds(rounds: ReconciliationRound[]): NegotiationRoundRecord[] {
  return rounds.map((item) => ({
    id: item.id,
    side: item.side as "TENANT" | "LANDLORD",
    roundNumber: item.roundNumber,
    documentName: item.documentName,
    documentText: "",
    documentDate: item.documentDate,
    createdAt: item.createdAt,
    terms: item.terms.map((observed) => ({
      id: observed.id,
      canonicalType: observed.canonicalType as "BASE_RENT",
      normalizedValue: observed.normalizedValue,
      normalizedNumeric: observed.normalizedNumeric,
      normalizedUnit: observed.normalizedUnit,
      rawValue: observed.rawValue,
      status: observed.status as "PROPOSED",
      side: observed.side as "TENANT" | "LANDLORD",
      roundNumber: item.roundNumber,
      confidence: 1,
      evidenceQuote: observed.evidenceQuote,
      sourceLocation: null,
    })),
  }));
}

describe("source reconciliation", () => {
  test("A activity matches the current negotiation position", () => {
    const links = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed $67/RSF/year",
        evidenceQuote: "Base rent: $67.00/RSF/year",
        occurredAt: new Date("2026-09-18T00:00:00Z"),
      })],
      rounds: clarendonRounds(true),
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.relationship, "MATCHES_CURRENT");
    assert.deepEqual(rentLink?.matchedObservationIds, ["landlord-67"]);
    assert.equal(rentLink?.explanationCode, "MATCHES_CURRENT_OBSERVATION");
  });

  test("B and L activity matches a historical position that was superseded", () => {
    const links = reconcileDealSources({
      activities: [activity()],
      rounds: clarendonRounds(true),
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.relationship, "MATCHES_HISTORICAL");
    assert.deepEqual(rentLink?.matchedObservationIds, ["landlord-7250"]);
    assert.equal(rentLink?.currentPosition?.observationId, "landlord-67");
    assert.equal(rentLink?.currentPosition?.display, "$67.00/RSF/year");
    assert.notEqual(rentLink?.relationship, "MATCHES_CURRENT");
  });

  test("C and S activity differs from the current formal observation", () => {
    const links = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed $68/RSF/year",
        evidenceQuote: "Base rent: $68.00/RSF/year",
      })],
      rounds: clarendonRounds(false),
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.relationship, "DIFFERS_FROM_CURRENT");
    assert.equal(rentLink?.explanationCode, "DIFFERS_FROM_CURRENT_OBSERVATION");
    assert.equal(rentLink?.disagreement?.activityDisplay.includes("68"), true);
    assert.equal(rentLink?.disagreement?.observationDisplay, "$67.00/RSF/year");
    assert.equal(rentLink?.disagreement?.currentDisplay, "$67.00/RSF/year");
    assert.equal(rentLink?.disagreement?.observationId, "landlord-67");
  });

  test("D and R non-economic activity has no negotiation match", () => {
    for (const description of ["Tour scheduled", "Draft sent", "Call completed", "Document uploaded"]) {
      const links = reconcileDealSources({
        activities: [activity({ type: "CALL_COMPLETED", description, evidenceQuote: description })],
        rounds: clarendonRounds(true),
      });
      assert.equal(links.length, 1);
      assert.equal(links[0]?.relationship, "NO_NEGOTIATION_MATCH");
      assert.equal(links[0]?.explanationCode, "NON_ECONOMIC_ACTIVITY");
      assert.equal(links[0]?.canonicalType, null);
    }
  });

  test("E possible related event is not a numeric match", () => {
    const links = reconcileDealSources({
      activities: [activity({
        type: "COUNTER_RECEIVED",
        description: "Landlord came down on rent.",
        evidenceQuote: "Landlord came down on rent.",
        occurredAt: new Date("2026-09-18T00:00:00Z"),
      })],
      rounds: clarendonRounds(true),
    });
    assert.equal(links[0]?.relationship, "POSSIBLE_RELATED");
    assert.equal(links[0]?.explanationCode, "POSSIBLE_SAME_DAY_MOVEMENT");
    assert.equal(links[0]?.canonicalType, "BASE_RENT");
    assert.equal(links[0]?.matchedRoundId, "landlord-67");
    assert.deepEqual(links[0]?.matchedObservationIds, []);
    assert.equal(links[0]?.eventValue, null);
  });

  test("F and G numeric equality and inequality", () => {
    const equal = reconcileDealSources({
      activities: [activity({ evidenceQuote: "Base rent: $72.50/RSF/year" })],
      rounds: clarendonRounds(true),
    });
    assert.equal(equal.find((item) => item.canonicalType === "BASE_RENT")?.relationship, "MATCHES_HISTORICAL");
    assert.equal(equal.find((item) => item.canonicalType === "BASE_RENT")?.eventValue?.numeric, 72.5);

    const unequal = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed $72.51/RSF/year",
        evidenceQuote: "Base rent: $72.51/RSF/year",
      })],
      rounds: clarendonRounds(true),
    });
    const rentLink = unequal.find((item) => item.canonicalType === "BASE_RENT");
    assert.notEqual(rentLink?.relationship, "MATCHES_CURRENT");
    assert.notEqual(rentLink?.relationship, "MATCHES_HISTORICAL");
    assert.equal(rentLink?.relationship, "DIFFERS_FROM_CURRENT");
  });

  test("H incompatible units are not equal", () => {
    const links = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed $67 total monthly rent",
        evidenceQuote: "$67 total monthly rent",
      })],
      rounds: clarendonRounds(false),
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.relationship, "NO_NEGOTIATION_MATCH");
    assert.equal(rentLink?.explanationCode, "INCOMPATIBLE_UNITS");
    assert.equal(rentLink?.eventValue?.unit, "USD_PER_MONTH");
    assert.notEqual(rentLink?.relationship, "MATCHES_CURRENT");
  });

  test("I tenant-side match does not use the landlord position", () => {
    const links = reconcileDealSources({
      activities: [activity({
        description: "Tenant proposed $64/RSF/year",
        evidenceQuote: "Base rent: $64.00/RSF/year",
        occurredAt: new Date("2026-09-01T00:00:00Z"),
      })],
      rounds: clarendonRounds(true),
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.eventSide, "TENANT");
    assert.equal(rentLink?.relationship, "MATCHES_CURRENT");
    assert.deepEqual(rentLink?.matchedObservationIds, ["tenant-64"]);
  });

  test("J landlord-side match", () => {
    const links = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed $67.00 per RSF per year",
        evidenceQuote: "$67.00/RSF/year",
        occurredAt: new Date("2026-09-18T00:00:00Z"),
      })],
      rounds: clarendonRounds(true),
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.eventSide, "LANDLORD");
    assert.equal(rentLink?.comparedSide, "LANDLORD");
    assert.deepEqual(rentLink?.matchedObservationIds, ["landlord-67"]);
  });

  test("K unknown-side event keeps side unknown", () => {
    const links = reconcileDealSources({
      activities: [activity({
        description: "Revised economics attached",
        evidenceQuote: "$67.00/RSF/year",
        message: { sender: "Sarah Chen <s.chen@jll.example>", sentAt: new Date("2026-09-18T00:00:00Z") },
      })],
      rounds: clarendonRounds(false),
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.eventSide, "UNKNOWN");
    assert.equal(rentLink?.relationship, "MATCHES_CURRENT");
    assert.deepEqual(rentLink?.matchedObservationIds, ["landlord-67"]);
    assert.equal(rentLink?.eventSource.label.includes("Sarah Chen"), true);
  });

  test("M current observation is preferred over an older equal value", () => {
    const rounds = [
      round({
        id: "old",
        documentDate: new Date("2026-09-01T00:00:00Z"),
        terms: [rent("old-67", "LANDLORD", 67)],
      }),
      round({
        id: "new",
        roundNumber: 2,
        documentDate: new Date("2026-09-18T00:00:00Z"),
        terms: [rent("new-67", "LANDLORD", 67)],
      }),
    ];
    const links = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed $67/RSF/year",
        evidenceQuote: "$67/RSF/year",
      })],
      rounds,
    });
    const rentLink = links.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(rentLink?.relationship, "MATCHES_CURRENT");
    assert.deepEqual(rentLink?.matchedObservationIds, ["new-67"]);
  });

  test("N structured rent is compared from the structured amount", () => {
    const rounds = [round({
      id: "structured",
      documentDate: new Date("2026-09-18T00:00:00Z"),
      terms: [term({
        id: "structured-67",
        side: "LANDLORD",
        canonicalType: "BASE_RENT",
        normalizedNumeric: 99,
        normalizedUnit: "USD_PER_RSF_YEAR",
        normalizedValue: "$99.00/RSF/year",
        structuredPayload: {
          termType: "BASE_RENT",
          rent: { kind: "simple", amountPerRSFYear: 67 },
        },
      })],
    })];
    const match = reconcileDealSources({
      activities: [activity({ description: "Landlord proposed $67/RSF/year", evidenceQuote: "$67/RSF/year" })],
      rounds,
    });
    assert.equal(match[0]?.relationship, "MATCHES_CURRENT");
    assert.deepEqual(match[0]?.matchedObservationIds, ["structured-67"]);
    const miss = reconcileDealSources({
      activities: [activity({ description: "Landlord proposed $99/RSF/year", evidenceQuote: "$99/RSF/year" })],
      rounds,
    });
    assert.equal(miss[0]?.relationship, "DIFFERS_FROM_CURRENT");
  });

  test("O legacy normalized rent matches without a structured payload", () => {
    const links = reconcileDealSources({
      activities: [activity({ description: "Landlord proposed $67/RSF/year", evidenceQuote: "$67/RSF/year" })],
      rounds: [round({
        id: "legacy",
        documentDate: new Date("2026-09-18T00:00:00Z"),
        terms: [rent("legacy-67", "LANDLORD", 67)],
      })],
    });
    assert.equal(links[0]?.relationship, "MATCHES_CURRENT");
    assert.equal(links[0]?.matchedObservationIds[0], "legacy-67");
  });

  test("P TI allowance matches only with a compatible unit", () => {
    const rounds = [round({
      id: "ti",
      documentDate: new Date("2026-09-10T00:00:00Z"),
      terms: [term({
        id: "ti-110",
        side: "LANDLORD",
        canonicalType: "TI_ALLOWANCE",
        normalizedNumeric: 110,
        normalizedUnit: "USD_PER_RSF_YEAR",
        normalizedValue: "$110.00/RSF",
        structuredPayload: {
          termType: "TI_ALLOWANCE",
          amount: { amount: 110, unit: "USD_PER_RSF_YEAR" },
          conditions: [],
          drawDeadline: null,
          unusedConversion: null,
        },
      })],
    })];
    const links = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed TI allowance: $110/RSF",
        evidenceQuote: "TI allowance: $110/RSF",
      })],
      rounds,
    });
    const ti = links.find((item) => item.canonicalType === "TI_ALLOWANCE");
    assert.equal(ti?.relationship, "MATCHES_CURRENT");
    assert.deepEqual(ti?.matchedObservationIds, ["ti-110"]);
  });

  test("Q free rent matches a stored month count", () => {
    const rounds = [round({
      id: "free",
      documentDate: new Date("2026-09-06T00:00:00Z"),
      terms: [term({
        id: "free-4",
        side: "LANDLORD",
        canonicalType: "FREE_RENT",
        normalizedNumeric: 4,
        normalizedUnit: "MONTHS",
        normalizedValue: "4 months",
        structuredPayload: {
          termType: "FREE_RENT",
          abatement: { kind: "contiguous", months: 4, abatementType: "FULL" },
          scope: "BASE_RENT_ONLY",
        },
      })],
    })];
    const links = reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed 4 months free rent",
        evidenceQuote: "Free rent: 4 months",
      })],
      rounds,
    });
    const free = links.find((item) => item.canonicalType === "FREE_RENT");
    assert.equal(free?.relationship, "MATCHES_CURRENT");
    assert.equal(free?.eventValue?.unit, "MONTHS");
    assert.equal(free?.eventValue?.numeric, 4);
  });

  test("T source disagreement does not create a negotiation conflict", () => {
    const rounds = clarendonRounds(false);
    const before = resolveCurrentState(asResolverRounds(rounds), "BASE_RENT");
    reconcileDealSources({
      activities: [activity({
        description: "Landlord proposed $68/RSF/year",
        evidenceQuote: "$68/RSF/year",
      })],
      rounds,
    });
    const after = resolveCurrentState(asResolverRounds(rounds), "BASE_RENT");
    assert.equal(before.contradictory, false);
    assert.deepEqual(after, before);
    assert.equal(after.currentLandlordTerm?.normalizedNumeric, 67);
    assert.equal(after.currentTenantTerm?.normalizedNumeric, 64);
  });

  test("V activity does not change resolver output", () => {
    const rounds = clarendonRounds(true);
    const snapshot = structuredClone(rounds);
    const before = resolveCurrentState(asResolverRounds(rounds), "BASE_RENT");
    reconcileDealSources({ activities: [activity()], rounds });
    assert.deepEqual(rounds, snapshot);
    assert.deepEqual(resolveCurrentState(asResolverRounds(rounds), "BASE_RENT"), before);
  });

  test("200 Clarendon $72.50 stays historical and never current", () => {
    const withHistory = reconcileDealSources({
      activities: [activity({
        description: "Landlord issued counter: $72.50/RSF, $110 TI, 4mo free rent.",
        evidenceQuote: "Base rent: $72.50/RSF, escalating 2.5% annually",
      })],
      rounds: clarendonRounds(true),
    });
    const historical = withHistory.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(historical?.relationship, "MATCHES_HISTORICAL");
    assert.notEqual(historical?.relationship, "MATCHES_CURRENT");
    assert.equal(historical?.eventValue?.numeric, 72.5);
    const resolved = resolveCurrentState(asResolverRounds(clarendonRounds(true)), "BASE_RENT");
    assert.equal(resolved.currentTenantTerm?.normalizedNumeric, 64);
    assert.equal(resolved.currentLandlordTerm?.normalizedNumeric, 67);

    const withoutHistory = reconcileDealSources({
      activities: [activity({
        description: "Landlord issued counter: $72.50/RSF",
        evidenceQuote: "Base rent: $72.50/RSF",
      })],
      rounds: clarendonRounds(false),
    });
    const open = withoutHistory.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(open?.relationship, "DIFFERS_FROM_CURRENT");
    assert.notEqual(open?.relationship, "MATCHES_CURRENT");
    assert.equal(open?.currentPosition?.display, "$67.00/RSF/year");
  });

  test("source chronology lists activity and rounds without merging them", () => {
    const links = reconcileDealSources({
      activities: [activity()],
      rounds: clarendonRounds(true),
    });
    const chronology = buildSourceChronology({
      canonicalType: "BASE_RENT",
      currentTenant: "$64.00/RSF/year",
      currentLandlord: "$67.00/RSF/year",
      links,
      observations: [
        {
          id: "tenant-64",
          roundId: "tenant-loi",
          roundName: "Tenant LOI",
          roundDate: "2026-09-01T00:00:00.000Z",
          side: "TENANT",
          valueDisplay: "$64.00/RSF/year",
          href: null,
          sourceLabel: "Tenant LOI",
        },
        {
          id: "landlord-7250",
          roundId: "landlord-7250",
          roundName: "Landlord Counterproposal",
          roundDate: "2026-09-06T00:00:00.000Z",
          side: "LANDLORD",
          valueDisplay: "$72.50/RSF/year",
          href: null,
          sourceLabel: "Landlord Counterproposal",
        },
        {
          id: "landlord-67",
          roundId: "landlord-67",
          roundName: "Revised Counterproposal",
          roundDate: "2026-09-18T00:00:00.000Z",
          side: "LANDLORD",
          valueDisplay: "$67.00/RSF/year",
          href: null,
          sourceLabel: "Revised Counterproposal",
        },
      ],
    });
    assert.equal(chronology.entries.length, 4);
    assert.equal(chronology.entries.filter((entry) => entry.sourceKind === "DEAL_ACTIVITY").length, 1);
    assert.equal(chronology.entries.filter((entry) => entry.sourceKind === "NEGOTIATION_ROUND").length, 3);
    assert.equal(chronology.current.tenant, "$64.00/RSF/year");
    assert.equal(chronology.current.landlord, "$67.00/RSF/year");
    const email = chronology.entries.find((entry) => entry.sourceKind === "DEAL_ACTIVITY");
    assert.equal(email?.sourceLabel, "Email");
    assert.match(email?.statement ?? "", /72\.50/);
  });

  test("unprepared document guidance names the missing source facts", () => {
    assert.deepEqual(readinessGuidance("SOURCE_FILE", "MISSING"), {
      title: "Missing source PDF",
      action: "Original PDF required. Upload the original PDF before analysis.",
    });
    assert.equal(readinessGuidance("AUTHORING_SIDE").title, "Missing authoring side");
    assert.match(readinessGuidance("AUTHORING_SIDE").action, /Tenant or Landlord/);
    assert.equal(readinessGuidance("DOCUMENT_DATE").title, "Missing document date");
    assert.match(readinessGuidance("DOCUMENT_DATE").action, /document date/);
  });
});

describe("reconciliation service isolation", { concurrency: 1 }, () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });
  test.after(async () => cleanup());

  test("U W X Y Z reconciliation is read-only and deal-scoped", async () => {
    const workspace = await ensureDefaultWorkspace(prisma);
    const otherWorkspace = await createWorkspace(prisma, { name: "Other workspace" });
    const deal = await prisma.deal.create({
      data: {
        name: "200 Clarendon",
        company: "Acme",
        property: "200 Clarendon",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });
    const otherDeal = await prisma.deal.create({
      data: {
        name: "Other deal",
        company: "Other",
        property: "Other",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });
    const foreignDeal = await prisma.deal.create({
      data: {
        name: "Foreign",
        company: "Foreign",
        property: "Foreign",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: otherWorkspace.id,
      },
    });
    const document = await prisma.document.create({
      data: {
        dealId: deal.id,
        filename: "loi.pdf",
        originalFilename: "Tenant LOI.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        sha256: "recon-loi",
        documentType: "LOI",
        negotiationSide: "LANDLORD",
        documentDate: new Date("2026-09-18T00:00:00Z"),
        ingestionStatus: "COMPLETE",
        storageKey: "pending-recon",
      },
    });
    const storedRound = await prisma.negotiationRound.create({
      data: {
        dealId: deal.id,
        side: "LANDLORD",
        roundNumber: 1,
        documentName: "Landlord counter",
        documentText: "Base rent $67",
        documentDate: new Date("2026-09-18T00:00:00Z"),
        sourceType: "PASTED_TEXT",
        documentId: document.id,
        terms: {
          create: [{
            canonicalType: "BASE_RENT",
            normalizedValue: "$67.00/RSF/year",
            normalizedNumeric: 67,
            normalizedUnit: "USD_PER_RSF_YEAR",
            rawValue: "$67.00 per RSF per year",
            status: "PROPOSED",
            side: "LANDLORD",
            roundNumber: 1,
            confidence: 1,
            evidenceQuote: "Base Rent: $67.00 per RSF per year",
          }],
        },
      },
      include: { terms: true },
    });
    await recordReviewDecision(prisma, {
      documentId: document.id,
      action: "ACKNOWLEDGE",
      target: { kind: "NEGOTIATION_TERM", negotiationTermId: storedRound.terms[0]!.id },
    });
    const thread = await prisma.thread.create({ data: { dealId: deal.id, subject: "Counter", participants: "[]" } });
    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        sender: "Broker <broker@jll.example>",
        recipients: "[]",
        sentAt: new Date("2026-09-10T00:00:00Z"),
        body: "Landlord rent counter",
      },
    });
    await prisma.dealEvent.create({
      data: {
        dealId: deal.id,
        messageId: message.id,
        type: "COUNTER_RECEIVED",
        description: "Landlord issued counter: $72.50/RSF",
        occurredAt: new Date("2026-09-10T00:00:00Z"),
        confidence: 1,
        evidenceQuote: "Base rent: $72.50/RSF",
      },
    });
    await prisma.dealEvent.create({
      data: {
        dealId: otherDeal.id,
        type: "COUNTER_RECEIVED",
        description: "Landlord proposed $67/RSF/year",
        occurredAt: new Date("2026-09-18T00:00:00Z"),
        confidence: 1,
        evidenceQuote: "$67/RSF/year",
      },
    });
    await prisma.dealEvent.create({
      data: {
        dealId: foreignDeal.id,
        type: "COUNTER_RECEIVED",
        description: "Landlord proposed $67/RSF/year",
        occurredAt: new Date("2026-09-18T00:00:00Z"),
        confidence: 1,
        evidenceQuote: "$67/RSF/year",
      },
    });

    async function counts() {
      const [terms, rounds, events, reviews, documents] = await Promise.all([
        prisma.negotiationTerm.count(),
        prisma.negotiationRound.count(),
        prisma.dealEvent.count(),
        prisma.reviewDecision.count(),
        prisma.document.count(),
      ]);
      return { terms, rounds, events, reviews, documents };
    }

    const before = await counts();
    const beforeTerm = await prisma.negotiationTerm.findUnique({ where: { id: storedRound.terms[0]!.id } });
    const beforeReview = await prisma.reviewDecision.findFirst({ where: { documentId: document.id } });
    const result = await getDealReconciliation(prisma, deal.id);
    const after = await counts();
    const afterTerm = await prisma.negotiationTerm.findUnique({ where: { id: storedRound.terms[0]!.id } });
    const afterReview = await prisma.reviewDecision.findFirst({ where: { documentId: document.id } });

    assert.deepEqual(after, before);
    assert.equal(afterTerm?.normalizedNumeric, beforeTerm?.normalizedNumeric);
    assert.equal(afterReview?.reviewState, "ACKNOWLEDGED");
    assert.equal(afterReview?.reviewState, beforeReview?.reviewState);
    assert.equal(result?.workspaceId, workspace.id);
    assert.equal(result?.links.some((item) => item.eventValue?.numeric === 72.5), true);
    assert.equal(result?.links.every((item) => item.activityEventId.startsWith("deal-event:")), true);
    const eventIds = new Set((await prisma.dealEvent.findMany({ where: { dealId: deal.id }, select: { id: true } })).map((item) => `deal-event:${item.id}`));
    assert.equal(result?.links.every((item) => eventIds.has(item.activityEventId)), true);
    assert.equal(result?.links.some((item) => item.relationship === "MATCHES_CURRENT" && item.eventValue?.numeric === 72.5), false);
  });
});
