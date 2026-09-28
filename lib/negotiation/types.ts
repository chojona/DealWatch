import type {
  CanonicalTermType,
  NegotiationSide,
  NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";
import type { CREStructuredPayload } from "@/lib/ai/negotiation/payloads";

export interface NegotiationTermRecord {
  id: string;
  canonicalType: CanonicalTermType;
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: string | null;
  rawValue: string;
  status: NegotiationTermStatus;
  side: NegotiationSide;
  roundNumber: number;
  confidence: number;
  evidenceQuote: string;
  sourceLocation: string | null;
}

/**
 * NegotiationTermRecord extended with the optional typed CRE structured
 * payload introduced in Phase 1 of the CRE ontology (see
 * artifacts/cre-ontology-design.md).
 *
 * BACKWARD COMPATIBILITY: NegotiationTermRecordV2 is a structural subtype of
 * NegotiationTermRecord (it adds one optional field). Any function that
 * accepts NegotiationTermRecord[] also accepts NegotiationTermRecordV2[].
 * Legacy rows have structuredPayload = null and behave exactly as before.
 *
 * The structuredPayload field describes only CRE term semantics. It never
 * embeds Person, Company, Property, Deal, or entity-graph references. See
 * lib/ai/negotiation/payloads.ts for the architectural constraint.
 */
export interface NegotiationTermRecordV2 extends NegotiationTermRecord {
  /**
   * Typed CRE structured payload. null for:
   * - Legacy rows (created before Phase 1 landed)
   * - Term types without a structured payload shape (PREMISES_RSF, LEASE_TERM,
   *   SECURITY_DEPOSIT, RENT_STRUCTURE, DELIVERY_CONDITION, ASSIGNMENT_SUBLETTING)
   *
   * When non-null, payload.termType always equals canonicalType. Use
   * parseStructuredPayload(rawJsonValue, canonicalType) to read this field
   * safely from a Prisma result.
   */
  structuredPayload: CREStructuredPayload | null;
}

export interface NegotiationRoundRecord {
  id: string;
  side: NegotiationSide;
  roundNumber: number;
  documentName: string;
  documentText: string;
  documentDate: Date;
  createdAt: Date;
  terms: NegotiationTermRecord[];
}

export interface CurrentTermState {
  canonicalType: CanonicalTermType;
  status: NegotiationTermStatus;
  currentTenantTerm?: NegotiationTermRecord;
  currentLandlordTerm?: NegotiationTermRecord;
  agreedTerm?: NegotiationTermRecord;
  contradictory: boolean;
}
