/**
 * evals/negotiation/v2/oracleFixtures.ts
 *
 * Hand-authored perfect structured observations for the offline resolver
 * oracle. These bypass the model entirely.
 *
 * IDs that match a V1 fixture reuse that fixture's expected-term IDs so
 * provenance scoring can be inspected against the same identifiers.
 */

import type {
  OracleFixtureInput,
  OracleObservation,
  OracleRoundInput,
} from "./types";
import type { CREStructuredPayload, CRETermType } from "@/lib/ai/negotiation/payloads";
import type { NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";
import * as P from "./payloadLibrary";
import { V2_EXPECTATIONS } from "./expectations";

function obs(params: {
  id: string;
  canonicalType: CRETermType;
  side: "TENANT" | "LANDLORD";
  roundNumber: number;
  status?: NegotiationTermStatus;
  payload: CREStructuredPayload;
  evidenceQuote: string;
}): OracleObservation {
  return {
    id: params.id,
    canonicalType: params.canonicalType,
    side: params.side,
    roundNumber: params.roundNumber,
    status: params.status ?? "PROPOSED",
    structuredPayload: params.payload,
    evidenceQuote: params.evidenceQuote,
  };
}

function round(params: {
  id: string;
  side: "TENANT" | "LANDLORD";
  roundNumber: number;
  date: string;
  observations: OracleObservation[];
}): OracleRoundInput {
  return params;
}

function v2State(fixtureId: string) {
  const found = V2_EXPECTATIONS.find((item) => item.fixtureId === fixtureId);
  if (!found) {
    throw new Error("Missing V2 expectation for oracle fixture " + fixtureId);
  }
  return found.expectedStructuredState;
}

export const ORACLE_FIXTURES: readonly OracleFixtureInput[] = [
  {
    id: "n01-simple-rent",
    description: "Baseline simple rent with perfect observations.",
    tags: ["baseline", "oracle"],
    rounds: [
      round({
        id: "n01-d1",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-01-05T15:00:00.000Z",
        observations: [
          obs({
            id: "n01-rent",
            canonicalType: "BASE_RENT",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n01Rent,
            evidenceQuote:
              "Tenant proposes Base Rent of $42.00 per rentable square foot per year.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n01-simple-rent"),
  },
  {
    id: "n07-stepped-rent",
    description:
      "Perfect model output: three BASE_RENT observations, each carrying the full 3-step schedule.",
    tags: ["stepped-rent", "oracle"],
    rounds: [
      round({
        id: "n07-d1",
        side: "LANDLORD",
        roundNumber: 1,
        date: "2026-01-15T15:00:00.000Z",
        observations: [
          obs({
            id: "n07-rent-1",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.n07SteppedRent,
            evidenceQuote: "Base Rent shall be $48.00/RSF/year for months 1-24,",
          }),
          obs({
            id: "n07-rent-2",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.n07SteppedRent,
            evidenceQuote: "$51.00/RSF/year for months 25-60,",
          }),
          obs({
            id: "n07-rent-3",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.n07SteppedRent,
            evidenceQuote: "$55.50/RSF/year for months 61-120;",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n07-stepped-rent"),
  },
  {
    id: "n09-irregular-free-rent",
    description:
      "Perfect irregular free-rent observation with five distinct periods plus opex payable.",
    tags: ["free-rent", "oracle"],
    rounds: [
      round({
        id: "n09-d1",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-01-17T15:00:00.000Z",
        observations: [
          obs({
            id: "n09-free-rent",
            canonicalType: "FREE_RENT",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n09FreeRent,
            evidenceQuote:
              "Tenant requests 100% Base Rent abatement in months 2, 4, 6 and 8, plus 50% abatement in month 10.",
          }),
          obs({
            id: "n09-opex",
            canonicalType: "OPERATING_EXPENSES",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n09OpEx,
            evidenceQuote: "Operating expenses remain payable throughout.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n09-irregular-free-rent"),
  },
  {
    id: "n10-renewal-right",
    description: "Perfect two-option renewal package.",
    tags: ["renewal-rights", "rights", "oracle"],
    rounds: [
      round({
        id: "n10-d1",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-01-18T15:00:00.000Z",
        observations: [
          obs({
            id: "n10-renewal",
            canonicalType: "RENEWAL_OPTIONS",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n10Renewal,
            evidenceQuote:
              "Tenant shall have two successive five-year renewal options at 95% of then-prevailing fair market rent, exercisable on 12 months' prior notice.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n10-renewal-right"),
  },
  {
    id: "n11-termination-right",
    description: "Perfect termination right with month, notice, and fee.",
    tags: ["termination-rights", "rights", "oracle"],
    rounds: [
      round({
        id: "n11-d1",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-01-19T15:00:00.000Z",
        observations: [
          obs({
            id: "n11-termination",
            canonicalType: "TERMINATION_RIGHTS",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n11Termination,
            evidenceQuote:
              "Tenant may terminate once effective after month 84 by giving 15 months' advance notice.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n11-termination-right"),
  },
  {
    id: "n12-rights-package",
    description: "Perfect ROFO + parking observations (assignment has no structured payload).",
    tags: ["expansion", "parking", "rights", "oracle"],
    rounds: [
      round({
        id: "n12-d1",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-01-20T15:00:00.000Z",
        observations: [
          obs({
            id: "n12-expansion",
            canonicalType: "EXPANSION_RIGHTS",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n12Expansion,
            evidenceQuote:
              "Tenant receives a continuing right of first offer on the adjacent fourth floor;",
          }),
          obs({
            id: "n12-parking",
            canonicalType: "PARKING",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n12Parking,
            evidenceQuote:
              "Tenant may use 42 unreserved garage spaces at the building's prevailing monthly rate.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n12-rights-package"),
  },
  {
    id: "n13-contradictory-draft",
    description:
      "Perfect contradictory observations: $64 and $62, both UNRESOLVED, same side/round.",
    tags: ["contradiction", "conflict", "oracle"],
    rounds: [
      round({
        id: "n13-d1",
        side: "LANDLORD",
        roundNumber: 1,
        date: "2026-01-21T15:00:00.000Z",
        observations: [
          obs({
            id: "n13-rent-64",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            status: "UNRESOLVED",
            payload: P.n13Rent64,
            evidenceQuote: "Section 3 states: Base Rent is $64.00/RSF/year.",
          }),
          obs({
            id: "n13-rent-62",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            status: "UNRESOLVED",
            payload: P.n13Rent62,
            evidenceQuote:
              "Broker's latest markup says Base Rent is $62.00/RSF/year; neither figure has been selected.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n13-contradictory-draft"),
  },
  {
    id: "n15-amendment-supersedes",
    description: "Perfect amendment: rent replaced, TI omitted and must carry forward.",
    tags: ["carry-forward", "amendment", "oracle"],
    rounds: [
      round({
        id: "n15-d1",
        side: "LANDLORD",
        roundNumber: 1,
        date: "2026-01-25T15:00:00.000Z",
        observations: [
          obs({
            id: "n15-rent-original",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.n15RentOriginal,
            evidenceQuote: "Landlord proposes Base Rent of $70.00/RSF/year",
          }),
          obs({
            id: "n15-ti-original",
            canonicalType: "TI_ALLOWANCE",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.n15TI,
            evidenceQuote: "a TI Allowance of $80.00/RSF.",
          }),
        ],
      }),
      round({
        id: "n15-d2",
        side: "LANDLORD",
        roundNumber: 2,
        date: "2026-01-26T15:00:00.000Z",
        observations: [
          obs({
            id: "n15-rent-amended",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 2,
            payload: P.n15RentAmended,
            evidenceQuote:
              "The $70.00 Base Rent in Landlord's January 25 proposal is deleted and replaced with $67.50/RSF/year.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n15-amendment-supersedes"),
  },
  {
    id: "n16-implicit-acceptance",
    description: "Perfect implicit agreement on $65 rent.",
    tags: ["agreement", "oracle"],
    rounds: [
      round({
        id: "n16-d1",
        side: "LANDLORD",
        roundNumber: 1,
        date: "2026-01-27T15:00:00.000Z",
        observations: [
          obs({
            id: "n16-landlord-rent",
            canonicalType: "BASE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.n16Rent,
            evidenceQuote: "Our final Base Rent counter is $65.00/RSF/year.",
          }),
        ],
      }),
      round({
        id: "n16-d2",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-01-28T15:00:00.000Z",
        observations: [
          obs({
            id: "n16-rent-agreed",
            canonicalType: "BASE_RENT",
            side: "TENANT",
            roundNumber: 1,
            status: "AGREED",
            payload: P.n16Rent,
            evidenceQuote:
              "The $65.00/RSF/year Base Rent works for Tenant. Please put that number into the execution draft; we are done on rent.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n16-implicit-acceptance"),
  },
  {
    id: "n20-complex-adversarial-amendment",
    description:
      "Perfect multi-round observations for commencement, irregular free rent, and open termination.",
    tags: ["adversarial", "oracle", "rights"],
    rounds: [
      round({
        id: "n20-d1",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-02-02T15:00:00.000Z",
        observations: [
          obs({
            id: "n20-tenant-date",
            canonicalType: "COMMENCEMENT_DATE",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n20TenantCommencement,
            evidenceQuote: "Tenant proposes commencement on October 1, 2027.",
          }),
          obs({
            id: "n20-tenant-free",
            canonicalType: "FREE_RENT",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n20TenantFreeRent,
            evidenceQuote:
              "Tenant requests 10 months of Base Rent abatement, applied in months 1-5 and 13-17.",
          }),
          obs({
            id: "n20-tenant-termination",
            canonicalType: "TERMINATION_RIGHTS",
            side: "TENANT",
            roundNumber: 1,
            payload: P.n20TenantTermination,
            evidenceQuote:
              "Tenant may terminate after month 72 on 12 months' notice with a fee equal to unamortized transaction costs.",
          }),
        ],
      }),
      round({
        id: "n20-d2",
        side: "LANDLORD",
        roundNumber: 1,
        date: "2026-02-03T15:00:00.000Z",
        observations: [
          obs({
            id: "n20-landlord-free",
            canonicalType: "FREE_RENT",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.n20LandlordFreeRent,
            evidenceQuote:
              "Landlord counters with 8 months of Base Rent abatement in months 1-4 and 13-16.",
          }),
          obs({
            id: "n20-date-conditional",
            canonicalType: "COMMENCEMENT_DATE",
            side: "LANDLORD",
            roundNumber: 1,
            status: "UNRESOLVED",
            payload: P.n20LandlordCommencement,
            evidenceQuote:
              "Landlord agrees to October 1, 2027 only if vacant possession occurs by September 15, 2027.",
          }),
          obs({
            id: "n20-termination-open",
            canonicalType: "TERMINATION_RIGHTS",
            side: "LANDLORD",
            roundNumber: 1,
            status: "UNRESOLVED",
            payload: P.n20TenantTermination,
            evidenceQuote:
              "The termination option is under asset-manager review and is not agreed.",
          }),
        ],
      }),
      round({
        id: "n20-d3",
        side: "TENANT",
        roundNumber: 2,
        date: "2026-02-04T15:00:00.000Z",
        observations: [
          obs({
            id: "n20-date-agreed",
            canonicalType: "COMMENCEMENT_DATE",
            side: "TENANT",
            roundNumber: 2,
            status: "AGREED",
            payload: P.n20AgreedCommencement,
            evidenceQuote:
              "The vacant-possession condition is removed; both parties confirm October 1, 2027 as the agreed commencement date.",
          }),
          obs({
            id: "n20-free-agreed",
            canonicalType: "FREE_RENT",
            side: "TENANT",
            roundNumber: 2,
            status: "AGREED",
            payload: P.n20LandlordFreeRent,
            evidenceQuote:
              "The eight-month abatement structure (months 1-4 and 13-16) works; put it in the execution draft.",
          }),
          obs({
            id: "n20-termination-still-open",
            canonicalType: "TERMINATION_RIGHTS",
            side: "TENANT",
            roundNumber: 2,
            status: "UNRESOLVED",
            payload: P.n20TenantTermination,
            evidenceQuote:
              "Termination remains open and is expressly excluded from this agreement.",
          }),
        ],
      }),
    ],
    expectedStructuredState: v2State("n20-complex-adversarial-amendment"),
  },
  {
    id: "oracle-carry-forward-rent-ti",
    description:
      "Round 1: Rent $65 + TI $110. Round 2: Rent $67 only. Expected: Rent $67, TI $110.",
    tags: ["carry-forward", "oracle"],
    rounds: [
      round({
        id: "cf-r1",
        side: "TENANT",
        roundNumber: 1,
        date: "2026-03-01T15:00:00.000Z",
        observations: [
          obs({
            id: "cf-rent-65",
            canonicalType: "BASE_RENT",
            side: "TENANT",
            roundNumber: 1,
            payload: P.carryForwardRent65,
            evidenceQuote: "Tenant proposes Base Rent of $65.00/RSF/year.",
          }),
          obs({
            id: "cf-ti-110",
            canonicalType: "TI_ALLOWANCE",
            side: "TENANT",
            roundNumber: 1,
            payload: P.carryForwardTI110,
            evidenceQuote: "Tenant requests a TI Allowance of $110.00 per RSF.",
          }),
        ],
      }),
      round({
        id: "cf-r2",
        side: "TENANT",
        roundNumber: 2,
        date: "2026-03-08T15:00:00.000Z",
        observations: [
          obs({
            id: "cf-rent-67",
            canonicalType: "BASE_RENT",
            side: "TENANT",
            roundNumber: 2,
            payload: P.carryForwardRent67,
            evidenceQuote: "Tenant revises Base Rent to $67.00/RSF/year.",
          }),
        ],
      }),
    ],
    expectedStructuredState: [
      {
        canonicalType: "BASE_RENT",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.carryForwardRent67,
      },
      {
        canonicalType: "TI_ALLOWANCE",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.carryForwardTI110,
        isCarryForward: true,
        carryForwardSide: "TENANT",
      },
    ],
  },
  {
    id: "oracle-annual-escalation",
    description: "Representative 3% annual escalation (no V1 fixture covers this type).",
    tags: ["escalation", "oracle"],
    rounds: [
      round({
        id: "esc-d1",
        side: "LANDLORD",
        roundNumber: 1,
        date: "2026-03-10T15:00:00.000Z",
        observations: [
          obs({
            id: "esc-3pct",
            canonicalType: "ANNUAL_ESCALATION",
            side: "LANDLORD",
            roundNumber: 1,
            payload: P.oracleAnnualEscalation,
            evidenceQuote:
              "Base Rent shall increase by three percent (3%) annually commencing in month 13.",
          }),
        ],
      }),
    ],
    expectedStructuredState: [
      {
        canonicalType: "ANNUAL_ESCALATION",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.oracleAnnualEscalation,
      },
    ],
  },
];

export function oracleFixtureFor(
  id: string
): OracleFixtureInput | undefined {
  return ORACLE_FIXTURES.find((item) => item.id === id);
}
