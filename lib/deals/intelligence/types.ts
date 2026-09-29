import type { ActivityEvent } from "@/lib/activity/types";
import type { NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";
import type {
  FormattedTermValue,
  NegotiationEvidenceView,
  NegotiationMovementView,
  NegotiationPositionView,
  NegotiationTermView,
  NumericGapView,
} from "@/lib/negotiation/intelligence/types";
import type { EvidenceView } from "@/lib/promotion/types";

/**
 * Read-model status for the deal workspace.
 * This is never written back to Deal.status.
 * COMPLETE is intentionally absent: stored records do not define closing.
 */
export const DEAL_INTELLIGENCE_STATUSES = [
  "SETUP",
  "DOCUMENTS_PROCESSING",
  "REVIEW_REQUIRED",
  "NEGOTIATING",
  "MOSTLY_AGREED",
  "AGREED",
] as const;

export type DealIntelligenceStatus = (typeof DEAL_INTELLIGENCE_STATUSES)[number];

export interface DealHealth {
  documentCount: number;
  reviewedDocumentCount: number;
  reviewRequiredDocumentCount: number;
  failedDocumentCount: number;
  processingDocumentCount: number;
  negotiationTermCount: number;
  openTermCount: number;
  agreedTermCount: number;
  conflictCount: number;
  unresolvedEntityCount: number;
  blockedRelationshipCount: number;
  evidenceIssueCount: number;
  latestActivityAt: string | null;
  latestNegotiationAt: string | null;
}

export interface DealSourceRef {
  roundId: string | null;
  roundName: string | null;
  roundDate: string | null;
  documentId: string | null;
  sourceLabel: string | null;
  sourceKind: string | null;
  pageNumber: number | null;
  href: string | null;
}

export interface DealOpenItem {
  canonicalType: string;
  label: string;
  tenantPosition: NegotiationPositionView | null;
  landlordPosition: NegotiationPositionView | null;
  numericGap: NumericGapView | null;
  status: NegotiationTermStatus;
  latestChangingSide: "TENANT" | "LANDLORD" | null;
  lastChangedAt: string | null;
  source: DealSourceRef;
  evidence: NegotiationEvidenceView[];
  rank: number;
}

export interface DealAgreedTerm {
  canonicalType: string;
  label: string;
  agreedValue: FormattedTermValue;
  agreedAt: string | null;
  source: DealSourceRef;
  evidence: NegotiationEvidenceView[];
}

export interface DealMovementItem {
  canonicalType: string;
  label: string;
  tenantLine: string | null;
  landlordLine: string | null;
  movement: NegotiationMovementView;
  source: DealSourceRef;
}

export interface DealDocumentRollup {
  id: string;
  name: string;
  documentType: string;
  side: string | null;
  documentDate: string | null;
  uploadedAt: string;
  analysis: string;
  review: string;
  reviewState: string;
  negotiationFindings: string;
  entities: string;
  relationships: string;
  evidence: string;
  action: { label: string; href: string };
}

export const DEAL_REVIEW_QUEUE_KINDS = [
  "PREPARE",
  "ANALYZE",
  "FAILED",
  "NEGOTIATION_REVIEW",
  "CONFLICT",
  "ENTITY",
  "RELATIONSHIP",
  "PROVENANCE",
  "FOLLOW_UP",
] as const;

export type DealReviewQueueKind = (typeof DEAL_REVIEW_QUEUE_KINDS)[number];

export interface DealReviewQueueItem {
  id: string;
  documentId: string;
  documentName: string;
  kind: DealReviewQueueKind;
  label: string;
  detail: string | null;
  href: string;
}

export interface DealParty {
  id: string;
  actorId: string | null;
  actorType: "PERSON" | "COMPANY" | null;
  name: string;
  href: string | null;
  role: string;
  representsCompanyId: string | null;
  representsCompanyName: string | null;
  representsHref: string | null;
  employers: Array<{
    companyId: string;
    companyName: string;
    href: string;
    title: string | null;
  }>;
  evidence: EvidenceView;
}

export interface DealTeam {
  property: {
    id: string;
    name: string;
    href: string;
    address: string;
    evidence: EvidenceView;
  } | null;
  tenant: DealParty[];
  landlord: DealParty[];
  tenantBrokers: DealParty[];
  landlordBrokers: DealParty[];
  other: DealParty[];
}

export interface DealFact {
  id: string;
  label: string;
  value: string;
  evidence: EvidenceView | NegotiationEvidenceView[];
}

export interface DealIntelligence {
  deal: {
    id: string;
    name: string;
    company: string;
    property: string;
    propertyId: string | null;
    stage: string;
    /** Stored Deal.status. Never replaced by intelligenceStatus. */
    recordStatus: string;
    estimatedValue: number | null;
    createdAt: string;
    workspaceId: string;
  };
  intelligenceStatus: DealIntelligenceStatus;
  health: DealHealth;
  terms: NegotiationTermView[];
  openItems: DealOpenItem[];
  agreedTerms: DealAgreedTerm[];
  recentMovement: DealMovementItem[];
  documents: DealDocumentRollup[];
  reviewQueue: DealReviewQueueItem[];
  team: DealTeam;
  facts: DealFact[];
  activity: ActivityEvent[];
  activityHref: string;
}
