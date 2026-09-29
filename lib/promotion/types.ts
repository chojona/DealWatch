export type CanonicalEntityType = "PERSON" | "COMPANY" | "PROPERTY";

export type RelationshipReviewStatus =
  | "PENDING"
  | "BLOCKED_UNRESOLVED_ENTITY"
  | "APPROVED"
  | "REJECTED"
  | "ACKNOWLEDGED_BLOCKED";

export interface CanonicalFieldPreview {
  label: string;
  value: string;
  note: string | null;
}

export interface CanonicalEntityPreview {
  observationId: string;
  workspaceId: string;
  observedType: CanonicalEntityType;
  actionLabel: string;
  fields: CanonicalFieldPreview[];
  blockedReason: string | null;
  alreadyResolved: {
    entityId: string;
    name: string;
    resolutionLinkId: string;
  } | null;
}

export interface CanonicalEntityResult {
  observationId: string;
  workspaceId: string;
  observedType: CanonicalEntityType;
  entityId: string;
  resolutionLinkId: string;
  idempotent: boolean;
}

export interface ResolvedEndpointView {
  role: "subject" | "object" | "principal";
  observationId: string;
  surfaceForm: string;
  observedType: string;
  resolved: boolean;
  /** UNREVIEWED observations are not the same as an explicit left-unresolved decision. */
  closure: "UNREVIEWED" | "RESOLVED" | "LEFT_UNRESOLVED";
  entityId: string | null;
  entityName: string | null;
}

export interface RelationshipConflict {
  severity: "info" | "block";
  message: string;
}

export interface ExistingAssertionView {
  kind: "Employment" | "PropertyStake" | "DealParticipation" | "DealProperty";
  id: string;
  summary: string;
}

export interface RelationshipPromotionPreview {
  relationshipObservationId: string;
  workspaceId: string;
  predicate: string;
  status: RelationshipReviewStatus;
  canApprove: boolean;
  blockReason: string | null;
  headline: string;
  assertionLines: CanonicalFieldPreview[];
  evidenceQuote: string;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
  pageNumber: number | null;
  documentId: string | null;
  documentName: string | null;
  messageId: string | null;
  sourceKind: string;
  sourceLocation: string | null;
  endpoints: ResolvedEndpointView[];
  conflicts: RelationshipConflict[];
  existingAssertion: ExistingAssertionView | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  actor: "MANUAL_REVIEW" | null;
  canonical:
    | {
        kind: ExistingAssertionView["kind"];
        id: string;
      }
    | null;
}

export interface EvidenceSupport {
  observationId: string;
  quote: string;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
  pageNumber: number | null;
  documentId: string | null;
  documentName: string | null;
  messageId: string | null;
  messageSubject: string | null;
  messageSender: string | null;
  sourceKind: string;
  sourceLocation: string | null;
  sourceDate: string | null;
  href: string | null;
  reviewHref: string | null;
  evidenceStartOffset: number | null;
  evidenceEndOffset: number | null;
  reviewState: string | null;
}

export interface EvidenceView {
  title: string;
  supportCount: number;
  supports: EvidenceSupport[];
}

export interface DealKnowledgePerson {
  personId: string;
  name: string;
  roles: string[];
    employers: Array<{
      employmentId: string;
      companyId: string;
      companyName: string;
    affiliationKind: string;
    titleAtTime: string | null;
  }>;
  origin: EvidenceView;
}

export interface DealKnowledge {
  dealId: string;
  dealName: string;
  workspaceId: string;
  propertyLabel: string;
  canonical: {
    property: {
      id: string;
      name: string;
      address: string;
      evidence: EvidenceView;
      origin: EvidenceView;
    } | null;
    stakes: Array<{
      id: string;
      predicate: string;
      companyId: string;
      companyName: string;
      evidence: EvidenceView;
    }>;
    participations: Array<{
      id: string;
      role: string;
      roleLabel: string | null;
      actorId: string | null;
      actorType: "PERSON" | "COMPANY" | null;
      actorName: string;
      representsCompanyId: string | null;
      representsCompanyName: string | null;
      evidence: EvidenceView;
    }>;
    employments: Array<{
      id: string;
      personId: string;
      personName: string;
      companyId: string;
      companyName: string;
      affiliationKind: string;
      titleAtTime: string | null;
      evidence: EvidenceView;
    }>;
    people: DealKnowledgePerson[];
  };
  pending: {
    entities: Array<{
      id: string;
      observedType: string;
      surfaceForm: string;
      evidenceQuote: string;
      sourceKind: string;
      sourceLabel: string;
      documentId: string | null;
      documentName: string | null;
      messageId: string | null;
      messageSubject: string | null;
      messageSender: string | null;
      reviewHref: string | null;
      provenanceStatus: EvidenceSupport["provenanceStatus"];
      pageNumber: number | null;
      evidenceStartOffset: number | null;
      evidenceEndOffset: number | null;
    }>;
    relationships: Array<{
      id: string;
      predicate: string;
      status: RelationshipReviewStatus;
      evidenceQuote: string;
      headline: string;
      sourceKind: string;
      sourceLabel: string;
      documentId: string | null;
      documentName: string | null;
      messageId: string | null;
      messageSubject: string | null;
      messageSender: string | null;
      reviewHref: string | null;
      provenanceStatus: EvidenceSupport["provenanceStatus"];
      pageNumber: number | null;
      evidenceStartOffset: number | null;
      evidenceEndOffset: number | null;
    }>;
  };
}
