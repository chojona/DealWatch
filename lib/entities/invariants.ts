import type {
  AffiliationKind,
  EvidenceProvenanceStatus,
  ObservationSourceKind,
  ObservedEntityType,
  ParticipationRole,
  RelationshipPredicate,
} from "@prisma/client";
import { GraphInvariantError } from "./errors";

const COMPANY_ONLY_ROLES = new Set<ParticipationRole>([
  "TENANT",
  "LANDLORD",
  "SUBTENANT",
  "SUBLANDLORD",
  "TENANT_BROKERAGE",
  "LANDLORD_BROKERAGE",
  "LENDER",
  "GUARANTOR",
]);

const PERSON_ONLY_ROLES = new Set<ParticipationRole>([
  "TENANT_BROKER",
  "LANDLORD_BROKER",
]);

const BINARY_PREDICATES = new Set<RelationshipPredicate>([
  "WORKS_AT",
  "OWNS",
  "MANAGES",
  "OCCUPIES",
  "DEVELOPED",
  "LENDS_ON",
]);

export function assertWorkspaceMatch(
  expected: string,
  actual: string,
  label: string
): void {
  if (expected !== actual) {
    throw new GraphInvariantError(`${label} belongs to a different workspace`);
  }
}

export function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new GraphInvariantError(`${label} is required`);
  }
  return trimmed;
}

export function assertConfidence(value: number | null | undefined): void {
  if (value == null) return;
  if (value < 0 || value > 1) {
    throw new GraphInvariantError(
      "extractionConfidence must be between 0 and 1"
    );
  }
}

export function assertValidInterval(
  validFrom: Date | null | undefined,
  validTo: Date | null | undefined
): void {
  if (validFrom && validTo && validTo.getTime() < validFrom.getTime()) {
    throw new GraphInvariantError("validTo must be on or after validFrom");
  }
}

/**
 * As-of inclusion from Phase 6A. Null bounds match every date.
 * Unknown intervals stay visible.
 */
export function matchesAsOf(
  row: {
    status: "ASSERTED" | "RETIRED";
    validFrom: Date | null;
    validTo: Date | null;
  },
  asOf: Date
): boolean {
  if (row.status !== "ASSERTED") return false;
  if (row.validFrom && row.validFrom.getTime() > asOf.getTime()) return false;
  if (row.validTo && row.validTo.getTime() < asOf.getTime()) return false;
  return true;
}

export function assertMergePointer(input: {
  status: "ACTIVE" | "INACTIVE" | "MERGED";
  mergedIntoId: string | null;
  selfId?: string | null;
}): void {
  if (input.status === "MERGED" && !input.mergedIntoId) {
    throw new GraphInvariantError("MERGED entities require mergedInto id");
  }
  if (input.status !== "MERGED" && input.mergedIntoId) {
    throw new GraphInvariantError("mergedInto id is only set when status is MERGED");
  }
  if (
    input.selfId &&
    input.mergedIntoId &&
    input.selfId === input.mergedIntoId
  ) {
    throw new GraphInvariantError("An entity cannot merge into itself");
  }
}

export function assertObservationAttributes(input: {
  observedType: ObservedEntityType;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  domain?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): void {
  const personFields = [input.title, input.email, input.phone].some(Boolean);
  const companyFields = Boolean(input.domain);
  const propertyFields = [
    input.addressLine1,
    input.city,
    input.region,
    input.postalCode,
    input.country,
  ].some(Boolean);

  if (input.observedType === "PERSON" && (companyFields || propertyFields)) {
    throw new GraphInvariantError(
      "Person observations cannot store company or property attributes"
    );
  }
  if (input.observedType === "COMPANY" && (personFields || propertyFields)) {
    throw new GraphInvariantError(
      "Company observations cannot store person or property attributes"
    );
  }
  if (input.observedType === "PROPERTY" && (personFields || companyFields)) {
    throw new GraphInvariantError(
      "Property observations cannot store person or company attributes"
    );
  }
}

export function assertProvenanceShape(input: {
  sourceKind: ObservationSourceKind;
  dealId?: string | null;
  documentId?: string | null;
  documentPageId?: string | null;
  messageId?: string | null;
  provenanceStatus?: EvidenceProvenanceStatus | null;
  evidenceStartOffset?: number | null;
  evidenceEndOffset?: number | null;
  evidenceQuote: string;
}): void {
  assertNonEmpty(input.evidenceQuote, "evidenceQuote");
  const offsets = [input.evidenceStartOffset, input.evidenceEndOffset];
  const offsetsSet = offsets.filter((value) => value != null);
  if (offsetsSet.length === 1) {
    throw new GraphInvariantError("Evidence offsets must both be set or both be null");
  }
  if (
    input.evidenceStartOffset != null &&
    input.evidenceEndOffset != null &&
    input.evidenceEndOffset < input.evidenceStartOffset
  ) {
    throw new GraphInvariantError("evidenceEndOffset must be on or after the start");
  }

  if (input.provenanceStatus === "EXACT") {
    if (!input.documentPageId) {
      throw new GraphInvariantError("EXACT provenance requires documentPageId");
    }
    if (input.evidenceStartOffset == null || input.evidenceEndOffset == null) {
      throw new GraphInvariantError("EXACT provenance requires evidence offsets");
    }
  } else if (input.documentPageId) {
    throw new GraphInvariantError(
      "documentPageId is set only when provenanceStatus is EXACT"
    );
  }

  if (input.sourceKind === "DOCUMENT_PAGE") {
    if (!input.documentId || !input.dealId) {
      throw new GraphInvariantError(
        "DOCUMENT_PAGE observations require documentId and dealId"
      );
    }
  } else if (input.sourceKind === "MESSAGE") {
    if (!input.messageId || !input.dealId) {
      throw new GraphInvariantError(
        "MESSAGE observations require messageId and dealId"
      );
    }
    if (input.documentId || input.documentPageId) {
      throw new GraphInvariantError(
        "MESSAGE observations cannot reference a document page"
      );
    }
  } else if (input.sourceKind === "MANUAL") {
    if (input.documentId || input.documentPageId || input.messageId) {
      throw new GraphInvariantError(
        "MANUAL observations cannot reference a document or message"
      );
    }
    if (input.provenanceStatus) {
      throw new GraphInvariantError("MANUAL observations have null provenanceStatus");
    }
  }
}

export function assertRelationshipShape(input: {
  predicate: RelationshipPredicate;
  subjectType: ObservedEntityType;
  objectType: ObservedEntityType | null;
  participationRole?: ParticipationRole | null;
  roleLabel?: string | null;
  affiliationKind?: AffiliationKind | null;
  contextDealId?: string | null;
  principalType?: ObservedEntityType | null;
}): void {
  if (input.predicate === "WORKS_AT") {
    if (input.subjectType !== "PERSON" || input.objectType !== "COMPANY") {
      throw new GraphInvariantError("WORKS_AT requires a person subject and company object");
    }
    if (input.participationRole || input.roleLabel) {
      throw new GraphInvariantError("WORKS_AT cannot carry a participation role");
    }
    return;
  }

  if (
    input.predicate === "OWNS" ||
    input.predicate === "MANAGES" ||
    input.predicate === "OCCUPIES" ||
    input.predicate === "DEVELOPED" ||
    input.predicate === "LENDS_ON"
  ) {
    if (input.subjectType !== "COMPANY" || input.objectType !== "PROPERTY") {
      throw new GraphInvariantError(
        `${input.predicate} requires a company subject and property object`
      );
    }
    if (input.participationRole || input.roleLabel || input.affiliationKind) {
      throw new GraphInvariantError(
        `${input.predicate} cannot carry employment or participation qualifiers`
      );
    }
    return;
  }

  if (input.predicate === "PARTICIPATES_AS") {
    if (!input.participationRole) {
      throw new GraphInvariantError("PARTICIPATES_AS requires a participation role");
    }
    if (input.objectType) {
      throw new GraphInvariantError("PARTICIPATES_AS has no object observation");
    }
    if (!input.contextDealId) {
      throw new GraphInvariantError("PARTICIPATES_AS requires contextDealId");
    }
    if (input.participationRole === "OTHER" && !input.roleLabel?.trim()) {
      throw new GraphInvariantError("OTHER participation observations require roleLabel");
    }
    if (input.principalType && input.principalType !== "COMPANY") {
      throw new GraphInvariantError("A represented principal must be a company observation");
    }
    return;
  }

  if (input.predicate === "CONCERNS_PROPERTY") {
    if (input.subjectType !== "PROPERTY" || input.objectType) {
      throw new GraphInvariantError(
        "CONCERNS_PROPERTY requires a property subject and no object"
      );
    }
    if (!input.contextDealId) {
      throw new GraphInvariantError("CONCERNS_PROPERTY requires contextDealId");
    }
    if (input.participationRole || input.roleLabel || input.affiliationKind) {
      throw new GraphInvariantError("CONCERNS_PROPERTY cannot carry role qualifiers");
    }
    return;
  }

  if (BINARY_PREDICATES.has(input.predicate) && !input.objectType) {
    throw new GraphInvariantError(`${input.predicate} requires an object observation`);
  }
}

export function assertParticipationActor(input: {
  role: ParticipationRole;
  personId?: string | null;
  companyId?: string | null;
  representsCompanyId?: string | null;
  roleLabel?: string | null;
}): void {
  const hasPerson = Boolean(input.personId);
  const hasCompany = Boolean(input.companyId);
  if (hasPerson === hasCompany) {
    throw new GraphInvariantError(
      "Deal participation requires exactly one of personId or companyId"
    );
  }
  if (
    input.representsCompanyId &&
    input.companyId &&
    input.representsCompanyId === input.companyId
  ) {
    throw new GraphInvariantError("A company cannot represent itself on a deal");
  }
  if (input.role === "OTHER") {
    if (!input.roleLabel?.trim()) {
      throw new GraphInvariantError("OTHER participations require roleLabel");
    }
  } else if (input.roleLabel) {
    throw new GraphInvariantError("roleLabel is only set when role is OTHER");
  }
  if (COMPANY_ONLY_ROLES.has(input.role) && !hasCompany) {
    throw new GraphInvariantError(`${input.role} participation requires a company`);
  }
  if (PERSON_ONLY_ROLES.has(input.role) && !hasPerson) {
    throw new GraphInvariantError(`${input.role} participation requires a person`);
  }
}

export function evidenceDeletionRefused(referenceCount: number): boolean {
  return referenceCount > 0;
}

/**
 * Policy predicate only. Phase 6B does not promote observations.
 * UNLOCATED evidence is not auto-promoted. A user accept is explicit.
 */
export function promotionPermitted(input: {
  disposition: "PENDING" | "ACCEPTED" | "REJECTED";
  provenanceStatus?: EvidenceProvenanceStatus | null;
  dispositionActor?: "USER" | "SYSTEM" | null;
}): boolean {
  if (input.disposition !== "ACCEPTED") return false;
  if (
    input.provenanceStatus === "UNLOCATED" &&
    input.dispositionActor !== "USER"
  ) {
    return false;
  }
  return true;
}

export function assertExactlyOneObservationSide(input: {
  entityObservationId?: string | null;
  relationshipObservationId?: string | null;
}): void {
  const sides = [input.entityObservationId, input.relationshipObservationId].filter(
    Boolean
  );
  if (sides.length !== 1) {
    throw new GraphInvariantError(
      "Disposition and supersession rows reference exactly one observation"
    );
  }
}

export function assertExactlyOneExternalTarget(input: {
  personId?: string | null;
  companyId?: string | null;
  propertyId?: string | null;
}): void {
  const targets = [input.personId, input.companyId, input.propertyId].filter(
    Boolean
  );
  if (targets.length !== 1) {
    throw new GraphInvariantError(
      "ExternalIdentifier requires exactly one entity"
    );
  }
}
