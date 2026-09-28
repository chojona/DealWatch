import type {
  AffiliationKind,
  EvidenceProvenanceStatus,
  ObservedEntityType,
  ParticipationRole,
  RelationshipPredicate,
} from "@prisma/client";
import { z } from "zod";
import { locateEvidence, type EvidencePage } from "@/lib/documents/locateEvidence";
import { assertRelationshipShape } from "@/lib/entities/invariants";
import { GraphInvariantError } from "@/lib/entities/errors";
import { normalizeSurfaceForm } from "@/lib/entities/normalize";
import {
  AFFILIATION_KINDS,
  ASSERTION_STRENGTHS,
  OBSERVED_ENTITY_TYPES,
  PARTICIPATION_ROLES,
  RELATIONSHIP_PREDICATES,
  type GraphEntityModel,
  type GraphRelationshipModel,
} from "./schemas";

const CANONICAL_KEYS = [
  "personId",
  "companyId",
  "propertyId",
  "workspaceId",
  "employmentId",
  "propertyStakeId",
  "dealParticipationId",
  "canonicalId",
] as const;

const MODEL_PROVENANCE_KEYS = [
  "pageNumber",
  "page",
  "documentPageId",
  "evidenceStartOffset",
  "evidenceEndOffset",
  "provenanceStatus",
  "sourceLocation",
] as const;

const KEY_PATTERN = /^(person|company|property)_[1-9]\d*$/;

const looseConfidence = z.number().finite().nullable();

const looseEntitySchema = z
  .object({
    observationKey: z.string(),
    observedType: z.enum(OBSERVED_ENTITY_TYPES),
    observedName: z.string(),
    observedTitle: z.string().nullable(),
    observedEmail: z.string().nullable(),
    observedPhone: z.string().nullable(),
    observedLinkedIn: z.string().nullable(),
    observedWebsite: z.string().nullable(),
    observedDomain: z.string().nullable(),
    observedAddress: z.string().nullable(),
    evidenceQuote: z.string(),
    extractionConfidence: looseConfidence,
  })
  .strict();

const looseRelationshipSchema = z
  .object({
    subjectObservationKey: z.string(),
    predicate: z.enum(RELATIONSHIP_PREDICATES),
    objectObservationKey: z.string().nullable(),
    principalObservationKey: z.string().nullable(),
    participationRole: z.enum(PARTICIPATION_ROLES).nullable(),
    roleLabel: z.string().nullable(),
    affiliationKind: z.enum(AFFILIATION_KINDS).nullable(),
    statedTitle: z.string().nullable(),
    statedValidFrom: z.string().nullable(),
    statedValidTo: z.string().nullable(),
    assertionStrength: z.enum(ASSERTION_STRENGTHS),
    evidenceQuote: z.string(),
    extractionConfidence: looseConfidence,
  })
  .strict();

export interface GraphRejection {
  target: "entity" | "relationship" | "response";
  key: string | null;
  code: string;
  detail: string;
}

export interface LocatedProvenance {
  provenanceStatus: EvidenceProvenanceStatus;
  documentPageId: string | null;
  evidenceStartOffset: number | null;
  evidenceEndOffset: number | null;
}

export interface ValidatedEntityObservation {
  observationKey: string;
  observedType: ObservedEntityType;
  surfaceForm: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
  addressLine1: string | null;
  rawAttributes: Record<string, string> | null;
  evidenceQuote: string;
  extractionConfidence: number | null;
  provenance: LocatedProvenance;
}

export interface ValidatedRelationshipObservation {
  subjectObservationKey: string;
  objectObservationKey: string | null;
  principalObservationKey: string | null;
  predicate: RelationshipPredicate;
  participationRole: ParticipationRole | null;
  roleLabel: string | null;
  affiliationKind: AffiliationKind | null;
  statedTitle: string | null;
  statedValidFrom: Date | null;
  statedValidTo: Date | null;
  evidenceQuote: string;
  extractionConfidence: number | null;
  provenance: LocatedProvenance;
}

export interface ValidatedGraphObservations {
  entities: ValidatedEntityObservation[];
  relationships: ValidatedRelationshipObservation[];
  rejections: GraphRejection[];
  responseError: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blankToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function cleanTextFields(
  raw: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  const next = { ...raw };
  for (const field of fields) {
    if (field in next) next[field] = blankToNull(next[field]);
  }
  return next;
}

function canonicalKey(raw: Record<string, unknown>): string | null {
  return CANONICAL_KEYS.find((key) => key in raw) ?? null;
}

function withoutModelProvenance(raw: Record<string, unknown>): Record<string, unknown> {
  const next = { ...raw };
  for (const key of MODEL_PROVENANCE_KEYS) delete next[key];
  return next;
}

function locateQuote(quote: string, pages: EvidencePage[]): LocatedProvenance {
  const located = locateEvidence({ evidenceQuote: quote, pages });
  if (located.status === "EXACT") {
    return {
      provenanceStatus: "EXACT",
      documentPageId: located.pageId,
      evidenceStartOffset: located.startOffset,
      evidenceEndOffset: located.endOffset,
    };
  }
  return {
    provenanceStatus: located.status,
    documentPageId: null,
    evidenceStartOffset: null,
    evidenceEndOffset: null,
  };
}

function keyPrefix(type: ObservedEntityType): string {
  if (type === "PERSON") return "person";
  if (type === "COMPANY") return "company";
  return "property";
}

function evidenceMentions(quote: string, name: string): boolean {
  const needle = normalizeSurfaceForm(name);
  if (!needle) return false;
  return normalizeSurfaceForm(quote).includes(needle);
}

function confidenceIssue(value: number | null): string | null {
  if (value == null) return null;
  if (value < 0 || value > 1) return "extractionConfidence must be between 0 and 1";
  return null;
}

function parseStatedDate(value: string | null): Date | null | "invalid" {
  if (value == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return "invalid";
  const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(date.getTime())) return "invalid";
  return date;
}

function attributeIssue(entity: GraphEntityModel): string | null {
  const personFields = [entity.observedTitle, entity.observedPhone, entity.observedLinkedIn].some(
    (value) => value != null
  );
  const companyFields = [entity.observedWebsite, entity.observedDomain].some(
    (value) => value != null
  );
  const propertyFields = entity.observedAddress != null;
  if (entity.observedType === "PERSON" && (companyFields || propertyFields)) {
    return "Person observations cannot store company or property attributes";
  }
  if (entity.observedType === "COMPANY" && (personFields || propertyFields)) {
    return "Company observations cannot store person or property attributes";
  }
  if (entity.observedType === "PROPERTY" && (personFields || companyFields || entity.observedEmail)) {
    return "Property observations cannot store person or company attributes";
  }
  if (entity.observedType === "PERSON" && entity.observedEmail == null) return null;
  if (entity.observedType !== "PERSON" && entity.observedEmail != null && entity.observedType !== "COMPANY") {
    return "Email is only stored for a person or a company inbox";
  }
  return null;
}

function projectEntity(entity: GraphEntityModel): Omit<
  ValidatedEntityObservation,
  "provenance"
> {
  const raw: Record<string, string> = {};
  if (entity.observedType === "PERSON" && entity.observedLinkedIn) {
    raw.observedLinkedIn = entity.observedLinkedIn;
  }
  if (entity.observedType === "COMPANY") {
    if (entity.observedWebsite) raw.observedWebsite = entity.observedWebsite;
    if (entity.observedEmail) raw.observedEmail = entity.observedEmail;
  }
  return {
    observationKey: entity.observationKey,
    observedType: entity.observedType,
    surfaceForm: entity.observedName.trim(),
    title: entity.observedType === "PERSON" ? entity.observedTitle : null,
    email: entity.observedType === "PERSON" ? entity.observedEmail : null,
    phone: entity.observedType === "PERSON" ? entity.observedPhone : null,
    domain: entity.observedType === "COMPANY" ? entity.observedDomain : null,
    addressLine1: entity.observedType === "PROPERTY" ? entity.observedAddress : null,
    rawAttributes: Object.keys(raw).length > 0 ? raw : null,
    evidenceQuote: entity.evidenceQuote.trim(),
    extractionConfidence: entity.extractionConfidence,
  };
}

const ENTITY_TEXT_FIELDS = [
  "observedTitle",
  "observedEmail",
  "observedPhone",
  "observedLinkedIn",
  "observedWebsite",
  "observedDomain",
  "observedAddress",
];

const RELATIONSHIP_TEXT_FIELDS = [
  "objectObservationKey",
  "principalObservationKey",
  "roleLabel",
  "statedTitle",
  "statedValidFrom",
  "statedValidTo",
];

function instructionShaped(quote: string): boolean {
  return /ignore\s+(previous|prior|all)\s+instructions/i.test(quote);
}

/**
 * Deterministic boundary between model JSON and observation writes.
 * DealWatch locates evidence. Model page numbers are discarded.
 * Workspace is never read from the model payload.
 */
export function validateGraphObservations(input: {
  modelOutput: unknown;
  pages: EvidencePage[];
}): ValidatedGraphObservations {
  const rejections: GraphRejection[] = [];
  if (!isRecord(input.modelOutput)) {
    return {
      entities: [],
      relationships: [],
      rejections: [
        {
          target: "response",
          key: null,
          code: "MALFORMED_RESPONSE",
          detail: "Graph extraction response must be an object",
        },
      ],
      responseError: "Graph extraction response must be an object",
    };
  }

  if ("workspaceId" in input.modelOutput) {
    rejections.push({
      target: "response",
      key: null,
      code: "IGNORED_MODEL_WORKSPACE",
      detail: "Workspace is taken from the document deal, not model output",
    });
  }

  const entitiesRaw = input.modelOutput.entities;
  const relationshipsRaw = input.modelOutput.relationships;
  if (!Array.isArray(entitiesRaw) || !Array.isArray(relationshipsRaw)) {
    return {
      entities: [],
      relationships: [],
      rejections: [
        ...rejections,
        {
          target: "response",
          key: null,
          code: "MALFORMED_RESPONSE",
          detail: "entities and relationships must be arrays",
        },
      ],
      responseError: "entities and relationships must be arrays",
    };
  }

  const accepted = new Map<string, ValidatedEntityObservation>();

  entitiesRaw.forEach((item, index) => {
    const keyHint = isRecord(item) && typeof item.observationKey === "string"
      ? item.observationKey
      : `entity_${index + 1}`;
    if (!isRecord(item)) {
      rejections.push({
        target: "entity",
        key: keyHint,
        code: "MALFORMED_ENTITY",
        detail: "Entity observation must be an object",
      });
      return;
    }
    const forbidden = canonicalKey(item);
    if (forbidden) {
      rejections.push({
        target: "entity",
        key: keyHint,
        code: "CANONICAL_ID",
        detail: `Model supplied ${forbidden}`,
      });
      return;
    }
    if (typeof item.observedType === "string" && !OBSERVED_ENTITY_TYPES.includes(item.observedType as never)) {
      rejections.push({
        target: "entity",
        key: keyHint,
        code: "UNSUPPORTED_ENTITY_TYPE",
        detail: `Unsupported entity type ${item.observedType}`,
      });
      return;
    }
    const parsed = looseEntitySchema.safeParse(
      cleanTextFields(withoutModelProvenance(item), ENTITY_TEXT_FIELDS)
    );
    if (!parsed.success) {
      rejections.push({
        target: "entity",
        key: keyHint,
        code: "MALFORMED_ENTITY",
        detail: parsed.error.issues[0]?.message ?? "Malformed entity",
      });
      return;
    }
    const entity = parsed.data;
    if (!KEY_PATTERN.test(entity.observationKey) || !entity.observationKey.startsWith(keyPrefix(entity.observedType) + "_")) {
      rejections.push({
        target: "entity",
        key: entity.observationKey,
        code: "INVALID_OBSERVATION_KEY",
        detail: "observationKey must be person_N, company_N, or property_N for its type",
      });
      return;
    }
    if (accepted.has(entity.observationKey)) {
      rejections.push({
        target: "entity",
        key: entity.observationKey,
        code: "DUPLICATE_OBSERVATION_KEY",
        detail: "observationKey is already used in this extraction",
      });
      return;
    }
    if (!entity.observedName.trim() || !entity.evidenceQuote.trim()) {
      rejections.push({
        target: "entity",
        key: entity.observationKey,
        code: "MISSING_REQUIRED_TEXT",
        detail: "observedName and evidenceQuote are required",
      });
      return;
    }
    if (instructionShaped(entity.evidenceQuote)) {
      rejections.push({
        target: "entity",
        key: entity.observationKey,
        code: "PROMPT_INJECTION",
        detail: "Evidence is an instruction, not a CRE assertion",
      });
      return;
    }
    if (!evidenceMentions(entity.evidenceQuote, entity.observedName)) {
      rejections.push({
        target: "entity",
        key: entity.observationKey,
        code: "EVIDENCE_DOES_NOT_MENTION_ENTITY",
        detail: "Entity evidence must contain the observed name",
      });
      return;
    }
    const confidence = confidenceIssue(entity.extractionConfidence);
    if (confidence) {
      rejections.push({
        target: "entity",
        key: entity.observationKey,
        code: "INVALID_CONFIDENCE",
        detail: confidence,
      });
      return;
    }
    const attributes = attributeIssue(entity);
    if (attributes) {
      rejections.push({
        target: "entity",
        key: entity.observationKey,
        code: "INVALID_ATTRIBUTES",
        detail: attributes,
      });
      return;
    }
    const projected = projectEntity(entity);
    accepted.set(entity.observationKey, {
      ...projected,
      provenance: locateQuote(projected.evidenceQuote, input.pages),
    });
  });

  const relationships: ValidatedRelationshipObservation[] = [];

  relationshipsRaw.forEach((item, index) => {
    const keyHint = isRecord(item) && typeof item.subjectObservationKey === "string"
      ? item.subjectObservationKey
      : `relationship_${index + 1}`;
    if (!isRecord(item)) {
      rejections.push({
        target: "relationship",
        key: keyHint,
        code: "MALFORMED_RELATIONSHIP",
        detail: "Relationship observation must be an object",
      });
      return;
    }
    const forbidden = canonicalKey(item);
    if (forbidden) {
      rejections.push({
        target: "relationship",
        key: keyHint,
        code: "CANONICAL_ID",
        detail: `Model supplied ${forbidden}`,
      });
      return;
    }
    if (
      typeof item.predicate === "string" &&
      !RELATIONSHIP_PREDICATES.includes(item.predicate as never)
    ) {
      rejections.push({
        target: "relationship",
        key: keyHint,
        code: "UNSUPPORTED_PREDICATE",
        detail: `Unsupported predicate ${item.predicate}`,
      });
      return;
    }
    const parsed = looseRelationshipSchema.safeParse(
      cleanTextFields(withoutModelProvenance(item), RELATIONSHIP_TEXT_FIELDS)
    );
    if (!parsed.success) {
      rejections.push({
        target: "relationship",
        key: keyHint,
        code: "MALFORMED_RELATIONSHIP",
        detail: parsed.error.issues[0]?.message ?? "Malformed relationship",
      });
      return;
    }
    const relationship = parsed.data;
    const rejection = relationshipIssue(relationship, accepted);
    if (rejection) {
      rejections.push({
        target: "relationship",
        key: relationship.subjectObservationKey,
        code: rejection.code,
        detail: rejection.detail,
      });
      return;
    }
    const subject = accepted.get(relationship.subjectObservationKey);
    const object = relationship.objectObservationKey
      ? accepted.get(relationship.objectObservationKey) ?? null
      : null;
    const principal = relationship.principalObservationKey
      ? accepted.get(relationship.principalObservationKey) ?? null
      : null;
    if (!subject) return;
    const from = parseStatedDate(relationship.statedValidFrom);
    const to = parseStatedDate(relationship.statedValidTo);
    relationships.push({
      subjectObservationKey: subject.observationKey,
      objectObservationKey: object?.observationKey ?? null,
      principalObservationKey: principal?.observationKey ?? null,
      predicate: relationship.predicate,
      participationRole: relationship.participationRole,
      roleLabel: relationship.roleLabel,
      affiliationKind: relationship.predicate === "WORKS_AT" ? relationship.affiliationKind : null,
      statedTitle: relationship.statedTitle,
      statedValidFrom: from instanceof Date ? from : null,
      statedValidTo: to instanceof Date ? to : null,
      evidenceQuote: relationship.evidenceQuote.trim(),
      extractionConfidence: relationship.extractionConfidence,
      provenance: locateQuote(relationship.evidenceQuote.trim(), input.pages),
    });
  });

  return {
    entities: [...accepted.values()],
    relationships,
    rejections,
    responseError: null,
  };
}

function relationshipIssue(
  relationship: GraphRelationshipModel,
  accepted: Map<string, ValidatedEntityObservation>
): { code: string; detail: string } | null {
  if (!relationship.evidenceQuote.trim()) {
    return { code: "MISSING_EVIDENCE", detail: "Relationship evidence quote is required" };
  }
  if (instructionShaped(relationship.evidenceQuote)) {
    return {
      code: "PROMPT_INJECTION",
      detail: "Relationship evidence is an instruction, not a CRE assertion",
    };
  }
  if (
    relationship.assertionStrength === "NEGATED" ||
    relationship.assertionStrength === "UNCERTAIN"
  ) {
    return {
      code:
        relationship.assertionStrength === "NEGATED"
          ? "NEGATED_RELATIONSHIP"
          : "UNCERTAIN_RELATIONSHIP",
      detail: "Only stated or historical relationships are stored as observations",
    };
  }
  const confidence = confidenceIssue(relationship.extractionConfidence);
  if (confidence) return { code: "INVALID_CONFIDENCE", detail: confidence };
  const from = parseStatedDate(relationship.statedValidFrom);
  const to = parseStatedDate(relationship.statedValidTo);
  if (from === "invalid" || to === "invalid") {
    return { code: "INVALID_DATE", detail: "Stated dates must be ISO dates" };
  }
  if (from instanceof Date && to instanceof Date && to.getTime() < from.getTime()) {
    return { code: "INVALID_DATE", detail: "statedValidTo must be on or after statedValidFrom" };
  }

  const subject = accepted.get(relationship.subjectObservationKey);
  if (!subject) {
    return {
      code: "MISSING_ENDPOINT",
      detail: "Relationship subject is not an accepted entity in this extraction",
    };
  }
  const object = relationship.objectObservationKey
    ? accepted.get(relationship.objectObservationKey)
    : null;
  if (relationship.objectObservationKey && !object) {
    return {
      code: "MISSING_ENDPOINT",
      detail: "Relationship object is not an accepted entity in this extraction",
    };
  }
  const principal = relationship.principalObservationKey
    ? accepted.get(relationship.principalObservationKey)
    : null;
  if (relationship.principalObservationKey && !principal) {
    return {
      code: "MISSING_ENDPOINT",
      detail: "Relationship principal is not an accepted entity in this extraction",
    };
  }

  try {
    assertRelationshipShape({
      predicate: relationship.predicate,
      subjectType: subject.observedType,
      objectType: object?.observedType ?? null,
      participationRole: relationship.participationRole,
      roleLabel: relationship.roleLabel,
      affiliationKind: relationship.affiliationKind,
      contextDealId: relationship.predicate === "PARTICIPATES_AS" || relationship.predicate === "CONCERNS_PROPERTY"
        ? "document-deal"
        : null,
      principalType: principal?.observedType ?? null,
    });
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return { code: "INVALID_ENDPOINTS", detail: error.message };
    }
    throw error;
  }

  if (!evidenceMentions(relationship.evidenceQuote, subject.surfaceForm)) {
    return {
      code: "EVIDENCE_DOES_NOT_STATE_RELATIONSHIP",
      detail: "Relationship evidence must mention the subject",
    };
  }
  if (object && !evidenceMentions(relationship.evidenceQuote, object.surfaceForm)) {
    return {
      code: "EVIDENCE_DOES_NOT_STATE_RELATIONSHIP",
      detail: "Relationship evidence must mention the object",
    };
  }
  if (principal && !evidenceMentions(relationship.evidenceQuote, principal.surfaceForm)) {
    return {
      code: "EVIDENCE_DOES_NOT_STATE_RELATIONSHIP",
      detail: "Relationship evidence must mention the represented principal",
    };
  }
  return null;
}
