import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { CREStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import { createTestDatabase } from "@/lib/documents/testDb";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getActivityPage } from "@/lib/activity/service";
import { getConnectionGraph } from "@/lib/graph/service";
import type { NegotiationPositionView, NegotiationTermView } from "./types";
import { formatStructuredPayload } from "./formatting";
import {
  filterNegotiationTerms,
  getNegotiationWorkspace,
} from "./service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

const payloads: Record<
  | "BASE_RENT_SIMPLE"
  | "BASE_RENT_STEPPED"
  | "FREE_RENT"
  | "TI_ALLOWANCE"
  | "RENEWAL_OPTIONS"
  | "TERMINATION_RIGHTS"
  | "OPERATING_EXPENSES"
  | "ANNUAL_ESCALATION"
  | "PARKING"
  | "COMMENCEMENT_DATE"
  | "EXPANSION_RIGHTS",
  CREStructuredPayload
> = {
  BASE_RENT_SIMPLE: {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: 65, rentStructure: "NNN" },
  },
  BASE_RENT_STEPPED: {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: [
        { startMonth: 1, endMonth: 24, amountPerRSFYear: 65 },
        { startMonth: 25, endMonth: 60, amountPerRSFYear: 68 },
        { startMonth: 61, endMonth: 120, amountPerRSFYear: 71.5 },
      ],
    },
  },
  FREE_RENT: {
    termType: "FREE_RENT",
    abatement: {
      kind: "irregular",
      periods: [
        { startMonth: 1, endMonth: 3, abatementType: "FULL" },
        { startMonth: 7, endMonth: 9, abatementType: "FULL" },
        { startMonth: 10, endMonth: 10, abatementType: "PARTIAL", partialPct: 50 },
      ],
      equivalentFullMonths: 6,
    },
    scope: "BASE_RENT_ONLY",
  },
  TI_ALLOWANCE: {
    termType: "TI_ALLOWANCE",
    amount: { amount: 110, unit: "USD_PER_RSF_YEAR" },
    conditions: ["Subject to completed work"],
    drawDeadline: "within 12 months of commencement",
    unusedConversion: "RENT_CREDIT",
  },
  RENEWAL_OPTIONS: {
    termType: "RENEWAL_OPTIONS",
    options: [1, 2].map((optionNumber) => ({
      optionNumber,
      durationMonths: 60,
      pricingMethod: "FAIR_MARKET_RENT" as const,
      noticeLatestMonths: 9,
      conditions: [],
    })),
    personal: false,
  },
  TERMINATION_RIGHTS: {
    termType: "TERMINATION_RIGHTS",
    right: {
      eligibleAfterYear: 7,
      eligibleAfterMonth: null,
      noticeMonths: 12,
      terminationFee: {
        kind: "unamortized_costs",
        description: "Unamortized TI and commissions",
      },
      conditions: [],
    },
  },
  OPERATING_EXPENSES: {
    termType: "OPERATING_EXPENSES",
    structure: "BASE_YEAR",
    baseYear: 2027,
    controllableCapPct: 5,
    taxesInsuranceUncapped: true,
    exclusions: ["Capital costs"],
    managementFeePct: 3,
  },
  ANNUAL_ESCALATION: {
    termType: "ANNUAL_ESCALATION",
    escalation: { kind: "percent", pct: 2.75 },
    firstEscalationMonth: 13,
    frequency: "ANNUAL",
  },
  PARKING: {
    termType: "PARKING",
    spacesCount: 20,
    spacesRatio: null,
    ratePerSpacePerMonth: 350,
    rateType: "FIXED",
    reserved: true,
    conditions: [],
  },
  COMMENCEMENT_DATE: {
    termType: "COMMENCEMENT_DATE",
    fixedDate: null,
    conditions: ["Existing tenant surrender"],
    deliveryGuaranty: "PROPOSED",
  },
  EXPANSION_RIGHTS: {
    termType: "EXPANSION_RIGHTS",
    rightKind: "ROFO",
    applicableSpace: "Contiguous space",
    trigger: "Upon availability",
    noticeMonths: 3,
    pricingMethod: "FAIR_MARKET_RENT",
    conditions: [],
  },
};

describe("Phase 8C negotiation intelligence workspace", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test.after(async () => cleanup());

  test("H–R deterministic structured renderers cover every supported CRE payload without JSON", () => {
    const simple = formatStructuredPayload(payloads.BASE_RENT_SIMPLE);
    assert.match(simple.summary, /\$65/);

    const stepped = formatStructuredPayload(payloads.BASE_RENT_STEPPED);
    assert.deepEqual(
      stepped.details.slice(0, 3).map((row) => row.label),
      ["Years 1–2", "Years 3–5", "Years 6–10"]
    );
    assert.match(stepped.details[2]!.value, /\$71\.50/);

    const free = formatStructuredPayload(payloads.FREE_RENT);
    assert.match(free.summary, /6 equivalent full months/);
    assert.ok(free.details.some((row) => row.label === "50% abatement" && row.value === "Month 10"));

    assert.match(formatStructuredPayload(payloads.TI_ALLOWANCE).summary, /\$110/);
    assert.match(formatStructuredPayload(payloads.RENEWAL_OPTIONS).summary, /2 × 5-year options/);
    assert.ok(formatStructuredPayload(payloads.RENEWAL_OPTIONS).details.some((row) => /9 months/.test(row.value)));
    assert.match(formatStructuredPayload(payloads.TERMINATION_RIGHTS).summary, /year 7/i);
    assert.ok(formatStructuredPayload(payloads.TERMINATION_RIGHTS).details.some((row) => /Unamortized TI/.test(row.value)));
    assert.match(formatStructuredPayload(payloads.OPERATING_EXPENSES).summary, /5% controllable cap/);
    assert.equal(formatStructuredPayload(payloads.ANNUAL_ESCALATION).summary, "2.75% annually");
    assert.match(formatStructuredPayload(payloads.PARKING).summary, /20 spaces · \$350/);
    assert.equal(formatStructuredPayload(payloads.COMMENCEMENT_DATE).summary, "Conditional commencement");
    assert.match(formatStructuredPayload(payloads.EXPANSION_RIGHTS).summary, /Rofo · Contiguous space/);
    for (const payload of Object.values(payloads)) {
      assert.equal(formatStructuredPayload(payload).summary.includes("{"), false);
    }
  });

  test("A–G/S–Z read model resolves sides, agreement, legacy fallback, latest changes, movement, filters, and provenance", async () => {
    const workspaceRow = await ensureDefaultWorkspace(prisma);
    const deal = await prisma.deal.create({
      data: {
        workspaceId: workspaceRow.id,
        name: "Phase 8C workspace",
        company: "Acme",
        property: "200 Clarendon",
        stage: "Negotiation",
      },
    });
    const document = await prisma.document.create({
      data: {
        dealId: deal.id,
        filename: "counter.pdf",
        originalFilename: "Landlord Counter.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        sha256: "phase-8c-counter",
        documentType: "COUNTERPROPOSAL",
        documentDate: new Date("2026-09-26T00:00:00Z"),
        negotiationSide: "LANDLORD",
        ingestionStatus: "COMPLETE",
        storageKey: "tests/counter.pdf",
        pageCount: 2,
      },
    });
    const page = await prisma.documentPage.create({
      data: { documentId: document.id, pageNumber: 1, text: "Rent is $69. TI is $90." },
    });

    await createRound(deal.id, "TENANT", 1, "2026-08-31", "Tenant LOI", [
      term("BASE_RENT", "TENANT", 1, 65, "USD_PER_RSF_YEAR", "$65 / RSF / yr", payloads.BASE_RENT_SIMPLE),
      term("TI_ALLOWANCE", "TENANT", 1, 110, "USD_PER_RSF_YEAR", "$110 / RSF", payloads.TI_ALLOWANCE),
      term("FREE_RENT", "TENANT", 1, 6, "MONTHS", "Split free rent", payloads.FREE_RENT),
      term("RENEWAL_OPTIONS", "TENANT", 1, null, null, "Two renewal options", payloads.RENEWAL_OPTIONS, "AGREED"),
      term("TERMINATION_RIGHTS", "TENANT", 1, null, null, "Termination option", payloads.TERMINATION_RIGHTS),
      term("OPERATING_EXPENSES", "TENANT", 1, 5, "PERCENT_ANNUAL", "5% cap", payloads.OPERATING_EXPENSES),
      term("ANNUAL_ESCALATION", "TENANT", 1, 2.75, "PERCENT_ANNUAL", "2.75%", payloads.ANNUAL_ESCALATION),
      term("PARKING", "TENANT", 1, 20, "SPACES", "20 spaces", payloads.PARKING),
      term("COMMENCEMENT_DATE", "TENANT", 1, null, "DATE", "Conditional commencement", payloads.COMMENCEMENT_DATE, "UNRESOLVED"),
      term("EXPANSION_RIGHTS", "TENANT", 1, null, null, "ROFO", payloads.EXPANSION_RIGHTS),
      term("LEASE_TERM", "TENANT", 1, 120, "MONTHS", "120 months", null),
      term("DELIVERY_CONDITION", "TENANT", 1, null, null, "Broom clean", null),
    ]);

    await createRound(deal.id, "LANDLORD", 1, "2026-09-04", "Landlord Counter", [
      term("BASE_RENT", "LANDLORD", 1, 69, "USD_PER_RSF_YEAR", "$69 / RSF / yr", {
        termType: "BASE_RENT",
        rent: { kind: "simple", amountPerRSFYear: 69 },
      }, "PROPOSED", { documentPageId: page.id, provenanceStatus: "EXACT" }),
      term("TI_ALLOWANCE", "LANDLORD", 1, 90, "USD_PER_RSF_YEAR", "$90 / RSF", {
        ...payloads.TI_ALLOWANCE,
        amount: { amount: 90, unit: "USD_PER_RSF_YEAR" },
      } as CREStructuredPayload, "PROPOSED", { provenanceStatus: "AMBIGUOUS" }),
      term("RENEWAL_OPTIONS", "LANDLORD", 1, null, null, "Two renewal options", payloads.RENEWAL_OPTIONS, "AGREED"),
      term("PARKING", "LANDLORD", 1, 15, "SPACES", "15 spaces", {
        ...payloads.PARKING,
        spacesCount: 15,
      } as CREStructuredPayload),
      term("LEASE_TERM", "LANDLORD", 1, 84, "MONTHS", "84 months", null),
      term("ASSIGNMENT_SUBLETTING", "LANDLORD", 1, null, null, "Consent required", null),
    ], document.id);

    const latest = await createRound(deal.id, "LANDLORD", 2, "2026-09-26", "Landlord Counter 2", [
      term("BASE_RENT", "LANDLORD", 2, 67, "USD_PER_RSF_YEAR", "$67 / RSF / yr", {
        termType: "BASE_RENT",
        rent: { kind: "simple", amountPerRSFYear: 67 },
      }),
      term("TI_ALLOWANCE", "LANDLORD", 2, 100, "USD_PER_RSF_YEAR", "$100 / RSF", {
        ...payloads.TI_ALLOWANCE,
        amount: { amount: 100, unit: "USD_PER_RSF_YEAR" },
      } as CREStructuredPayload),
      term("PARKING", "LANDLORD", 2, 18, "SPACES", "18 spaces", {
        ...payloads.PARKING,
        spacesCount: 18,
      } as CREStructuredPayload, "PROPOSED", { provenanceStatus: "UNLOCATED" }),
    ], document.id);

    const before = await counts();
    const graphBefore = await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 1 });
    const result = await getNegotiationWorkspace(prisma, deal.id);
    assert.ok(result);
    assert.equal(result.rounds.length, 3);
    assert.equal(result.latestRound?.id, latest.id);
    assert.equal(result.latestRound?.changedCount, 3);

    const rent = find(result.terms, "BASE_RENT");
    assert.equal(rent.resolutionMode, "STRUCTURED");
    assert.match(value(rent.tenantPosition), /\$65/);
    assert.match(value(rent.landlordPosition), /\$67/);
    assert.equal(rent.agreedPosition, null);
    assert.equal(rent.status, "UNRESOLVED");
    assert.equal(rent.numericGap?.value, 2);
    assert.equal(rent.movement.kind, "NUMERIC");
    assert.equal(rent.movement.direction, "TOWARD_TENANT");
    assert.match(rent.movement.label, /\$69.*→.*\$67/);

    const ti = find(result.terms, "TI_ALLOWANCE");
    assert.equal(ti.movement.direction, "TOWARD_TENANT");
    assert.equal(ti.numericGap?.value, 10);
    assert.match(ti.movement.label, /\$90.*→.*\$100/);

    const tenantOnly = find(result.terms, "TERMINATION_RIGHTS");
    assert.ok(tenantOnly.tenantPosition);
    assert.equal(tenantOnly.landlordPosition, null);
    const landlordOnly = find(result.terms, "ASSIGNMENT_SUBLETTING");
    assert.equal(landlordOnly.tenantPosition, null);
    assert.ok(landlordOnly.landlordPosition);

    const renewal = find(result.terms, "RENEWAL_OPTIONS");
    assert.equal(renewal.status, "AGREED");
    assert.ok(renewal.agreedPosition);
    const lease = find(result.terms, "LEASE_TERM");
    assert.equal(lease.resolutionMode, "LEGACY");
    assert.match(value(lease.tenantPosition), /120 months/);
    assert.match(value(lease.landlordPosition), /84 months/);

    const commencement = find(result.terms, "COMMENCEMENT_DATE");
    assert.equal(commencement.status, "UNRESOLVED");
    assert.match(value(commencement.tenantPosition), /Conditional commencement/);
    const parking = find(result.terms, "PARKING");
    assert.equal(parking.movement.kind, "CHANGED", "parking direction is intentionally unsafe");

    assert.ok(filterNegotiationTerms(result.terms, "OPEN").every((row) => row.status !== "AGREED"));
    assert.deepEqual(filterNegotiationTerms(result.terms, "AGREED").map((row) => row.canonicalType), ["RENEWAL_OPTIONS"]);
    assert.ok(filterNegotiationTerms(result.terms, "CHANGED").some((row) => row.canonicalType === "BASE_RENT"));
    assert.equal(filterNegotiationTerms(result.terms, "CONFLICTS").length, 0);

    const exact = rent.evidence.find((item) => item.provenanceStatus === "EXACT");
    assert.equal(exact?.pageNumber, 1);
    assert.match(exact?.href ?? "", /#page=1$/);
    const ambiguous = ti.evidence.find((item) => item.provenanceStatus === "AMBIGUOUS");
    assert.equal(ambiguous?.pageNumber, null);
    assert.equal(ambiguous?.href?.includes("#page="), false);
    const unlocated = parking.evidence.find((item) => item.provenanceStatus === "UNLOCATED");
    assert.equal(unlocated?.pageNumber, null);
    assert.ok(rent.evidence.some((item) => item.sourceKind === "PASTED_TEXT" && item.sourceLabel.includes("Pasted text")));
    assert.equal(rent.history.length, 3);
    assert.equal(result.documents[0]?.workspaceHref, `/deals/${deal.id}/negotiation?round=${latest.id}`);
    assert.deepEqual(await counts(), before, "read model performs zero canonical or negotiation writes");

    const activity = await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id, filter: "NEGOTIATION", limit: 25 });
    assert.ok(activity?.events.some((event) => event.negotiationHref === `/deals/${deal.id}/negotiation?round=${latest.id}`));
    assert.deepEqual(
      await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 1 }),
      graphBefore,
      "read model does not mutate connection-map state"
    );
  });

  test("F/V structured conflict preserves candidates and suppresses directional claims", async () => {
    const workspaceRow = await ensureDefaultWorkspace(prisma);
    const deal = await prisma.deal.create({ data: { workspaceId: workspaceRow.id, name: "Conflict deal", company: "Acme", property: "Conflict", stage: "Negotiation" } });
    await createRound(deal.id, "TENANT", 1, "2026-09-01", "Contradictory draft", [
      term("BASE_RENT", "TENANT", 1, 65, "USD_PER_RSF_YEAR", "$65", payloads.BASE_RENT_SIMPLE),
      term("BASE_RENT", "TENANT", 1, 67, "USD_PER_RSF_YEAR", "$67", { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: 67 } }),
    ]);
    const result = await getNegotiationWorkspace(prisma, deal.id);
    assert.ok(result);
    const rent = find(result.terms, "BASE_RENT");
    assert.equal(rent.conflict, true);
    assert.equal(rent.tenantPosition?.kind, "CONFLICT");
    assert.equal(rent.tenantPosition?.kind === "CONFLICT" ? rent.tenantPosition.candidates.length : 0, 2);
    assert.equal(rent.movement.kind, "CHANGED");
    assert.equal(rent.movement.direction, "UNKNOWN");
    assert.deepEqual(filterNegotiationTerms(result.terms, "CONFLICTS").map((row) => row.canonicalType), ["BASE_RENT"]);
  });
});

function term(
  canonicalType: CanonicalTermType,
  side: "TENANT" | "LANDLORD",
  roundNumber: number,
  normalizedNumeric: number | null,
  normalizedUnit: string | null,
  normalizedValue: string,
  structuredPayload: CREStructuredPayload | null,
  status: "PROPOSED" | "AGREED" | "REJECTED" | "WITHDRAWN" | "UNRESOLVED" = "PROPOSED",
  provenance: { documentPageId?: string; provenanceStatus?: "EXACT" | "AMBIGUOUS" | "UNLOCATED" } = {}
) {
  return {
    canonicalType,
    normalizedValue,
    normalizedNumeric,
    normalizedUnit,
    rawValue: normalizedValue,
    status,
    side,
    roundNumber,
    confidence: 0.98,
    evidenceQuote: `${normalizedValue} evidence`,
    sourceLocation: canonicalType.replaceAll("_", " "),
    structuredPayload: structuredPayload ?? undefined,
    ...provenance,
  };
}

async function createRound(
  dealId: string,
  side: "TENANT" | "LANDLORD",
  roundNumber: number,
  day: string,
  documentName: string,
  terms: ReturnType<typeof term>[],
  documentId?: string
) {
  return prisma.negotiationRound.create({
    data: {
      dealId,
      side,
      roundNumber,
      documentName,
      documentText: terms.map((item) => item.evidenceQuote).join("\n"),
      documentDate: new Date(`${day}T00:00:00Z`),
      sourceType: documentId ? "PDF_UPLOAD" : "PASTED_TEXT",
      documentId,
      terms: { create: terms },
    },
  });
}

function find(terms: NegotiationTermView[], canonicalType: CanonicalTermType) {
  const result = terms.find((term) => term.canonicalType === canonicalType);
  assert.ok(result, `${canonicalType} should be present`);
  return result;
}

function value(position: NegotiationPositionView | null): string {
  assert.ok(position);
  assert.equal(position.kind, "VALUE");
  return position.kind === "VALUE" ? position.value.summary : "";
}

async function counts() {
  const [rounds, terms, people, companies, properties, observations] = await Promise.all([
    prisma.negotiationRound.count(),
    prisma.negotiationTerm.count(),
    prisma.person.count(),
    prisma.company.count(),
    prisma.property.count(),
    prisma.entityObservation.count(),
  ]);
  return { rounds, terms, people, companies, properties, observations };
}
