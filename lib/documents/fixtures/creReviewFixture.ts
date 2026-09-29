import type { GraphExtractionModel } from "@/lib/ai/graph/schemas";
import { buildTextPdf } from "@/lib/documents/minimalPdf";

/**
 * Synthetic commercial lease language for the Phase 8F integration test.
 * TEST / FICTIONAL. Not a customer document.
 */
export const CRE_REVIEW_FIXTURE_LINES = [
  "TEST / FICTIONAL. Synthetic DealWatch integration data.",
  "This is not a customer document.",
  "Base Rent shall be $72.00 per rentable square foot.",
  "Tenant Improvement Allowance shall be $85.00 per rentable square foot.",
  "Free Rent shall be three months.",
  "Lease Term shall be seven years.",
  "Sarah Chen is a broker at Harbor Brokerage.",
  "Sarah Chen of Harbor Brokerage represents Northwind Labs.",
  "Tenant is Northwind Labs.",
  "Landlord is Clarendon Holdings.",
  "Property is 500 Test Street, Boston.",
  "Clarendon Holdings owns 500 Test Street.",
] as const;

export const CRE_REVIEW_FIXTURE_TEXT = CRE_REVIEW_FIXTURE_LINES.join("\n");

export const CRE_REVIEW_QUOTES = {
  baseRent: "Base Rent shall be $72.00 per rentable square foot.",
  ti: "Tenant Improvement Allowance shall be $85.00 per rentable square foot.",
  freeRent: "Free Rent shall be three months.",
  leaseTerm: "Lease Term shall be seven years.",
  broker: "Sarah Chen is a broker at Harbor Brokerage.",
  participation: "Sarah Chen of Harbor Brokerage represents Northwind Labs.",
  tenant: "Tenant is Northwind Labs.",
  landlord: "Landlord is Clarendon Holdings.",
  property: "Property is 500 Test Street, Boston.",
  owns: "Clarendon Holdings owns 500 Test Street.",
} as const;

export function creReviewTestPdf(): Buffer {
  return buildTextPdf([CRE_REVIEW_FIXTURE_TEXT]);
}

const emptyEntity = {
  observedTitle: null,
  observedEmail: null,
  observedPhone: null,
  observedLinkedIn: null,
  observedWebsite: null,
  observedDomain: null,
  observedAddress: null,
  extractionConfidence: 1,
};

export const CRE_REVIEW_GRAPH: GraphExtractionModel = {
  entities: [
    {
      ...emptyEntity,
      observationKey: "person_1",
      observedType: "PERSON",
      observedName: "Sarah Chen",
      evidenceQuote: CRE_REVIEW_QUOTES.broker,
    },
    {
      ...emptyEntity,
      observationKey: "company_1",
      observedType: "COMPANY",
      observedName: "Northwind Labs",
      evidenceQuote: CRE_REVIEW_QUOTES.tenant,
    },
    {
      ...emptyEntity,
      observationKey: "company_2",
      observedType: "COMPANY",
      observedName: "Harbor Brokerage",
      evidenceQuote: CRE_REVIEW_QUOTES.broker,
    },
    {
      ...emptyEntity,
      observationKey: "company_3",
      observedType: "COMPANY",
      observedName: "Clarendon Holdings",
      evidenceQuote: CRE_REVIEW_QUOTES.landlord,
    },
    {
      ...emptyEntity,
      observationKey: "property_1",
      observedType: "PROPERTY",
      observedName: "500 Test Street",
      observedAddress: "500 Test Street, Boston",
      evidenceQuote: CRE_REVIEW_QUOTES.property,
    },
  ],
  relationships: [
    {
      subjectObservationKey: "person_1",
      predicate: "WORKS_AT",
      objectObservationKey: "company_2",
      principalObservationKey: null,
      participationRole: null,
      roleLabel: null,
      affiliationKind: "BROKER",
      statedTitle: "Broker",
      statedValidFrom: null,
      statedValidTo: null,
      assertionStrength: "STATED",
      evidenceQuote: CRE_REVIEW_QUOTES.broker,
      extractionConfidence: 1,
    },
    {
      subjectObservationKey: "person_1",
      predicate: "PARTICIPATES_AS",
      objectObservationKey: null,
      principalObservationKey: "company_1",
      participationRole: "TENANT_BROKER",
      roleLabel: null,
      affiliationKind: null,
      statedTitle: null,
      statedValidFrom: null,
      statedValidTo: null,
      assertionStrength: "STATED",
      evidenceQuote: CRE_REVIEW_QUOTES.participation,
      extractionConfidence: 1,
    },
    {
      subjectObservationKey: "company_3",
      predicate: "OWNS",
      objectObservationKey: "property_1",
      principalObservationKey: null,
      participationRole: null,
      roleLabel: null,
      affiliationKind: null,
      statedTitle: null,
      statedValidFrom: null,
      statedValidTo: null,
      assertionStrength: "STATED",
      evidenceQuote: CRE_REVIEW_QUOTES.owns,
      extractionConfidence: 1,
    },
  ],
};
