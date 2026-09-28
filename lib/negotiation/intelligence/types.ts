import type { CREStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type {
  CanonicalTermType,
  NegotiationSide,
  NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";

export type NegotiationWorkspaceFilter =
  | "ALL"
  | "OPEN"
  | "AGREED"
  | "CHANGED"
  | "CONFLICTS";

export type NegotiationTermGroup =
  | "ECONOMICS"
  | "TIMING"
  | "RIGHTS"
  | "OPERATIONS";

export interface FormattedTermValue {
  summary: string;
  details: Array<{ label: string; value: string }>;
}

export interface NegotiationEvidenceView {
  observationId: string;
  quote: string;
  confidence: number;
  sourceKind: string;
  sourceLabel: string;
  sourceLocation: string | null;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
  pageNumber: number | null;
  pageLabel: string | null;
  documentId: string | null;
  href: string | null;
  modelDerived: true;
}

export interface NegotiationObservationView {
  id: string;
  roundId: string;
  roundName: string;
  roundDate: string;
  side: NegotiationSide;
  status: NegotiationTermStatus;
  value: FormattedTermValue;
  evidence: NegotiationEvidenceView;
}

export interface NegotiationPositionCandidateView {
  value: FormattedTermValue;
  structuredPayload: CREStructuredPayload | null;
  observationIds: string[];
}

export type NegotiationPositionView =
  | ({ kind: "VALUE" } & NegotiationPositionCandidateView)
  | {
      kind: "CONFLICT";
      label: string;
      candidates: NegotiationPositionCandidateView[];
      observationIds: string[];
    };

export interface NegotiationMovementView {
  kind: "NUMERIC" | "CHANGED" | "UNCHANGED" | "NONE";
  label: string;
  side: NegotiationSide | null;
  from: number | null;
  to: number | null;
  amount: number | null;
  unit: string | null;
  direction:
    | "TOWARD_TENANT"
    | "TOWARD_LANDLORD"
    | "NEUTRAL"
    | "UNKNOWN";
  roundId: string | null;
}

export interface NumericGapView {
  value: number;
  unit: string;
  display: string;
}

export interface NegotiationTermView {
  canonicalType: CanonicalTermType;
  label: string;
  group: NegotiationTermGroup;
  resolutionMode: "STRUCTURED" | "LEGACY";
  tenantPosition: NegotiationPositionView | null;
  landlordPosition: NegotiationPositionView | null;
  agreedPosition: NegotiationPositionView | null;
  status: NegotiationTermStatus;
  conflict: boolean;
  movement: NegotiationMovementView;
  numericGap: NumericGapView | null;
  changedInLatestRound: boolean;
  latestSideToChange: NegotiationSide | null;
  structuredState: {
    status: NegotiationTermStatus;
    sourceObservationIds: string[];
  } | null;
  evidence: NegotiationEvidenceView[];
  history: NegotiationObservationView[];
  sourceObservationIds: string[];
}

export interface NegotiationRoundChangeView {
  canonicalType: CanonicalTermType;
  label: string;
  kind: "CHANGED" | "UNCHANGED" | "AGREED";
  previousValue: string | null;
  currentValue: string;
}

export interface NegotiationRoundView {
  id: string;
  side: NegotiationSide;
  roundNumber: number;
  documentName: string;
  documentDate: string;
  sourceType: string;
  documentId: string | null;
  documentHref: string | null;
  changedCount: number;
  unchangedCount: number;
  agreedCount: number;
  changes: NegotiationRoundChangeView[];
}

export interface NegotiationDocumentView {
  id: string;
  name: string;
  documentType: string;
  documentDate: string | null;
  ingestionStatus: string;
  pageCount: number | null;
  termCount: number;
  sourceHref: string;
  reviewHref: string;
  workspaceHref: string;
}

export interface NegotiationWorkspace {
  deal: {
    id: string;
    name: string;
    company: string;
    property: string;
    propertyId: string | null;
    stage: string;
    status: string;
    estimatedValue: number | null;
    createdAt: string;
  };
  summary: {
    openCount: number;
    agreedCount: number;
    conflictCount: number;
    changedThisRoundCount: number;
  };
  terms: NegotiationTermView[];
  rounds: NegotiationRoundView[];
  documents: NegotiationDocumentView[];
  latestRound: NegotiationRoundView | null;
  unresolvedCount: number;
  agreedCount: number;
  conflictCount: number;
}
