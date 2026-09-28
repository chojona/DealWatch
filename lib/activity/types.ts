import type { EvidenceView } from "@/lib/promotion/types";

export const ACTIVITY_ROOT_TYPES = ["PERSON", "COMPANY", "PROPERTY", "DEAL"] as const;
export type ActivityRootType = (typeof ACTIVITY_ROOT_TYPES)[number];

export const ACTIVITY_FILTERS = ["ALL", "NEGOTIATION", "DOCUMENTS", "RELATIONSHIPS"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export type ActivityEventType =
  | "DOCUMENT"
  | "DEAL_ACTIVITY"
  | "NEGOTIATION_PROPOSAL"
  | "NEGOTIATION_COUNTER"
  | "NEGOTIATION_AGREEMENT"
  | "NEGOTIATION_CHANGE"
  | "ENTITY_EVIDENCE"
  | "RELATIONSHIP_EVIDENCE"
  | "DEAL_PARTICIPATION"
  | "EMPLOYMENT_EVIDENCE"
  | "PROPERTY_RELATIONSHIP_EVIDENCE";

export type ActivitySourceType =
  | "DOCUMENT"
  | "NEGOTIATION_ROUND"
  | "DEAL_EVENT"
  | "ENTITY_OBSERVATION"
  | "RELATIONSHIP_OBSERVATION"
  | "CANONICAL_ASSERTION";

export interface ActivityEntityRef {
  id: string;
  type: ActivityRootType;
  name: string;
  href: string;
}

export interface ActivityStructuredDetail {
  kind:
    | "RENT_SCHEDULE"
    | "FREE_RENT_SCHEDULE"
    | "RENEWAL_OPTIONS"
    | "TERMINATION_RIGHT"
    | "PARKING"
    | "OPERATING_EXPENSES"
    | "KEY_VALUES";
  rows: Array<{ label: string; value: string }>;
}

export interface ActivityTermDetail {
  canonicalType: string;
  label: string;
  value: string;
  previousValue?: string;
  status: string;
  structured?: ActivityStructuredDetail;
}

export interface ActivityEvent {
  id: string;
  /** Real-world/business time. Null means the source stores no such date. */
  occurredAt: string | null;
  /** Persistence/extraction time. Null only for legacy records that do not store one. */
  recordedAt: string | null;
  eventType: ActivityEventType;
  title: string;
  description?: string;
  entityRefs: ActivityEntityRef[];
  dealId?: string;
  documentId?: string;
  documentPageId?: string;
  evidence?: EvidenceView;
  details?: ActivityTermDetail[];
  sourceType: ActivitySourceType;
  sourceId: string;
  resolutionState?: "CONFIRMED" | "PENDING";
  dedupeKey: string;
}

export interface ActivityCursor {
  occurredAt: string | null;
  recordedAt: string | null;
  id: string;
}

export interface ActivityPage {
  root: ActivityEntityRef;
  events: ActivityEvent[];
  nextCursor: string | null;
}

export interface ActivityQuery {
  rootType: ActivityRootType;
  rootId: string;
  filter?: ActivityFilter;
  limit?: number;
  cursor?: string | null;
}
