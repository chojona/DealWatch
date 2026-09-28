import type { EvidenceView } from "@/lib/promotion/types";

export type IntelligenceEntityType = "PERSON" | "COMPANY" | "PROPERTY" | "DEAL";

export interface IntelligenceEntityRef {
  id: string;
  type: IntelligenceEntityType;
  name: string;
  href: string;
  subtitle?: string | null;
}

export interface ValidityView {
  validFrom: string | null;
  validTo: string | null;
  validFromPrecision: string;
  validToPrecision: string;
  current: boolean;
}

export interface IntelligenceAssertion {
  id: string;
  kind: "Employment" | "PropertyStake" | "DealParticipation" | "DealProperty";
  label: string;
  subject: IntelligenceEntityRef;
  object: IntelligenceEntityRef;
  context?: IntelligenceEntityRef | null;
  representedCompany?: IntelligenceEntityRef | null;
  detail?: string | null;
  validity?: ValidityView;
  evidence: EvidenceView;
}

export interface IntelligenceBase {
  workspaceId: string;
  connectionsHref: string;
  pending: {
    count: number;
    reviewHrefs: string[];
  };
  relationships: IntelligenceAssertion[];
}

export interface PersonIntelligence extends IntelligenceBase {
  type: "PERSON";
  person: IntelligenceEntityRef & {
    primaryTitle: string | null;
    identifiers: Array<{ kind: string; value: string }>;
    externalIdentifiers: Array<{ scheme: string; value: string }>;
  };
  employments: IntelligenceAssertion[];
  deals: IntelligenceAssertion[];
  properties: IntelligenceAssertion[];
}

export interface CompanyIntelligence extends IntelligenceBase {
  type: "COMPANY";
  company: IntelligenceEntityRef & {
    legalName: string | null;
    website: string | null;
    primaryDomain: string | null;
    identifiers: Array<{ kind: string; value: string }>;
    externalIdentifiers: Array<{ scheme: string; value: string }>;
  };
  people: IntelligenceAssertion[];
  deals: IntelligenceAssertion[];
  properties: IntelligenceAssertion[];
  representation: IntelligenceAssertion[];
}

export interface PropertyIntelligence extends IntelligenceBase {
  type: "PROPERTY";
  property: IntelligenceEntityRef & {
    address: string;
    assetType: string;
    externalIdentifiers: Array<{ scheme: string; value: string }>;
  };
  stakes: IntelligenceAssertion[];
  deals: IntelligenceAssertion[];
  participants: IntelligenceAssertion[];
}
