import type { DealActionState } from "@/lib/deals/actions/types";
import type {
  FormattedTermValue,
  NegotiationMovementView,
  NegotiationPositionView,
} from "@/lib/negotiation/intelligence/types";

export type DealBriefSourceKind =
  | "FORMAL_NEGOTIATION"
  | "COMMUNICATION_EVIDENCE"
  | "DOCUMENT"
  | "LEGACY_ACTIVITY";

export interface DealBriefSourceRef {
  kind: DealBriefSourceKind;
  id: string;
  label: string;
  href: string | null;
  documentId?: string | null;
  messageId?: string | null;
  negotiationRoundId?: string | null;
}

export interface DealBriefNegotiationTerm {
  canonicalType: string;
  label: string;
  status: string;
  conflict: boolean;
  tenantPosition: NegotiationPositionView | null;
  landlordPosition: NegotiationPositionView | null;
  agreedPosition: NegotiationPositionView | null;
  movement: NegotiationMovementView;
  lastChangedAt: string | null;
  source: DealBriefSourceRef | null;
  provenance: {
    observationIds: string[];
    evidenceHref: string | null;
    evidenceLabel: string | null;
    provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
  };
}

export interface DealBriefCommunicationFact {
  id: string;
  factType: string;
  canonicalType: string | null;
  label: string;
  side: string;
  assertionStatus: string;
  evidenceQuote: string;
  raw: {
    value: { display: string | null; numeric: number | null; unit: string | null };
    payload: unknown;
  };
  review: {
    id: string;
    state: string;
    createdAt: string;
  } | null;
  correction: {
    id: string;
    value: { display: string | null; numeric: number | null; unit: string | null };
    payload: unknown;
    note: string | null;
    createdAt: string;
  } | null;
  presentation: {
    value: string;
    payload: unknown;
    corrected: boolean;
  };
}

export interface DealBriefCommunication {
  id: string;
  timestamp: string;
  importedAt: string;
  sender: { name: string | null; address: string | null; label: string };
  participants: Array<{
    role: string;
    displayName: string | null;
    address: string;
  }>;
  subject: string;
  sourceType: string;
  analysisState: string;
  reviewState: string;
  lifecycleState: string;
  failureReason: string | null;
  facts: DealBriefCommunicationFact[];
  source: DealBriefSourceRef;
}

export type DealBriefChangeType =
  | "FORMAL_PROPOSAL"
  | "FORMAL_POSITION_CHANGED"
  | "FORMAL_AGREEMENT"
  | "MESSAGE_FACTS_ADDED"
  | "MESSAGE_FACT_CORRECTED"
  | "DOCUMENT_ADDED"
  | "DOCUMENT_MILESTONE";

export interface DealBriefChange {
  id: string;
  type: DealBriefChangeType;
  sourceKind: DealBriefSourceKind;
  timestamp: string;
  label: string;
  description: string | null;
  source: DealBriefSourceRef;
  priority: number;
}

export type DealBriefAttentionType =
  | "REVIEWED_DEADLINE"
  | "COMMUNICATION_FORMAL_DIFFERENCE"
  | "NEW_COMMERCIAL_EVIDENCE"
  | "MESSAGE_REVIEW_REQUIRED"
  | "MESSAGE_FOLLOW_UP"
  | "MESSAGE_ANALYSIS_FAILED"
  | "DOCUMENT_REVIEW_REQUIRED"
  | "DOCUMENT_ANALYSIS_FAILED"
  | "NEGOTIATION_CONFLICT"
  | "NEGOTIATION_UNRESOLVED"
  | "ENTITY_REVIEW_REQUIRED"
  | "RELATIONSHIP_REVIEW_REQUIRED"
  | "PROVENANCE_REVIEW_REQUIRED"
  | "ATTACHMENT_PROMOTION_AVAILABLE";

export type DealAttentionCategory = "PRODUCT" | "SYSTEM_REVIEW";

export interface DealBriefAttentionItem {
  id: string;
  type: DealBriefAttentionType;
  sourceId: string;
  sourceKind: DealBriefSourceKind;
  label: string;
  description: string | null;
  href: string;
  timestamp: string | null;
  category: DealAttentionCategory;
  priority: number;
}

export type DealEvidenceComparisonOutcome = "MATCH" | "DIFFERS" | "NOT_COMPARABLE";

export type DealEvidenceComparisonReason =
  | "EXACT_VALUE_MATCH"
  | "EXACT_VALUE_DIFFERENCE"
  | "UNREVIEWED_COMMUNICATION"
  | "SUPERSEDED_COMMUNICATION"
  | "CORRECTION_MISSING"
  | "UNKNOWN_SIDE"
  | "FORMAL_POSITION_MISSING"
  | "FORMAL_POSITION_CONFLICT"
  | "VALUE_NOT_SCALAR"
  | "UNIT_MISMATCH";

export interface DealEvidenceComparison {
  id: string;
  canonicalType: string;
  label: string;
  side: "TENANT" | "LANDLORD" | "UNKNOWN";
  outcome: DealEvidenceComparisonOutcome;
  reason: DealEvidenceComparisonReason;
  timestamp: string;
  formal: {
    value: string | null;
    numeric: number | null;
    unit: string | null;
    observationIds: string[];
    source: DealBriefSourceRef | null;
  };
  communication: {
    factId: string;
    value: string;
    numeric: number | null;
    unit: string | null;
    reviewed: boolean;
    corrected: boolean;
    source: DealBriefSourceRef;
  };
}

export type DealBriefTimelineType =
  | "FORMAL_NEGOTIATION"
  | "COMMUNICATION"
  | "DOCUMENT"
  | "DOCUMENT_REVIEW"
  | "LEGACY_ACTIVITY";

export interface DealBriefTimelineItem {
  id: string;
  type: DealBriefTimelineType;
  sourceKind: DealBriefSourceKind;
  occurredAt: string | null;
  recordedAt: string | null;
  title: string;
  description: string | null;
  source: DealBriefSourceRef;
}

export interface DealBrief {
  deal: {
    id: string;
    workspaceId: string;
    name: string;
    company: string;
    property: string;
    propertyId: string | null;
    stage: string;
    status: string;
    estimatedValue: number | null;
    createdAt: string;
  };
  negotiation: {
    summary: {
      termCount: number;
      openCount: number;
      agreedCount: number;
      conflictCount: number;
      latestFormalMovementAt: string | null;
    };
    terms: DealBriefNegotiationTerm[];
  };
  recentChanges: DealBriefChange[];
  changeSummary: {
    meaningfulCount: number;
    emptyState: string | null;
  };
  communications: DealBriefCommunication[];
  comparisons: DealEvidenceComparison[];
  productAttention: DealBriefAttentionItem[];
  systemAttention: DealBriefAttentionItem[];
  /** Phase 10A-compatible combined attention list. */
  attention: DealBriefAttentionItem[];
  timeline: DealBriefTimelineItem[];
  actions: DealActionState;
  since: string | null;
  generatedAt: string;
}

export interface DealBriefOptions {
  expectedWorkspaceId?: string;
  since?: Date;
  communicationLimit?: number;
  changeLimit?: number;
  timelineLimit?: number;
  now?: Date;
}

export type { FormattedTermValue };
