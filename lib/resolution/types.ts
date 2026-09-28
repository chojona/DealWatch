export type ResolutionEntityType = "PERSON" | "COMPANY" | "PROPERTY";

export interface ObservedRelationshipContext {
  predicate: string;
  objectNormalizedName: string | null;
  objectSurfaceForm: string | null;
  evidenceQuote: string;
  statedValidFrom: string | null;
  statedValidTo: string | null;
}

export interface ResolutionObservation {
  id: string;
  workspaceId: string;
  observedType: ResolutionEntityType;
  surfaceForm: string;
  normalizedName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  linkedIn: string | null;
  externalId: string | null;
  dealId: string | null;
  documentDate: string | null;
  relationships: ObservedRelationshipContext[];
}

export interface CatalogEmployment {
  companyName: string;
  aliases: string[];
  validTo: string | null;
  status: string;
}

export interface CatalogPerson {
  id: string;
  workspaceId: string;
  canonicalName: string;
  primaryTitle: string | null;
  status: string;
  aliases: string[];
  emails: string[];
  phones: string[];
  linkedIns: string[];
  employments: CatalogEmployment[];
  dealIds: string[];
}

export interface CatalogCompany {
  id: string;
  workspaceId: string;
  canonicalName: string;
  legalName: string | null;
  primaryDomain: string | null;
  status: string;
  aliases: string[];
  domains: string[];
  externalIds: string[];
  dealIds: string[];
}

export interface CatalogProperty {
  id: string;
  workspaceId: string;
  canonicalName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  status: string;
  aliases: string[];
  externalIds: string[];
  dealIds: string[];
}

export interface ResolutionCatalog {
  people: CatalogPerson[];
  companies: CatalogCompany[];
  properties: CatalogProperty[];
}

export interface ResolutionFeatureSet {
  emailExact: boolean;
  phoneExact: boolean;
  linkedInExact: boolean;
  nameExact: boolean;
  aliasExact: boolean;
  nameSimilarity: number;
  sameObservedCompany: boolean;
  historicalEmployerMatch: boolean;
  titleSimilarity: number;
  sameDealContext: boolean;
  domainExact: boolean;
  legalNameExact: boolean;
  externalIdExact: boolean;
  addressExact: boolean;
  sameCity: boolean;
  differentEmail: boolean;
  incompatibleEmployers: boolean;
  historicalEmployer: boolean;
  differentDomain: boolean;
  differentAddress: boolean;
  differentCity: boolean;
  sharedInbox: boolean;
}

export interface ResolutionProposal {
  entityType: ResolutionEntityType;
  entityId: string;
  displayName: string;
  contextLabel: string;
  score: number;
  features: ResolutionFeatureSet;
  positiveReasons: string[];
  negativeReasons: string[];
  temporalNotes: string[];
}

export interface ResolutionCandidateView {
  id: string;
  decision: "PENDING" | "ACCEPTED" | "REJECTED";
  score: number;
  positiveReasons: string[];
  negativeReasons: string[];
  temporalNotes: string[];
  decisionReason: string | null;
  decidedAt: string | null;
  candidate: {
    type: ResolutionEntityType;
    id: string;
    name: string;
    context: string;
  };
}

export interface ObservationResolutionView {
  observationId: string;
  workspaceId: string;
  observedType: ResolutionEntityType;
  surfaceForm: string;
  evidenceQuote: string;
  createNew: {
    enabled: boolean;
    label: string;
    reason: string;
  };
  candidates: ResolutionCandidateView[];
}
