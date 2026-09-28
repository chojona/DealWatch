/**
 * evals/negotiation/v2/expectations.ts
 *
 * V2 gold expectations keyed by V1 fixture ID.
 *
 * V1 fixtures.ts is not modified. These expectations sit alongside V1
 * expectedTerms / expectedState and are ignored by V1 scoring.
 */

import type { V2FixtureExpectation, V2TypeExpectation } from "./types";
import * as P from "./payloadLibrary";

function typeExpectation(value: V2TypeExpectation): V2TypeExpectation {
  return value;
}

export const V2_EXPECTATIONS: readonly V2FixtureExpectation[] = [
  {
    fixtureId: "n01-simple-rent",
    description: "Baseline simple base rent — structured system must handle the easy case.",
    tags: ["baseline", "base-rent"],
    documents: [
      {
        documentId: "n01-simple-rent-d1",
        expectedPayloads: [{ expectedTermId: "n01-rent", payload: P.n01Rent }],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "BASE_RENT",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n01Rent,
      }),
    ],
  },
  {
    fixtureId: "n03-mixed-economics",
    description: "Baseline: rent and TI must remain distinct structured payloads.",
    tags: ["baseline", "ti", "base-rent"],
    documents: [
      {
        documentId: "n03-mixed-economics-d1",
        expectedPayloads: [
          { expectedTermId: "n03-rent", payload: P.n03Rent },
          { expectedTermId: "n03-ti", payload: P.n03TI },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "BASE_RENT",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.n03Rent,
      }),
      typeExpectation({
        canonicalType: "TI_ALLOWANCE",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.n03TI,
      }),
    ],
  },
  {
    fixtureId: "n04-counteroffer",
    description: "Baseline two-sided rent: both positions survive, no false agreement.",
    tags: ["baseline", "counteroffer"],
    documents: [
      {
        documentId: "n04-counteroffer-d1",
        expectedPayloads: [
          { expectedTermId: "n04-tenant-rent", payload: P.n04TenantRent },
        ],
      },
      {
        documentId: "n04-counteroffer-d2",
        expectedPayloads: [
          { expectedTermId: "n04-landlord-rent", payload: P.n04LandlordRent },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "BASE_RENT",
        status: "UNRESOLVED",
        conflictExpected: false,
        tenantPayload: P.n04TenantRent,
        landlordPayload: P.n04LandlordRent,
      }),
    ],
  },
  {
    fixtureId: "n06-missing-carry-forward",
    description: "Silence in a later round must not erase the TI position.",
    tags: ["carry-forward", "ti"],
    documents: [
      {
        documentId: "n06-missing-carry-forward-d1",
        expectedPayloads: [{ expectedTermId: "n06-ti", payload: P.n06TI }],
      },
      {
        documentId: "n06-missing-carry-forward-d2",
        expectedPayloads: [],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "TI_ALLOWANCE",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n06TI,
        isCarryForward: true,
        carryForwardSide: "TENANT",
      }),
    ],
  },
  {
    fixtureId: "n07-stepped-rent",
    description: "Three rent steps are one schedule, not contradictory alternatives.",
    tags: ["stepped-rent", "schedule"],
    documents: [
      {
        documentId: "n07-stepped-rent-d1",
        expectedPayloads: [
          { expectedTermId: "n07-rent-1", payload: P.n07SteppedRent },
          { expectedTermId: "n07-rent-2", payload: P.n07SteppedRent },
          { expectedTermId: "n07-rent-3", payload: P.n07SteppedRent },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "BASE_RENT",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.n07SteppedRent,
      }),
    ],
  },
  {
    fixtureId: "n08-conditional-economics",
    description: "Baseline conditions: TI and commencement remain conditional.",
    tags: ["baseline", "conditions"],
    documents: [
      {
        documentId: "n08-conditional-economics-d1",
        expectedPayloads: [
          { expectedTermId: "n08-ti", payload: P.n08TI },
          { expectedTermId: "n08-commencement", payload: P.n08Commencement },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "TI_ALLOWANCE",
        status: "UNRESOLVED",
        conflictExpected: false,
        landlordPayload: P.n08TI,
      }),
      typeExpectation({
        canonicalType: "COMMENCEMENT_DATE",
        status: "UNRESOLVED",
        conflictExpected: false,
        landlordPayload: P.n08Commencement,
      }),
    ],
  },
  {
    fixtureId: "n09-irregular-free-rent",
    description: "Non-contiguous plus partial abatement; total months is not sufficient.",
    tags: ["free-rent", "periods"],
    documents: [
      {
        documentId: "n09-irregular-free-rent-d1",
        expectedPayloads: [
          { expectedTermId: "n09-free-rent", payload: P.n09FreeRent },
          { expectedTermId: "n09-opex", payload: P.n09OpEx },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "FREE_RENT",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n09FreeRent,
      }),
      typeExpectation({
        canonicalType: "OPERATING_EXPENSES",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n09OpEx,
      }),
    ],
  },
  {
    fixtureId: "n10-renewal-right",
    description: "Two 5-year FMR options with notice and default condition.",
    tags: ["renewal-rights", "rights"],
    documents: [
      {
        documentId: "n10-renewal-right-d1",
        expectedPayloads: [
          { expectedTermId: "n10-renewal", payload: P.n10Renewal },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "RENEWAL_OPTIONS",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n10Renewal,
      }),
    ],
  },
  {
    fixtureId: "n11-termination-right",
    description: "One-time termination: month 84, 15 months notice, unamortized fee.",
    tags: ["termination-rights", "rights"],
    documents: [
      {
        documentId: "n11-termination-right-d1",
        expectedPayloads: [
          { expectedTermId: "n11-termination", payload: P.n11Termination },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "TERMINATION_RIGHTS",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n11Termination,
      }),
    ],
  },
  {
    fixtureId: "n12-rights-package",
    description: "ROFO plus parking: rights and parking scored independently.",
    tags: ["expansion", "parking", "rights"],
    documents: [
      {
        documentId: "n12-rights-package-d1",
        expectedPayloads: [
          { expectedTermId: "n12-expansion", payload: P.n12Expansion },
          { expectedTermId: "n12-parking", payload: P.n12Parking },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "EXPANSION_RIGHTS",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n12Expansion,
      }),
      typeExpectation({
        canonicalType: "PARKING",
        status: "PROPOSED",
        conflictExpected: false,
        tenantPayload: P.n12Parking,
      }),
    ],
  },
  {
    fixtureId: "n13-contradictory-draft",
    description: "Same-side same-round $64 vs $62 must be CONFLICT with both candidates.",
    tags: ["contradiction", "conflict"],
    documents: [
      {
        documentId: "n13-contradictory-draft-d1",
        expectedPayloads: [
          { expectedTermId: "n13-rent-64", payload: P.n13Rent64 },
          { expectedTermId: "n13-rent-62", payload: P.n13Rent62 },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "BASE_RENT",
        status: "UNRESOLVED",
        conflictExpected: true,
        conflictSide: "LANDLORD",
        conflictCandidates: [P.n13Rent64, P.n13Rent62],
      }),
    ],
  },
  {
    fixtureId: "n15-amendment-supersedes",
    description: "Amended rent supersedes; omitted TI carries forward.",
    tags: ["carry-forward", "amendment"],
    documents: [
      {
        documentId: "n15-amendment-supersedes-d1",
        expectedPayloads: [
          { expectedTermId: "n15-rent-original", payload: P.n15RentOriginal },
          { expectedTermId: "n15-ti-original", payload: P.n15TI },
        ],
      },
      {
        documentId: "n15-amendment-supersedes-d2",
        expectedPayloads: [
          { expectedTermId: "n15-rent-amended", payload: P.n15RentAmended },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "BASE_RENT",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.n15RentAmended,
      }),
      typeExpectation({
        canonicalType: "TI_ALLOWANCE",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.n15TI,
        isCarryForward: true,
        carryForwardSide: "LANDLORD",
      }),
    ],
  },
  {
    fixtureId: "n16-implicit-acceptance",
    description: "Implicit assent produces AGREED structured rent of $65.",
    tags: ["agreement", "implicit-acceptance"],
    documents: [
      {
        documentId: "n16-implicit-acceptance-d1",
        expectedPayloads: [
          { expectedTermId: "n16-landlord-rent", payload: P.n16Rent },
        ],
      },
      {
        documentId: "n16-implicit-acceptance-d2",
        expectedPayloads: [
          { expectedTermId: "n16-rent-agreed", payload: P.n16Rent },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "BASE_RENT",
        status: "AGREED",
        conflictExpected: false,
        tenantPayload: P.n16Rent,
        landlordPayload: P.n16Rent,
        agreedPayload: P.n16Rent,
      }),
    ],
  },
  {
    fixtureId: "n17-money-decoys",
    description: "Baseline: opex cap and parking scored independently of rent.",
    tags: ["baseline", "opex", "parking"],
    documents: [
      {
        documentId: "n17-money-decoys-d1",
        expectedPayloads: [
          { expectedTermId: "n17-opex", payload: P.n17OpEx },
          { expectedTermId: "n17-parking", payload: P.n17Parking },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "OPERATING_EXPENSES",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.n17OpEx,
      }),
      typeExpectation({
        canonicalType: "PARKING",
        status: "PROPOSED",
        conflictExpected: false,
        landlordPayload: P.n17Parking,
      }),
    ],
  },
  {
    fixtureId: "n20-complex-adversarial-amendment",
    description:
      "Partial agreement on commencement and free rent; termination stays open.",
    tags: ["adversarial", "agreement", "free-rent", "termination-rights"],
    documents: [
      {
        documentId: "n20-complex-adversarial-amendment-d1",
        expectedPayloads: [
          {
            expectedTermId: "n20-tenant-date",
            payload: P.n20TenantCommencement,
          },
          { expectedTermId: "n20-tenant-free", payload: P.n20TenantFreeRent },
          {
            expectedTermId: "n20-tenant-termination",
            payload: P.n20TenantTermination,
          },
        ],
      },
      {
        documentId: "n20-complex-adversarial-amendment-d2",
        expectedPayloads: [
          {
            expectedTermId: "n20-landlord-free",
            payload: P.n20LandlordFreeRent,
          },
          {
            expectedTermId: "n20-date-conditional",
            payload: P.n20LandlordCommencement,
          },
          {
            expectedTermId: "n20-termination-open",
            payload: P.n20TenantTermination,
          },
        ],
      },
      {
        documentId: "n20-complex-adversarial-amendment-d3",
        expectedPayloads: [
          {
            expectedTermId: "n20-date-agreed",
            payload: P.n20AgreedCommencement,
          },
          { expectedTermId: "n20-free-agreed", payload: P.n20LandlordFreeRent },
          {
            expectedTermId: "n20-termination-still-open",
            payload: P.n20TenantTermination,
          },
        ],
      },
    ],
    expectedStructuredState: [
      typeExpectation({
        canonicalType: "COMMENCEMENT_DATE",
        status: "AGREED",
        conflictExpected: false,
        tenantPayload: P.n20AgreedCommencement,
        // Landlord never issued a later observation; the vacant-possession
        // condition carries forward. AGREED payload comes from tenant assent.
        landlordPayload: P.n20LandlordCommencement,
        agreedPayload: P.n20AgreedCommencement,
      }),
      typeExpectation({
        canonicalType: "FREE_RENT",
        status: "AGREED",
        conflictExpected: false,
        tenantPayload: P.n20LandlordFreeRent,
        landlordPayload: P.n20LandlordFreeRent,
        agreedPayload: P.n20LandlordFreeRent,
      }),
      typeExpectation({
        canonicalType: "TERMINATION_RIGHTS",
        status: "UNRESOLVED",
        conflictExpected: false,
        tenantPayload: P.n20TenantTermination,
        landlordPayload: P.n20TenantTermination,
      }),
    ],
  },
];

export function v2ExpectationFor(
  fixtureId: string
): V2FixtureExpectation | undefined {
  return V2_EXPECTATIONS.find((item) => item.fixtureId === fixtureId);
}
