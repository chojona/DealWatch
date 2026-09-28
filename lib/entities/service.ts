import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AffiliationKind,
  AssertionSource,
  AssetType,
  Company,
  CompanyIdentifierKind,
  DatePrecision,
  Deal,
  DealParticipation,
  DispositionActor,
  Employment,
  EntityObservation,
  EvidenceProvenanceStatus,
  ObservationDispositionValue,
  ObservationSourceKind,
  ObservedEntityType,
  ParticipationRole,
  Person,
  PersonIdentifierKind,
  Property,
  PropertyStake,
  PropertyStakePredicate,
  RelationshipObservation,
  RelationshipPredicate,
} from "@prisma/client";
import { locateEvidence } from "@/lib/documents/locateEvidence";
import { GraphInvariantError } from "./errors";
import {
  assertConfidence,
  assertExactlyOneExternalTarget,
  assertExactlyOneObservationSide,
  assertNonEmpty,
  assertObservationAttributes,
  assertParticipationActor,
  assertProvenanceShape,
  assertRelationshipShape,
  assertValidInterval,
  assertWorkspaceMatch,
  evidenceDeletionRefused,
  matchesAsOf,
} from "./invariants";
import {
  normalizeCompanyName,
  normalizeDomain,
  normalizeEmail,
  normalizePersonName,
  normalizePhone,
  normalizeSurfaceForm,
} from "./normalize";
import type { GraphDb } from "./workspace";

export type { GraphDb } from "./workspace";

type AssertionClock = {
  validFrom?: Date | null;
  validTo?: Date | null;
  validFromPrecision?: DatePrecision;
  validToPrecision?: DatePrecision;
  assertionSource: AssertionSource;
};

const openTransactions = new WeakSet<object>();

function inTransaction<T>(db: GraphDb, fn: (tx: GraphDb) => Promise<T>): Promise<T> {
  if (openTransactions.has(db) || !("$transaction" in db)) {
    return fn(db);
  }
  return (db as PrismaClient).$transaction((tx) => {
    openTransactions.add(tx);
    return fn(tx);
  });
}

function rethrowUnique(error: unknown, message: string): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new GraphInvariantError(message);
  }
  throw error;
}

async function requireWorkspace(db: GraphDb, workspaceId: string) {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) {
    throw new GraphInvariantError("Workspace does not exist");
  }
  return workspace;
}

function normalizedEntityName(type: ObservedEntityType, surfaceForm: string): string {
  if (type === "PERSON") return normalizePersonName(surfaceForm);
  if (type === "COMPANY") return normalizeCompanyName(surfaceForm);
  return normalizeSurfaceForm(surfaceForm);
}

export async function createWorkspace(
  db: GraphDb,
  input: { name: string }
) {
  const { createWorkspace: create } = await import("./workspace");
  return create(db, input);
}

export function createPerson(
  db: GraphDb,
  input: Parameters<typeof insertPerson>[1]
): Promise<Person> {
  return inTransaction(db, (tx) => insertPerson(tx, input));
}

async function insertPerson(
  db: GraphDb,
  input: {
    workspaceId: string;
    canonicalName: string;
    firstName?: string | null;
    middleName?: string | null;
    lastName?: string | null;
    primaryTitle?: string | null;
    aliases?: string[];
    identifiers?: { kind: PersonIdentifierKind; value: string }[];
  }
): Promise<Person> {
  await requireWorkspace(db, input.workspaceId);
  const canonicalName = assertNonEmpty(input.canonicalName, "canonicalName");
  const person = await db.person.create({
    data: {
      workspaceId: input.workspaceId,
      canonicalName,
      firstName: input.firstName ?? null,
      middleName: input.middleName ?? null,
      lastName: input.lastName ?? null,
      primaryTitle: input.primaryTitle ?? null,
    },
  });
  for (const alias of input.aliases ?? []) {
    await addPersonAlias(db, {
      workspaceId: input.workspaceId,
      personId: person.id,
      alias,
    });
  }
  for (const identifier of input.identifiers ?? []) {
    await addPersonIdentifier(db, {
      workspaceId: input.workspaceId,
      personId: person.id,
      kind: identifier.kind,
      value: identifier.value,
    });
  }
  return person;
}

export async function addPersonAlias(
  db: GraphDb,
  input: { workspaceId: string; personId: string; alias: string }
) {
  const person = await db.person.findUnique({ where: { id: input.personId } });
  if (!person) throw new GraphInvariantError("Person does not exist");
  assertWorkspaceMatch(input.workspaceId, person.workspaceId, "Person");
  const alias = assertNonEmpty(input.alias, "alias");
  return db.personAlias.create({
    data: {
      workspaceId: input.workspaceId,
      personId: person.id,
      alias,
      normalizedAlias: normalizePersonName(alias),
    },
  });
}

export async function addPersonIdentifier(
  db: GraphDb,
  input: {
    workspaceId: string;
    personId: string;
    kind: PersonIdentifierKind;
    value: string;
  }
) {
  const person = await db.person.findUnique({ where: { id: input.personId } });
  if (!person) throw new GraphInvariantError("Person does not exist");
  assertWorkspaceMatch(input.workspaceId, person.workspaceId, "Person");
  const value = assertNonEmpty(input.value, "identifier");
  const normalizedValue =
    input.kind === "EMAIL"
      ? normalizeEmail(value)
      : input.kind === "PHONE"
        ? normalizePhone(value)
        : normalizeSurfaceForm(value);
  if (!normalizedValue) {
    throw new GraphInvariantError("identifier normalizes to an empty value");
  }
  try {
    return await db.personIdentifier.create({
      data: {
        workspaceId: input.workspaceId,
        personId: person.id,
        kind: input.kind,
        value,
        normalizedValue,
      },
    });
  } catch (error) {
    rethrowUnique(
      error,
      "That identifier already belongs to a person in this workspace"
    );
  }
}

export function createCompany(
  db: GraphDb,
  input: Parameters<typeof insertCompany>[1]
): Promise<Company> {
  return inTransaction(db, (tx) => insertCompany(tx, input));
}

async function insertCompany(
  db: GraphDb,
  input: {
    workspaceId: string;
    canonicalName: string;
    legalName?: string | null;
    website?: string | null;
    primaryDomain?: string | null;
    aliases?: string[];
    identifiers?: { kind: CompanyIdentifierKind; value: string }[];
  }
): Promise<Company> {
  await requireWorkspace(db, input.workspaceId);
  const canonicalName = assertNonEmpty(input.canonicalName, "canonicalName");
  const primaryDomain = input.primaryDomain
    ? normalizeDomain(input.primaryDomain)
    : null;
  const company = await db.company.create({
    data: {
      workspaceId: input.workspaceId,
      canonicalName,
      legalName: input.legalName ?? null,
      website: input.website ?? null,
      primaryDomain,
    },
  });
  for (const alias of input.aliases ?? []) {
    await addCompanyAlias(db, {
      workspaceId: input.workspaceId,
      companyId: company.id,
      alias,
    });
  }
  if (primaryDomain) {
    await addCompanyIdentifier(db, {
      workspaceId: input.workspaceId,
      companyId: company.id,
      kind: "DOMAIN",
      value: primaryDomain,
    });
  }
  for (const identifier of (input.identifiers ?? []).filter((identifier) => {
    if (!primaryDomain || identifier.kind !== "DOMAIN") return true;
    return normalizeDomain(identifier.value) !== primaryDomain;
  })) {
    await addCompanyIdentifier(db, {
      workspaceId: input.workspaceId,
      companyId: company.id,
      kind: identifier.kind,
      value: identifier.value,
    });
  }
  return db.company.findUniqueOrThrow({ where: { id: company.id } });
}

export async function addCompanyAlias(
  db: GraphDb,
  input: { workspaceId: string; companyId: string; alias: string }
) {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) throw new GraphInvariantError("Company does not exist");
  assertWorkspaceMatch(input.workspaceId, company.workspaceId, "Company");
  const alias = assertNonEmpty(input.alias, "alias");
  return db.companyAlias.create({
    data: {
      workspaceId: input.workspaceId,
      companyId: company.id,
      alias,
      normalizedAlias: normalizeCompanyName(alias),
    },
  });
}

export async function addCompanyIdentifier(
  db: GraphDb,
  input: {
    workspaceId: string;
    companyId: string;
    kind: CompanyIdentifierKind;
    value: string;
  }
) {
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company) throw new GraphInvariantError("Company does not exist");
  assertWorkspaceMatch(input.workspaceId, company.workspaceId, "Company");
  const value = assertNonEmpty(input.value, "identifier");
  const normalizedValue =
    input.kind === "DOMAIN" || input.kind === "EMAIL_DOMAIN"
      ? normalizeDomain(value)
      : normalizeSurfaceForm(value);
  if (!normalizedValue) {
    throw new GraphInvariantError("identifier normalizes to an empty value");
  }
  try {
    const identifier = await db.companyIdentifier.create({
      data: {
        workspaceId: input.workspaceId,
        companyId: company.id,
        kind: input.kind,
        value,
        normalizedValue,
      },
    });
    if (input.kind === "DOMAIN" && !company.primaryDomain) {
      await db.company.update({
        where: { id: company.id },
        data: { primaryDomain: normalizedValue },
      });
    }
    return identifier;
  } catch (error) {
    rethrowUnique(
      error,
      "That identifier already belongs to a company in this workspace"
    );
  }
}

export function createProperty(
  db: GraphDb,
  input: Parameters<typeof insertProperty>[1]
): Promise<Property> {
  return inTransaction(db, (tx) => insertProperty(tx, input));
}

async function insertProperty(
  db: GraphDb,
  input: {
    workspaceId: string;
    canonicalName: string;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
    assetType?: AssetType;
    aliases?: string[];
    externalIdentifiers?: { scheme: string; value: string }[];
  }
): Promise<Property> {
  await requireWorkspace(db, input.workspaceId);
  const property = await db.property.create({
    data: {
      workspaceId: input.workspaceId,
      canonicalName: assertNonEmpty(input.canonicalName, "canonicalName"),
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? null,
      assetType: input.assetType ?? "UNKNOWN",
    },
  });
  for (const alias of input.aliases ?? []) {
    await addPropertyAlias(db, {
      workspaceId: input.workspaceId,
      propertyId: property.id,
      alias,
    });
  }
  for (const identifier of input.externalIdentifiers ?? []) {
    await addExternalIdentifier(db, {
      workspaceId: input.workspaceId,
      scheme: identifier.scheme,
      value: identifier.value,
      propertyId: property.id,
    });
  }
  return property;
}

export async function addPropertyAlias(
  db: GraphDb,
  input: { workspaceId: string; propertyId: string; alias: string }
) {
  const property = await db.property.findUnique({ where: { id: input.propertyId } });
  if (!property) throw new GraphInvariantError("Property does not exist");
  assertWorkspaceMatch(input.workspaceId, property.workspaceId, "Property");
  const alias = assertNonEmpty(input.alias, "alias");
  return db.propertyAlias.create({
    data: {
      workspaceId: input.workspaceId,
      propertyId: property.id,
      alias,
      normalizedAlias: normalizeSurfaceForm(alias),
    },
  });
}

export async function addExternalIdentifier(
  db: GraphDb,
  input: {
    workspaceId: string;
    scheme: string;
    value: string;
    personId?: string | null;
    companyId?: string | null;
    propertyId?: string | null;
  }
) {
  await requireWorkspace(db, input.workspaceId);
  assertExactlyOneExternalTarget(input);
  const scheme = assertNonEmpty(input.scheme, "scheme");
  const value = assertNonEmpty(input.value, "value");
  if (input.personId) {
    const person = await db.person.findUnique({ where: { id: input.personId } });
    if (!person) throw new GraphInvariantError("Person does not exist");
    assertWorkspaceMatch(input.workspaceId, person.workspaceId, "Person");
  }
  if (input.companyId) {
    const company = await db.company.findUnique({ where: { id: input.companyId } });
    if (!company) throw new GraphInvariantError("Company does not exist");
    assertWorkspaceMatch(input.workspaceId, company.workspaceId, "Company");
  }
  if (input.propertyId) {
    const property = await db.property.findUnique({ where: { id: input.propertyId } });
    if (!property) throw new GraphInvariantError("Property does not exist");
    assertWorkspaceMatch(input.workspaceId, property.workspaceId, "Property");
  }
  try {
    return await db.externalIdentifier.create({
      data: {
        workspaceId: input.workspaceId,
        scheme,
        value,
        personId: input.personId ?? null,
        companyId: input.companyId ?? null,
        propertyId: input.propertyId ?? null,
      },
    });
  } catch (error) {
    rethrowUnique(
      error,
      "That external identifier already exists in this workspace"
    );
  }
}

type ObservationWrite = {
  workspaceId: string;
  sourceKind: ObservationSourceKind;
  dealId?: string | null;
  documentId?: string | null;
  messageId?: string | null;
  evidenceQuote: string;
  sourceLocation?: string | null;
  extractionConfidence?: number | null;
  extractor: string;
  extractorVersion: string;
};

async function resolveObservationSource(
  db: GraphDb,
  input: ObservationWrite
): Promise<{
  dealId: string | null;
  documentId: string | null;
  documentPageId: string | null;
  messageId: string | null;
  evidenceQuote: string;
  evidenceStartOffset: number | null;
  evidenceEndOffset: number | null;
  provenanceStatus: EvidenceProvenanceStatus | null;
  sourceLocation: string | null;
}> {
  assertConfidence(input.extractionConfidence);
  assertNonEmpty(input.extractor, "extractor");
  assertNonEmpty(input.extractorVersion, "extractorVersion");
  const quote = assertNonEmpty(input.evidenceQuote, "evidenceQuote");

  if (input.sourceKind === "MANUAL") {
    if (input.dealId) {
      const deal = await db.deal.findUnique({ where: { id: input.dealId } });
      if (!deal) throw new GraphInvariantError("Deal does not exist");
      assertWorkspaceMatch(input.workspaceId, deal.workspaceId, "Deal");
    }
    return {
      dealId: input.dealId ?? null,
      documentId: null,
      documentPageId: null,
      messageId: null,
      evidenceQuote: quote,
      evidenceStartOffset: null,
      evidenceEndOffset: null,
      provenanceStatus: null,
      sourceLocation: input.sourceLocation?.trim() || null,
    };
  }

  if (input.sourceKind === "MESSAGE") {
    if (!input.messageId || !input.dealId) {
      throw new GraphInvariantError(
        "MESSAGE observations require messageId and dealId"
      );
    }
    const message = await db.message.findUnique({
      where: { id: input.messageId },
      include: { thread: { include: { deal: true } } },
    });
    if (!message) throw new GraphInvariantError("Message does not exist");
    if (message.thread.dealId !== input.dealId) {
      throw new GraphInvariantError("Message does not belong to the given deal");
    }
    assertWorkspaceMatch(
      input.workspaceId,
      message.thread.deal.workspaceId,
      "Deal"
    );
    const start = message.body.indexOf(quote);
    if (start < 0) {
      throw new GraphInvariantError(
        "Message evidence quote is not a substring of the message body"
      );
    }
    return {
      dealId: input.dealId,
      documentId: null,
      documentPageId: null,
      messageId: message.id,
      evidenceQuote: quote,
      evidenceStartOffset: start,
      evidenceEndOffset: start + quote.length,
      provenanceStatus: null,
      sourceLocation: input.sourceLocation?.trim() || null,
    };
  }

  if (!input.documentId || !input.dealId) {
    throw new GraphInvariantError(
      "DOCUMENT_PAGE observations require documentId and dealId"
    );
  }
  const document = await db.document.findUnique({
    where: { id: input.documentId },
    include: { pages: true, deal: true },
  });
  if (!document) throw new GraphInvariantError("Document does not exist");
  if (document.dealId !== input.dealId) {
    throw new GraphInvariantError("Document does not belong to the given deal");
  }
  assertWorkspaceMatch(input.workspaceId, document.deal.workspaceId, "Deal");
  const located = locateEvidence({
    evidenceQuote: quote,
    pages: document.pages,
  });
  if (located.status === "EXACT") {
    if (!located.pageId) {
      throw new GraphInvariantError("EXACT evidence requires a stored page id");
    }
    return {
      dealId: input.dealId,
      documentId: document.id,
      documentPageId: located.pageId,
      messageId: null,
      evidenceQuote: quote.trim(),
      evidenceStartOffset: located.startOffset,
      evidenceEndOffset: located.endOffset,
      provenanceStatus: "EXACT",
      sourceLocation: input.sourceLocation?.trim() || null,
    };
  }
  return {
    dealId: input.dealId,
    documentId: document.id,
    documentPageId: null,
    messageId: null,
    evidenceQuote: quote.trim(),
    evidenceStartOffset: null,
    evidenceEndOffset: null,
    provenanceStatus: located.status,
    sourceLocation: input.sourceLocation?.trim() || null,
  };
}

export async function recordEntityObservation(
  db: GraphDb,
  input: ObservationWrite & {
    observedType: ObservedEntityType;
    surfaceForm: string;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
    domain?: string | null;
    addressLine1?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
    rawAttributes?: Prisma.InputJsonValue | null;
  }
): Promise<EntityObservation> {
  await requireWorkspace(db, input.workspaceId);
  const surfaceForm = assertNonEmpty(input.surfaceForm, "surfaceForm");
  assertObservationAttributes(input);
  const source = await resolveObservationSource(db, input);
  assertProvenanceShape({ ...source, sourceKind: input.sourceKind });
  return db.entityObservation.create({
    data: {
      workspaceId: input.workspaceId,
      observedType: input.observedType,
      surfaceForm,
      normalizedName: normalizedEntityName(input.observedType, surfaceForm),
      title: input.title?.trim() || null,
      email: input.email ? normalizeEmail(input.email) : null,
      phone: input.phone ? normalizePhone(input.phone) : null,
      domain: input.domain ? normalizeDomain(input.domain) : null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      region: input.region ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? null,
      rawAttributes: input.rawAttributes ?? undefined,
      sourceKind: input.sourceKind,
      ...source,
      extractionConfidence: input.extractionConfidence ?? null,
      extractor: input.extractor.trim(),
      extractorVersion: input.extractorVersion.trim(),
    },
  });
}

export async function recordRelationshipObservation(
  db: GraphDb,
  input: ObservationWrite & {
    predicate: RelationshipPredicate;
    subjectObservationId: string;
    objectObservationId?: string | null;
    participationRole?: ParticipationRole | null;
    roleLabel?: string | null;
    affiliationKind?: AffiliationKind | null;
    principalObservationId?: string | null;
    contextDealId?: string | null;
    statedValidFrom?: Date | null;
    statedValidTo?: Date | null;
    statedTitle?: string | null;
  }
): Promise<RelationshipObservation> {
  await requireWorkspace(db, input.workspaceId);
  const subject = await db.entityObservation.findUnique({
    where: { id: input.subjectObservationId },
  });
  if (!subject) throw new GraphInvariantError("Subject observation does not exist");
  assertWorkspaceMatch(input.workspaceId, subject.workspaceId, "Subject observation");
  const object = input.objectObservationId
    ? await db.entityObservation.findUnique({
        where: { id: input.objectObservationId },
      })
    : null;
  if (input.objectObservationId && !object) {
    throw new GraphInvariantError("Object observation does not exist");
  }
  if (object) {
    assertWorkspaceMatch(input.workspaceId, object.workspaceId, "Object observation");
  }
  const principal = input.principalObservationId
    ? await db.entityObservation.findUnique({
        where: { id: input.principalObservationId },
      })
    : null;
  if (input.principalObservationId && !principal) {
    throw new GraphInvariantError("Principal observation does not exist");
  }
  if (principal) {
    assertWorkspaceMatch(
      input.workspaceId,
      principal.workspaceId,
      "Principal observation"
    );
  }
  if (input.contextDealId) {
    const deal = await db.deal.findUnique({ where: { id: input.contextDealId } });
    if (!deal) throw new GraphInvariantError("Context deal does not exist");
    assertWorkspaceMatch(input.workspaceId, deal.workspaceId, "Deal");
  }
  assertValidInterval(input.statedValidFrom, input.statedValidTo);
  assertRelationshipShape({
    predicate: input.predicate,
    subjectType: subject.observedType,
    objectType: object?.observedType ?? null,
    participationRole: input.participationRole,
    roleLabel: input.roleLabel,
    affiliationKind: input.affiliationKind,
    contextDealId: input.contextDealId,
    principalType: principal?.observedType ?? null,
  });
  const source = await resolveObservationSource(db, input);
  assertProvenanceShape({ ...source, sourceKind: input.sourceKind });
  return db.relationshipObservation.create({
    data: {
      workspaceId: input.workspaceId,
      predicate: input.predicate,
      subjectObservationId: subject.id,
      objectObservationId: object?.id ?? null,
      participationRole: input.participationRole ?? null,
      roleLabel: input.roleLabel?.trim() || null,
      affiliationKind: input.affiliationKind ?? null,
      principalObservationId: principal?.id ?? null,
      contextDealId: input.contextDealId ?? null,
      statedValidFrom: input.statedValidFrom ?? null,
      statedValidTo: input.statedValidTo ?? null,
      statedTitle: input.statedTitle?.trim() || null,
      sourceKind: input.sourceKind,
      ...source,
      extractionConfidence: input.extractionConfidence ?? null,
      extractor: input.extractor.trim(),
      extractorVersion: input.extractorVersion.trim(),
    },
  });
}

export async function recordObservationDisposition(
  db: GraphDb,
  input: {
    entityObservationId?: string | null;
    relationshipObservationId?: string | null;
    disposition: ObservationDispositionValue;
    actor: DispositionActor;
    note?: string | null;
  }
) {
  assertExactlyOneObservationSide(input);
  if (input.entityObservationId) {
    const observation = await db.entityObservation.findUnique({
      where: { id: input.entityObservationId },
    });
    if (!observation) throw new GraphInvariantError("Entity observation does not exist");
  }
  if (input.relationshipObservationId) {
    const observation = await db.relationshipObservation.findUnique({
      where: { id: input.relationshipObservationId },
    });
    if (!observation) {
      throw new GraphInvariantError("Relationship observation does not exist");
    }
  }
  return db.observationDisposition.create({
    data: {
      entityObservationId: input.entityObservationId ?? null,
      relationshipObservationId: input.relationshipObservationId ?? null,
      disposition: input.disposition,
      actor: input.actor,
      note: input.note ?? null,
    },
  });
}

async function assertOpenEmploymentAvailable(
  db: GraphDb,
  input: {
    workspaceId: string;
    personId: string;
    companyId: string;
    affiliationKind: AffiliationKind;
  }
) {
  const existing = await db.employment.findFirst({
    where: {
      workspaceId: input.workspaceId,
      personId: input.personId,
      companyId: input.companyId,
      affiliationKind: input.affiliationKind,
      status: "ASSERTED",
    },
  });
  if (existing) {
    throw new GraphInvariantError(
      "An open employment already exists for this person, company, and affiliation"
    );
  }
}

export async function createEmployment(
  db: GraphDb,
  input: AssertionClock & {
    workspaceId: string;
    personId: string;
    companyId: string;
    affiliationKind?: AffiliationKind;
    titleAtTime?: string | null;
  }
): Promise<Employment> {
  await requireWorkspace(db, input.workspaceId);
  const person = await db.person.findUnique({ where: { id: input.personId } });
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!person) throw new GraphInvariantError("Person does not exist");
  if (!company) throw new GraphInvariantError("Company does not exist");
  assertWorkspaceMatch(input.workspaceId, person.workspaceId, "Person");
  assertWorkspaceMatch(input.workspaceId, company.workspaceId, "Company");
  assertValidInterval(input.validFrom, input.validTo);
  const affiliationKind = input.affiliationKind ?? "UNKNOWN";
  await assertOpenEmploymentAvailable(db, {
    workspaceId: input.workspaceId,
    personId: person.id,
    companyId: company.id,
    affiliationKind,
  });
  try {
    return await db.employment.create({
      data: {
        workspaceId: input.workspaceId,
        personId: person.id,
        companyId: company.id,
        affiliationKind,
        titleAtTime: input.titleAtTime ?? null,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        validFromPrecision: input.validFromPrecision ?? "UNKNOWN",
        validToPrecision: input.validToPrecision ?? "UNKNOWN",
        assertionSource: input.assertionSource,
      },
    });
  } catch (error) {
    rethrowUnique(
      error,
      "An open employment already exists for this person, company, and affiliation"
    );
  }
}

export async function retireEmployment(
  db: GraphDb,
  input: { workspaceId: string; employmentId: string; validTo?: Date | null }
): Promise<Employment> {
  const employment = await db.employment.findUnique({
    where: { id: input.employmentId },
  });
  if (!employment) throw new GraphInvariantError("Employment does not exist");
  assertWorkspaceMatch(input.workspaceId, employment.workspaceId, "Employment");
  assertValidInterval(employment.validFrom, input.validTo ?? employment.validTo);
  return db.employment.update({
    where: { id: employment.id },
    data: {
      status: "RETIRED",
      validTo: input.validTo === undefined ? employment.validTo : input.validTo,
    },
  });
}

export async function createPropertyStake(
  db: GraphDb,
  input: AssertionClock & {
    workspaceId: string;
    companyId: string;
    propertyId: string;
    predicate: PropertyStakePredicate;
  }
): Promise<PropertyStake> {
  await requireWorkspace(db, input.workspaceId);
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  const property = await db.property.findUnique({ where: { id: input.propertyId } });
  if (!company) throw new GraphInvariantError("Company does not exist");
  if (!property) throw new GraphInvariantError("Property does not exist");
  assertWorkspaceMatch(input.workspaceId, company.workspaceId, "Company");
  assertWorkspaceMatch(input.workspaceId, property.workspaceId, "Property");
  assertValidInterval(input.validFrom, input.validTo);
  const existing = await db.propertyStake.findFirst({
    where: {
      workspaceId: input.workspaceId,
      companyId: company.id,
      propertyId: property.id,
      predicate: input.predicate,
      status: "ASSERTED",
    },
  });
  if (existing) {
    throw new GraphInvariantError(
      "An open property stake already exists for this company, property, and predicate"
    );
  }
  try {
    return await db.propertyStake.create({
      data: {
        workspaceId: input.workspaceId,
        companyId: company.id,
        propertyId: property.id,
        predicate: input.predicate,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        validFromPrecision: input.validFromPrecision ?? "UNKNOWN",
        validToPrecision: input.validToPrecision ?? "UNKNOWN",
        assertionSource: input.assertionSource,
      },
    });
  } catch (error) {
    rethrowUnique(
      error,
      "An open property stake already exists for this company, property, and predicate"
    );
  }
}

export async function linkDealProperty(
  db: GraphDb,
  input: { workspaceId: string; dealId: string; propertyId: string }
): Promise<Deal> {
  const deal = await db.deal.findUnique({ where: { id: input.dealId } });
  const property = await db.property.findUnique({ where: { id: input.propertyId } });
  if (!deal) throw new GraphInvariantError("Deal does not exist");
  if (!property) throw new GraphInvariantError("Property does not exist");
  assertWorkspaceMatch(input.workspaceId, deal.workspaceId, "Deal");
  assertWorkspaceMatch(input.workspaceId, property.workspaceId, "Property");
  return db.deal.update({
    where: { id: deal.id },
    data: { propertyId: property.id },
  });
}

export async function createDealParticipation(
  db: GraphDb,
  input: AssertionClock & {
    workspaceId: string;
    dealId: string;
    role: ParticipationRole;
    roleLabel?: string | null;
    personId?: string | null;
    companyId?: string | null;
    representsCompanyId?: string | null;
  }
): Promise<DealParticipation> {
  await requireWorkspace(db, input.workspaceId);
  assertParticipationActor(input);
  assertValidInterval(input.validFrom, input.validTo);
  const deal = await db.deal.findUnique({ where: { id: input.dealId } });
  if (!deal) throw new GraphInvariantError("Deal does not exist");
  assertWorkspaceMatch(input.workspaceId, deal.workspaceId, "Deal");
  if (input.personId) {
    const person = await db.person.findUnique({ where: { id: input.personId } });
    if (!person) throw new GraphInvariantError("Person does not exist");
    assertWorkspaceMatch(input.workspaceId, person.workspaceId, "Person");
  }
  if (input.companyId) {
    const company = await db.company.findUnique({ where: { id: input.companyId } });
    if (!company) throw new GraphInvariantError("Company does not exist");
    assertWorkspaceMatch(input.workspaceId, company.workspaceId, "Company");
  }
  if (input.representsCompanyId) {
    const principal = await db.company.findUnique({
      where: { id: input.representsCompanyId },
    });
    if (!principal) throw new GraphInvariantError("Represented company does not exist");
    assertWorkspaceMatch(input.workspaceId, principal.workspaceId, "Company");
  }
  const openWhere = {
    dealId: deal.id,
    role: input.role,
    status: "ASSERTED" as const,
    ...(input.personId
      ? { personId: input.personId }
      : { companyId: input.companyId }),
  };
  const existing = await db.dealParticipation.findFirst({ where: openWhere });
  if (existing) {
    throw new GraphInvariantError(
      "An open participation already exists for this actor, deal, and role"
    );
  }
  try {
    return await db.dealParticipation.create({
      data: {
        workspaceId: input.workspaceId,
        dealId: deal.id,
        role: input.role,
        roleLabel: input.roleLabel?.trim() || null,
        personId: input.personId ?? null,
        companyId: input.companyId ?? null,
        representsCompanyId: input.representsCompanyId ?? null,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        validFromPrecision: input.validFromPrecision ?? "UNKNOWN",
        validToPrecision: input.validToPrecision ?? "UNKNOWN",
        assertionSource: input.assertionSource,
      },
    });
  } catch (error) {
    rethrowUnique(
      error,
      "An open participation already exists for this actor, deal, and role"
    );
  }
}

export async function attachObservationSupport(
  db: GraphDb,
  input: {
    workspaceId: string;
    relationshipObservationId: string;
    employmentId?: string | null;
    propertyStakeId?: string | null;
    dealParticipationId?: string | null;
  }
) {
  const targets = [
    input.employmentId,
    input.propertyStakeId,
    input.dealParticipationId,
  ].filter(Boolean);
  if (targets.length !== 1) {
    throw new GraphInvariantError("Support attaches to exactly one canonical assertion");
  }
  const observation = await db.relationshipObservation.findUnique({
    where: { id: input.relationshipObservationId },
  });
  if (!observation) {
    throw new GraphInvariantError("Relationship observation does not exist");
  }
  assertWorkspaceMatch(
    input.workspaceId,
    observation.workspaceId,
    "Relationship observation"
  );

  if (input.employmentId) {
    const employment = await db.employment.findUnique({
      where: { id: input.employmentId },
    });
    if (!employment) throw new GraphInvariantError("Employment does not exist");
    assertWorkspaceMatch(input.workspaceId, employment.workspaceId, "Employment");
    if (observation.predicate !== "WORKS_AT") {
      throw new GraphInvariantError("Employment support requires a WORKS_AT observation");
    }
    return db.employmentSupport.create({
      data: {
        employmentId: employment.id,
        relationshipObservationId: observation.id,
      },
    });
  }

  if (input.propertyStakeId) {
    const stake = await db.propertyStake.findUnique({
      where: { id: input.propertyStakeId },
    });
    if (!stake) throw new GraphInvariantError("Property stake does not exist");
    assertWorkspaceMatch(input.workspaceId, stake.workspaceId, "Property stake");
    if (observation.predicate !== stake.predicate) {
      throw new GraphInvariantError(
        "Property stake support must use the same predicate as the stake"
      );
    }
    return db.propertyStakeSupport.create({
      data: {
        propertyStakeId: stake.id,
        relationshipObservationId: observation.id,
      },
    });
  }

  const participation = await db.dealParticipation.findUnique({
    where: { id: input.dealParticipationId! },
  });
  if (!participation) throw new GraphInvariantError("Deal participation does not exist");
  assertWorkspaceMatch(input.workspaceId, participation.workspaceId, "Deal participation");
  if (observation.predicate !== "PARTICIPATES_AS") {
    throw new GraphInvariantError(
      "Deal participation support requires a PARTICIPATES_AS observation"
    );
  }
  if (
    observation.participationRole &&
    observation.participationRole !== participation.role
  ) {
    throw new GraphInvariantError(
      "Participation support role does not match the canonical role"
    );
  }
  return db.dealParticipationSupport.create({
    data: {
      dealParticipationId: participation.id,
      relationshipObservationId: observation.id,
    },
  });
}

const asserted = { status: "ASSERTED" as const };

export async function getEntityRelationships(
  db: GraphDb,
  input: {
    workspaceId: string;
    entityType: "PERSON" | "COMPANY" | "PROPERTY" | "DEAL";
    entityId: string;
    asOf?: Date;
  }
) {
  const asOf = input.asOf;
  const keep = <T extends { status: "ASSERTED" | "RETIRED"; validFrom: Date | null; validTo: Date | null }>(
    rows: T[]
  ) => (asOf ? rows.filter((row) => matchesAsOf(row, asOf)) : rows.filter((row) => row.status === "ASSERTED"));

  if (input.entityType === "PERSON") {
    const person = await db.person.findUnique({ where: { id: input.entityId } });
    if (!person) throw new GraphInvariantError("Person does not exist");
    assertWorkspaceMatch(input.workspaceId, person.workspaceId, "Person");
    const [employments, participations] = await Promise.all([
      db.employment.findMany({
        where: { workspaceId: input.workspaceId, personId: person.id, ...asserted },
      }),
      db.dealParticipation.findMany({
        where: { workspaceId: input.workspaceId, personId: person.id, ...asserted },
      }),
    ]);
    return {
      employments: keep(employments),
      propertyStakes: [],
      participations: keep(participations),
      concernsDeals: [],
    };
  }

  if (input.entityType === "COMPANY") {
    const company = await db.company.findUnique({ where: { id: input.entityId } });
    if (!company) throw new GraphInvariantError("Company does not exist");
    assertWorkspaceMatch(input.workspaceId, company.workspaceId, "Company");
    const [employments, propertyStakes, participations] = await Promise.all([
      db.employment.findMany({
        where: { workspaceId: input.workspaceId, companyId: company.id, ...asserted },
      }),
      db.propertyStake.findMany({
        where: { workspaceId: input.workspaceId, companyId: company.id, ...asserted },
      }),
      db.dealParticipation.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...asserted,
          OR: [{ companyId: company.id }, { representsCompanyId: company.id }],
        },
      }),
    ]);
    return {
      employments: keep(employments),
      propertyStakes: keep(propertyStakes),
      participations: keep(participations),
      concernsDeals: [],
    };
  }

  if (input.entityType === "PROPERTY") {
    const property = await db.property.findUnique({ where: { id: input.entityId } });
    if (!property) throw new GraphInvariantError("Property does not exist");
    assertWorkspaceMatch(input.workspaceId, property.workspaceId, "Property");
    const [propertyStakes, concernsDeals] = await Promise.all([
      db.propertyStake.findMany({
        where: { workspaceId: input.workspaceId, propertyId: property.id, ...asserted },
      }),
      db.deal.findMany({
        where: { workspaceId: input.workspaceId, propertyId: property.id },
      }),
    ]);
    return {
      employments: [],
      propertyStakes: keep(propertyStakes),
      participations: [],
      concernsDeals,
    };
  }

  const deal = await db.deal.findUnique({ where: { id: input.entityId } });
  if (!deal) throw new GraphInvariantError("Deal does not exist");
  assertWorkspaceMatch(input.workspaceId, deal.workspaceId, "Deal");
  const participations = await db.dealParticipation.findMany({
    where: { workspaceId: input.workspaceId, dealId: deal.id, ...asserted },
  });
  return {
    employments: [],
    propertyStakes: [],
    participations: keep(participations),
    concernsDeals: deal.propertyId ? [deal] : [],
  };
}

export async function getRelationshipEvidence(
  db: GraphDb,
  input: {
    workspaceId: string;
    assertionType: "EMPLOYMENT" | "PROPERTY_STAKE" | "DEAL_PARTICIPATION";
    assertionId: string;
  }
) {
  const load = async (observationIds: { id: string; relationshipObservationId: string }[]) => {
    const observations = await db.relationshipObservation.findMany({
      where: {
        id: { in: observationIds.map((row) => row.relationshipObservationId) },
        workspaceId: input.workspaceId,
      },
      include: {
        documentPage: {
          include: { document: true },
        },
      },
    });
    const byId = new Map(observations.map((row) => [row.id, row]));
    return observationIds.map((support) => {
      const observation = byId.get(support.relationshipObservationId);
      if (!observation) {
        throw new GraphInvariantError("Support observation is outside this workspace");
      }
      return {
        supportId: support.id,
        observation,
        documentPage: observation.documentPage,
        document: observation.documentPage?.document ?? null,
      };
    });
  };

  if (input.assertionType === "EMPLOYMENT") {
    const employment = await db.employment.findUnique({
      where: { id: input.assertionId },
      include: { supports: true },
    });
    if (!employment) throw new GraphInvariantError("Employment does not exist");
    assertWorkspaceMatch(input.workspaceId, employment.workspaceId, "Employment");
    return load(employment.supports);
  }
  if (input.assertionType === "PROPERTY_STAKE") {
    const stake = await db.propertyStake.findUnique({
      where: { id: input.assertionId },
      include: { supports: true },
    });
    if (!stake) throw new GraphInvariantError("Property stake does not exist");
    assertWorkspaceMatch(input.workspaceId, stake.workspaceId, "Property stake");
    return load(stake.supports);
  }
  const participation = await db.dealParticipation.findUnique({
    where: { id: input.assertionId },
    include: { supports: true },
  });
  if (!participation) throw new GraphInvariantError("Deal participation does not exist");
  assertWorkspaceMatch(input.workspaceId, participation.workspaceId, "Deal participation");
  return load(participation.supports);
}

export async function getDealParticipants(
  db: GraphDb,
  input: { workspaceId: string; dealId: string; asOf?: Date }
) {
  const deal = await db.deal.findUnique({ where: { id: input.dealId } });
  if (!deal) throw new GraphInvariantError("Deal does not exist");
  assertWorkspaceMatch(input.workspaceId, deal.workspaceId, "Deal");
  const rows = await db.dealParticipation.findMany({
    where: { workspaceId: input.workspaceId, dealId: deal.id, status: "ASSERTED" },
    orderBy: { createdAt: "asc" },
  });
  return input.asOf ? rows.filter((row) => matchesAsOf(row, input.asOf!)) : rows;
}

export async function documentGraphReferenceCount(
  db: GraphDb,
  documentId: string
): Promise<number> {
  const [entities, relationships, entityPages, relationshipPages] = await Promise.all([
    db.entityObservation.count({ where: { documentId } }),
    db.relationshipObservation.count({ where: { documentId } }),
    db.entityObservation.count({ where: { documentPage: { documentId } } }),
    db.relationshipObservation.count({ where: { documentPage: { documentId } } }),
  ]);
  return entities + relationships + entityPages + relationshipPages;
}

export async function deleteDocumentPreservingEvidence(
  db: PrismaClient,
  documentId: string
) {
  const count = await documentGraphReferenceCount(db, documentId);
  if (evidenceDeletionRefused(count)) {
    throw new GraphInvariantError(
      "Document is referenced by graph observations and cannot be deleted"
    );
  }
  return db.document.delete({ where: { id: documentId } });
}
