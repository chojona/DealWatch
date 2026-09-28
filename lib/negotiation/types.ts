import type {
  CanonicalTermType,
  NegotiationSide,
  NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";

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
