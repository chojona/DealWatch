export const RECONCILIATION_RELATIONSHIPS = [
  "MATCHES_CURRENT",
  "MATCHES_HISTORICAL",
  "POSSIBLE_RELATED",
  "DIFFERS_FROM_CURRENT",
  "NO_NEGOTIATION_MATCH",
] as const;

export type ReconciliationRelationship = (typeof RECONCILIATION_RELATIONSHIPS)[number];

export type ReconciliationSide = "TENANT" | "LANDLORD" | "UNKNOWN";

export const RECONCILIATION_EXPLANATION_CODES = [
  "MATCHES_CURRENT_OBSERVATION",
  "MATCHES_HISTORICAL_OBSERVATION",
  "DIFFERS_FROM_CURRENT_OBSERVATION",
  "POSSIBLE_SAME_DAY_MOVEMENT",
  "NO_CORRESPONDING_OBSERVATION",
  "INCOMPATIBLE_UNITS",
  "NON_ECONOMIC_ACTIVITY",
] as const;

export type ReconciliationExplanationCode = (typeof RECONCILIATION_EXPLANATION_CODES)[number];

/**
 * Derived correspondence between one stored activity fact and stored
 * negotiation observations. This is not persisted and is not negotiation truth.
 */
export interface ReconciliationLink {
  activityEventId: string;
  eventType: string;
  eventDate: string;
  eventValue: {
    numeric: number | null;
    unit: string | null;
    display: string | null;
  } | null;
  eventSide: ReconciliationSide;
  eventSource: {
    kind: "MESSAGE" | "MANUAL";
    messageId: string | null;
    label: string;
    href: string | null;
  };
  canonicalType: string | null;
  relationship: ReconciliationRelationship;
  matchedObservationIds: string[];
  matchedRoundId: string | null;
  currentObservationIds: string[];
  explanationCode: ReconciliationExplanationCode;
  /** Side of the negotiation observations this fact was compared with. */
  comparedSide: "TENANT" | "LANDLORD" | null;
  currentPosition: {
    side: "TENANT" | "LANDLORD";
    observationId: string;
    display: string;
  } | null;
  disagreement: {
    activityDisplay: string;
    observationDisplay: string;
    observationId: string;
    currentDisplay: string;
  } | null;
}

export interface StructuredReconciliationFact {
  factType: string;
  canonicalType: string | null;
  side: ReconciliationSide;
  numeric: number | null;
  unit: string | null;
  display: string | null;
}

export interface ReconciliationActivity {
  id: string;
  dealId: string;
  type: string;
  description: string;
  evidenceQuote: string;
  occurredAt: Date;
  messageId: string | null;
  message: { sender: string; sentAt: Date } | null;
  /** Phase 9C source message. Distinct from the legacy thread message id. */
  sourceMessageId?: string | null;
  /**
   * When set, including an empty list, reconciliation uses these facts and
   * does not parse description prose. Undefined keeps the legacy parser.
   */
  structuredFacts?: StructuredReconciliationFact[];
}

export interface ReconciliationTerm {
  id: string;
  canonicalType: string;
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: string | null;
  rawValue: string;
  status: string;
  side: string;
  evidenceQuote: string;
  structuredPayload: unknown;
  pageNumber: number | null;
}

export interface ReconciliationRound {
  id: string;
  dealId: string;
  side: string;
  roundNumber: number;
  documentName: string;
  documentDate: Date;
  createdAt: Date;
  sourceType: string;
  documentId: string | null;
  terms: ReconciliationTerm[];
}

export interface DealReconciliation {
  dealId: string;
  workspaceId: string;
  links: ReconciliationLink[];
}

export interface SourceChronologyEntry {
  occurredAt: string;
  sourceKind: "NEGOTIATION_ROUND" | "DEAL_ACTIVITY";
  sourceLabel: string;
  side: ReconciliationSide;
  statement: string;
  valueDisplay: string | null;
  roundId: string | null;
  activityEventId: string | null;
  href: string | null;
  relationship: ReconciliationRelationship | null;
}

export interface SourceChronology {
  entries: SourceChronologyEntry[];
  current: {
    tenant: string | null;
    landlord: string | null;
  };
}
