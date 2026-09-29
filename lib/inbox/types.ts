export const INBOX_FILTERS = [
  "ALL",
  "NEEDS_REVIEW",
  "PROCESSING",
  "COMPLETE",
  "FAILED",
] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_PROCESSING_STATUSES = [
  "NOT_READY",
  "READY_TO_PREPARE",
  "READY_TO_ANALYZE",
  "ANALYZING",
  "REVIEW_REQUIRED",
  "REVIEWED",
  "FAILED",
] as const;

export type InboxProcessingStatus = (typeof INBOX_PROCESSING_STATUSES)[number];

export const REVIEW_REASONS = [
  "UNRESOLVED_ENTITIES",
  "UNRESOLVED_RELATIONSHIPS",
  "NEGOTIATION_REVIEW_PENDING",
  "NEGOTIATION_FOLLOW_UP",
  "NEGOTIATION_CONFLICT",
  "AMBIGUOUS_PROVENANCE",
  "UNLOCATED_PROVENANCE",
] as const;

export type ReviewReason = (typeof REVIEW_REASONS)[number];

export type ProvenanceStatus = "EXACT" | "AMBIGUOUS" | "UNLOCATED";

export interface InboxDocumentRef {
  id: string;
  filename: string;
  originalFilename: string;
  documentType: string;
  negotiationSide: string | null;
  documentDate: string | null;
  uploadedAt: string;
  pageCount: number | null;
  sha256: string;
  ingestionStatus: string;
  failureCode: string | null;
  failureReason: string | null;
  graphExtractionStatus: string;
  graphFailureCode: string | null;
  graphFailureReason: string | null;
  duplicateDocumentIds: string[];
}

export interface InboxDealRef {
  id: string;
  name: string;
  company: string;
  property: string;
  propertyId: string | null;
  stage: string;
  status: string;
  estimatedValue: number | null;
}

export interface NegotiationSummary {
  termCount: number;
  changedCount: number;
  agreedCount: number;
  unchangedCount: number;
  newCount: number;
  conflictCount: number;
  pendingReviewCount: number;
  acknowledgedCount: number;
  followUpCount: number;
  unreviewedConflictCount: number;
}

export interface EntityReviewSummary {
  found: number;
  unresolved: number;
  resolved: number;
  leftUnresolved: number;
}

export interface RelationshipReviewSummary {
  found: number;
  pending: number;
  blocked: number;
  ready: number;
  approved: number;
  rejected: number;
  acknowledgedBlocked: number;
}

export interface EvidenceSummary {
  exact: number;
  ambiguous: number;
  unlocated: number;
}

export interface InboxItem {
  document: InboxDocumentRef;
  deal: InboxDealRef;
  processingStatus: InboxProcessingStatus;
  negotiationSummary: NegotiationSummary;
  entityReviewSummary: EntityReviewSummary;
  relationshipReviewSummary: RelationshipReviewSummary;
  evidenceSummary: EvidenceSummary;
  requiresReview: boolean;
  reviewReasons: ReviewReason[];
  uploadedAt: string;
  documentDate: string | null;
  nextAction: { label: string; href: string };
  canRetry: boolean;
  reviewHref: string;
  dealHref: string;
  negotiationHref: string;
  activityHref: string;
  knowledgeHref: string;
  connectionsHref: string;
  pdfHref: string | null;
  sourceFileState: "AVAILABLE" | "MISSING" | "UNAVAILABLE";
}

export interface InboxFacet {
  deals: Array<{ id: string; name: string }>;
  documentTypes: string[];
  sides: string[];
}

export interface InboxPageModel {
  workspaceId: string;
  items: InboxItem[];
  sourceItems: InboxSourceItem[];
  facets: InboxFacet;
  counts: Record<InboxFilter, number>;
  sourceCounts: { ALL: number; DOCUMENTS: number; MESSAGES: number };
}

export interface InboxMessageItem {
  id: string;
  subject: string;
  sender: string;
  occurredAt: string;
  sourceType: string;
  analysisState: string;
  reviewState: string;
  lifecycleState: string;
  factCount: number;
  failureReason: string | null;
  deal: InboxDealRef;
  href: string;
}

export type InboxSourceItem =
  | { kind: "DOCUMENT"; occurredAt: string; document: InboxItem }
  | { kind: "MESSAGE"; occurredAt: string; message: InboxMessageItem };

export interface NegotiationFinding {
  termId: string;
  canonicalType: string;
  label: string;
  side: string;
  status: string;
  formattedValue: string;
  structuredDetails: Array<{ label: string; value: string }> | null;
  evidenceQuote: string;
  provenanceStatus: ProvenanceStatus | null;
  pageNumber: number | null;
  pageLabel: string | null;
  originalEvidenceQuote: string;
  originalProvenanceStatus: ProvenanceStatus | null;
  reviewState: "PENDING" | "ACKNOWLEDGED" | "NEEDS_FOLLOW_UP";
  reviewNote: string | null;
  activeCorrectionId: string | null;
  formalReviewState: "UNREVIEWED" | "ACCEPTED" | "CORRECTED" | "REJECTED";
  formalExtractedSummary: string;
  formalEffectiveSummary: string | null;
  formalReviewNote: string | null;
  formalReviewedAt: string | null;
  formalCorrectionMode: "BASE_RENT_SIMPLE" | "LEGACY" | "STRUCTURED";
  impactKind: "CHANGED" | "UNCHANGED" | "AGREED";
  impactLabel: string;
  previousValue: string | null;
  currentValue: string;
}

export interface EvidenceRecord {
  id: string;
  kind: "TERM" | "ENTITY" | "RELATIONSHIP";
  label: string;
  quote: string;
  provenanceStatus: ProvenanceStatus | null;
  originalProvenanceStatus: ProvenanceStatus | null;
  pageNumber: number | null;
  href: string | null;
  reviewState: "PENDING" | "ACKNOWLEDGED" | "NEEDS_FOLLOW_UP";
  activeCorrectionId: string | null;
}

export interface NegotiationConflictView {
  canonicalType: string;
  label: string;
  candidates: string[];
  reviewState: "PENDING" | "ACKNOWLEDGED" | "NEEDS_FOLLOW_UP";
}

export interface ReviewPageText {
  id: string;
  pageNumber: number;
  text: string;
}

export interface ReviewProgress {
  sourceLabel: string;
  sourceReady: boolean;
  metadataLabel: string;
  metadataReady: boolean;
  analysisLabel: string;
  negotiationReviewed: number;
  negotiationTotal: number;
  entitiesAddressed: number;
  entitiesTotal: number;
  relationshipsReviewed: number;
  relationshipsTotal: number;
  evidenceReviewed: number;
  evidenceTotal: number;
  overall: InboxProcessingStatus;
}

export interface DocumentCompletionSummary {
  findingsReviewed: number;
  conflictsAcknowledged: number;
  entitiesResolved: number;
  entitiesLeftUnresolved: number;
  relationshipsApproved: number;
  relationshipsRejected: number;
  relationshipsAcknowledgedBlocked: number;
  evidenceExact: number;
  evidenceCorrected: number;
  ambiguityAcknowledged: number;
  result: InboxProcessingStatus;
}

export interface DocumentPromotionSource {
  messageId: string;
  messageSubject: string | null;
  messageHref: string;
  attachmentId: string;
  attachmentFilename: string;
}

export interface DocumentReviewModel {
  item: InboxItem;
  findings: NegotiationFinding[];
  conflicts: NegotiationConflictView[];
  evidence: EvidenceRecord[];
  pages: ReviewPageText[];
  promotionSources: DocumentPromotionSource[];
  progress: ReviewProgress;
  readiness: {
    fileReady: boolean;
    metadataReady: boolean;
    analysisReady: boolean;
    reviewReady: boolean;
    missing: Array<{ code: string; label: string }>;
  };
  fileAvailable: boolean;
  deletionBlocked: boolean;
  completion: DocumentCompletionSummary;
}
