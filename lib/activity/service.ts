import type { Prisma } from "@prisma/client";
import { linksByActivityEventId } from "@/lib/deals/reconciliation/reconcile";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";
import type { GraphDb } from "@/lib/entities/workspace";
import { activitySideLabel, canonicalLabel, storedFactValue } from "@/lib/messages/facts";
import { factsFromLatestRun } from "@/lib/messages/latestRun";
import { deriveMessageLifecycle } from "@/lib/messages/state";
import { eventFactsByEventId, linkedLegacyEventIds, loadDealMessageSources, messageActivities, structuredFactsForEvent } from "@/lib/messages/load";
import { canonicalEntityHref } from "@/lib/intelligence/routes";
import { buildDocumentEvent, sentence, type ActivityEvidenceObservation } from "./documents";
import {
  buildCanonicalRelationshipEvent,
  buildEntityObservationEvents,
  buildPendingRelationshipEvents,
} from "./graph";
import { buildNegotiationEvents, type ActivityNegotiationRound } from "./negotiation";
import { decodeActivityCursor, encodeActivityCursor } from "./query";
import type {
  ActivityEntityRef,
  ActivityEvent,
  ActivityFilter,
  ActivityPage,
  ActivityQuery,
  ActivityRootType,
} from "./types";

const evidenceInclude = {
  document: { select: { id: true, originalFilename: true, documentDate: true } },
  documentPage: { select: { id: true, pageNumber: true } },
  message: { select: { sentAt: true } },
} as const;

interface ActivityScope {
  workspaceId: string;
  root: ActivityEntityRef;
  dealIds: string[];
  propertyId: string | null;
  deals: Array<{ id: string; name: string; property: string; canonicalProperty: { id: string; canonicalName: string; workspaceId: string } | null }>;
}

function entityRef(type: ActivityRootType, id: string, name: string): ActivityEntityRef {
  return { id, type, name, href: canonicalEntityHref(type, id) };
}

async function resolveScope(db: GraphDb, rootType: ActivityRootType, rootId: string): Promise<ActivityScope | null> {
  if (rootType === "PERSON") {
    const person = await db.person.findFirst({ where: { id: rootId, status: "ACTIVE", mergedIntoPersonId: null }, select: { id: true, workspaceId: true, canonicalName: true } });
    if (!person) return null;
    const participations = await db.dealParticipation.findMany({
      where: { workspaceId: person.workspaceId, personId: person.id, deal: { workspaceId: person.workspaceId } },
      select: { deal: { select: { id: true, name: true, property: true, canonicalProperty: { select: { id: true, canonicalName: true, workspaceId: true } } } } },
    });
    return { workspaceId: person.workspaceId, root: entityRef("PERSON", person.id, person.canonicalName), dealIds: participations.map((row) => row.deal.id), propertyId: null, deals: participations.map((row) => row.deal) };
  }
  if (rootType === "COMPANY") {
    const company = await db.company.findFirst({ where: { id: rootId, status: "ACTIVE", mergedIntoCompanyId: null }, select: { id: true, workspaceId: true, canonicalName: true } });
    if (!company) return null;
    const participations = await db.dealParticipation.findMany({
      where: { workspaceId: company.workspaceId, deal: { workspaceId: company.workspaceId }, OR: [{ companyId: company.id }, { representsCompanyId: company.id }] },
      select: { deal: { select: { id: true, name: true, property: true, canonicalProperty: { select: { id: true, canonicalName: true, workspaceId: true } } } } },
    });
    return { workspaceId: company.workspaceId, root: entityRef("COMPANY", company.id, company.canonicalName), dealIds: [...new Set(participations.map((row) => row.deal.id))], propertyId: null, deals: [...new Map(participations.map((row) => [row.deal.id, row.deal])).values()] };
  }
  if (rootType === "PROPERTY") {
    const property = await db.property.findFirst({ where: { id: rootId, status: "ACTIVE", mergedIntoPropertyId: null }, select: { id: true, workspaceId: true, canonicalName: true } });
    if (!property) return null;
    const deals = await db.deal.findMany({
      where: { workspaceId: property.workspaceId, propertyId: property.id },
      select: { id: true, name: true, property: true, canonicalProperty: { select: { id: true, canonicalName: true, workspaceId: true } } },
    });
    return { workspaceId: property.workspaceId, root: entityRef("PROPERTY", property.id, property.canonicalName), dealIds: deals.map((deal) => deal.id), propertyId: property.id, deals };
  }
  const deal = await db.deal.findUnique({
    where: { id: rootId },
    select: { id: true, workspaceId: true, name: true, propertyId: true, property: true, canonicalProperty: { select: { id: true, canonicalName: true, workspaceId: true } } },
  });
  if (!deal || (deal.canonicalProperty && deal.canonicalProperty.workspaceId !== deal.workspaceId)) return null;
  return { workspaceId: deal.workspaceId, root: entityRef("DEAL", deal.id, deal.name), dealIds: [deal.id], propertyId: deal.propertyId, deals: [deal] };
}

function dedupeDeals(scope: ActivityScope) {
  return new Map(scope.deals.map((deal) => [deal.id, deal]));
}

function refsForDeal(scope: ActivityScope, dealId: string): ActivityEntityRef[] {
  const deal = dedupeDeals(scope).get(dealId);
  const refs = [scope.root];
  if (deal && !(scope.root.type === "DEAL" && scope.root.id === deal.id)) refs.push(entityRef("DEAL", deal.id, deal.name));
  if (deal?.canonicalProperty && deal.canonicalProperty.workspaceId === scope.workspaceId && !(scope.root.type === "PROPERTY" && scope.root.id === deal.canonicalProperty.id)) {
    refs.push(entityRef("PROPERTY", deal.canonicalProperty.id, deal.canonicalProperty.canonicalName));
  }
  return uniqueRefs(refs);
}

function uniqueRefs(refs: ActivityEntityRef[]): ActivityEntityRef[] {
  return [...new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values()];
}

function supportObservation(row: ActivityEvidenceObservation): ActivityEvidenceObservation {
  return row;
}

function roleText(role: string, custom: string | null): string {
  return custom?.trim() || role.toLowerCase().replaceAll("_", " ");
}

function stakeText(predicate: string): string {
  return predicate.toLowerCase().replaceAll("_", " ");
}

async function loadCanonicalRelationshipEvents(db: GraphDb, scope: ActivityScope): Promise<ActivityEvent[]> {
  const dealSupportWhere = scope.dealIds.length
    ? { OR: [{ dealId: { in: scope.dealIds } }, { contextDealId: { in: scope.dealIds } }] }
    : { id: "__none__" };
  const employmentWhere = scope.root.type === "PERSON"
    ? { personId: scope.root.id }
    : scope.root.type === "COMPANY"
      ? { companyId: scope.root.id }
      : { supports: { some: { relationshipObservation: dealSupportWhere } } };
  const stakeWhere = scope.root.type === "COMPANY"
    ? { companyId: scope.root.id }
    : scope.propertyId
      ? { propertyId: scope.propertyId }
      : { id: "__none__" };
  const participationWhere = scope.root.type === "PERSON"
    ? { personId: scope.root.id }
    : scope.root.type === "COMPANY"
      ? { OR: [{ companyId: scope.root.id }, { representsCompanyId: scope.root.id }] }
      : scope.dealIds.length
        ? { dealId: { in: scope.dealIds } }
        : { id: "__none__" };
  const [employments, stakes, participations, propertyPromotions] = await Promise.all([
    db.employment.findMany({
      where: { workspaceId: scope.workspaceId, ...employmentWhere },
      include: {
        person: true,
        company: true,
        supports: { where: { relationshipObservation: { workspaceId: scope.workspaceId, ...(scope.root.type === "DEAL" || scope.root.type === "PROPERTY" ? dealSupportWhere : {}) } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } },
      },
    }),
    db.propertyStake.findMany({
      where: { workspaceId: scope.workspaceId, ...stakeWhere },
      include: { company: true, property: true, supports: { where: { relationshipObservation: { workspaceId: scope.workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } } },
    }),
    db.dealParticipation.findMany({
      where: { workspaceId: scope.workspaceId, ...participationWhere },
      include: { deal: true, person: true, company: true, represents: true, supports: { where: { relationshipObservation: { workspaceId: scope.workspaceId } }, include: { relationshipObservation: { include: evidenceInclude } }, orderBy: { createdAt: "asc" } } },
    }),
    scope.dealIds.length
      ? db.relationshipPromotion.findMany({
          where: { workspaceId: scope.workspaceId, decision: "APPROVED", linkedDealId: { in: scope.dealIds } },
          include: { linkedDeal: { include: { canonicalProperty: true } }, relationshipObservation: { include: evidenceInclude } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const events: ActivityEvent[] = [];
  for (const row of employments) {
    if (row.person.workspaceId !== scope.workspaceId || row.company.workspaceId !== scope.workspaceId) continue;
    const event = buildCanonicalRelationshipEvent({
      id: row.id,
      eventType: "EMPLOYMENT_EVIDENCE",
      title: `${row.person.canonicalName} ${row.status === "RETIRED" ? "worked at" : "works at"} ${row.company.canonicalName}`,
      description: [row.titleAtTime, row.affiliationKind !== "UNKNOWN" ? sentence(row.affiliationKind) : null].filter(Boolean).join(" · ") || undefined,
      validFrom: row.validFrom,
      validTo: row.validTo,
      createdAt: row.createdAt,
      supports: row.supports.map((support) => supportObservation(support.relationshipObservation)),
      refs: [entityRef("PERSON", row.person.id, row.person.canonicalName), entityRef("COMPANY", row.company.id, row.company.canonicalName)],
    });
    if (event) events.push(event);
  }
  for (const row of stakes) {
    if (row.company.workspaceId !== scope.workspaceId || row.property.workspaceId !== scope.workspaceId) continue;
    const event = buildCanonicalRelationshipEvent({
      id: row.id,
      eventType: "PROPERTY_RELATIONSHIP_EVIDENCE",
      title: `${row.company.canonicalName} ${stakeText(row.predicate)} ${row.property.canonicalName}`,
      validFrom: row.validFrom,
      validTo: row.validTo,
      createdAt: row.createdAt,
      supports: row.supports.map((support) => supportObservation(support.relationshipObservation)),
      refs: [entityRef("COMPANY", row.company.id, row.company.canonicalName), entityRef("PROPERTY", row.property.id, row.property.canonicalName)],
    });
    if (event) events.push(event);
  }
  for (const row of participations) {
    if (row.deal.workspaceId !== scope.workspaceId) continue;
    const actor = row.person
      ? entityRef("PERSON", row.person.id, row.person.canonicalName)
      : row.company
        ? entityRef("COMPANY", row.company.id, row.company.canonicalName)
        : null;
    if (!actor) continue;
    const dealRef = entityRef("DEAL", row.deal.id, row.deal.name);
    const represented = row.represents && row.represents.workspaceId === scope.workspaceId ? entityRef("COMPANY", row.represents.id, row.represents.canonicalName) : null;
    const event = buildCanonicalRelationshipEvent({
      id: row.id,
      eventType: "DEAL_PARTICIPATION",
      title: `${actor.name} participates in ${row.deal.name}`,
      description: `${sentence(roleText(row.role, row.roleLabel))}${represented ? ` · represents ${represented.name}` : ""}`,
      validFrom: row.validFrom,
      validTo: row.validTo,
      createdAt: row.createdAt,
      supports: row.supports.map((support) => supportObservation(support.relationshipObservation)),
      refs: uniqueRefs([actor, dealRef, ...(represented ? [represented] : [])]),
      dealId: row.deal.id,
    });
    if (event) events.push(event);
  }
  const promotionsByDeal = new Map<string, typeof propertyPromotions>();
  for (const row of propertyPromotions) {
    if (!row.linkedDealId) continue;
    const group = promotionsByDeal.get(row.linkedDealId) ?? [];
    group.push(row);
    promotionsByDeal.set(row.linkedDealId, group);
  }
  for (const [dealId, promotions] of promotionsByDeal) {
    const first = promotions[0]!;
    const property = first.linkedDeal?.canonicalProperty;
    const deal = first.linkedDeal;
    if (!deal || !property || deal.workspaceId !== scope.workspaceId || property.workspaceId !== scope.workspaceId) continue;
    const supports = promotions.map((promotion) => supportObservation(promotion.relationshipObservation));
    const event = buildCanonicalRelationshipEvent({
      id: dealId,
      eventType: "PROPERTY_RELATIONSHIP_EVIDENCE",
      title: `${deal.name} concerns ${property.canonicalName}`,
      validFrom: null,
      validTo: null,
      createdAt: first.createdAt,
      supports,
      refs: [entityRef("DEAL", deal.id, deal.name), entityRef("PROPERTY", property.id, property.canonicalName)],
      dealId,
    });
    if (event) events.push(event);
  }
  return events;
}

async function loadObservationEvents(db: GraphDb, scope: ActivityScope): Promise<ActivityEvent[]> {
  if (scope.dealIds.length === 0 && (scope.root.type === "DEAL" || scope.root.type === "PROPERTY")) return [];
  const rootResolution = scope.root.type === "PERSON"
    ? { personId: scope.root.id }
    : scope.root.type === "COMPANY"
      ? { companyId: scope.root.id }
      : scope.root.type === "PROPERTY"
        ? { OR: [{ propertyId: scope.root.id }, { observation: { dealId: { in: scope.dealIds } } }] }
        : { observation: { dealId: { in: scope.dealIds } } };
  const rows = await db.entityObservation.findMany({
    where: {
      workspaceId: scope.workspaceId,
      sourceKind: { not: "MANUAL" },
      dispositions: { none: { disposition: "REJECTED" } },
      ...(scope.root.type === "PERSON" || scope.root.type === "COMPANY"
        ? { resolutionLinks: { some: { status: "ACCEPTED", ...rootResolution } } }
        : { dealId: { in: scope.dealIds } }),
    },
    include: { ...evidenceInclude, resolutionLinks: { where: { status: "ACCEPTED" }, select: { personId: true, companyId: true, propertyId: true } } },
    orderBy: { createdAt: "desc" },
  });
  const normalized = rows.map((row) => ({
    ...row,
    resolutionState: row.resolutionLinks.length ? "CONFIRMED" as const : "PENDING" as const,
  })).filter((row) => scope.root.type === "DEAL" || scope.root.type === "PROPERTY" || row.resolutionState === "CONFIRMED");
  const events = buildEntityObservationEvents(
    normalized,
    (row) => refsForDeal(scope, row.dealId ?? scope.dealIds[0] ?? ""),
    (row) => row.dealId ?? undefined
  );
  if (scope.root.type !== "DEAL" && scope.root.type !== "PROPERTY") return events;
  const pendingRelationships = await db.relationshipObservation.findMany({
    where: {
      workspaceId: scope.workspaceId,
      sourceKind: { not: "MANUAL" },
      OR: [{ dealId: { in: scope.dealIds } }, { contextDealId: { in: scope.dealIds } }],
      promotion: { is: null },
      employmentSupports: { none: {} },
      propertyStakeSupports: { none: {} },
      dealParticipationSupports: { none: {} },
      dispositions: { none: { disposition: "REJECTED" } },
    },
    include: { ...evidenceInclude, subjectObservation: { select: { surfaceForm: true } }, objectObservation: { select: { surfaceForm: true } } },
    orderBy: { createdAt: "desc" },
  });
  return [...events, ...buildPendingRelationshipEvents(pendingRelationships, (dealId) => refsForDeal(scope, dealId))];
}

function milestoneTitle(kind: string): string {
  if (kind === "ANALYZED") return "Document analyzed";
  if (kind === "NEGOTIATION_REVIEWED") return "Negotiation findings reviewed";
  if (kind === "EVIDENCE_CORRECTED") return "Evidence corrected";
  if (kind === "DOCUMENT_REVIEWED") return "Document review complete";
  return "Document review";
}

function filterEvents(events: ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  if (filter === "ALL") return events;
  if (filter === "DOCUMENTS") return events.filter((event) => event.eventType === "DOCUMENT" || event.eventType === "DOCUMENT_REVIEW");
  if (filter === "NEGOTIATION") return events.filter((event) => event.eventType.startsWith("NEGOTIATION_") || event.sourceType === "SOURCE_MESSAGE");
  return events.filter((event) => ["ENTITY_EVIDENCE", "RELATIONSHIP_EVIDENCE", "DEAL_PARTICIPATION", "EMPLOYMENT_EVIDENCE", "PROPERTY_RELATIONSHIP_EVIDENCE"].includes(event.eventType));
}

function linkForFact(links: ReconciliationLink[], fact: { canonicalType: string | null; side: string; numeric: number | null }) {
  return links.find((link) =>
    link.canonicalType === fact.canonicalType
    && link.eventSide === fact.side
    && (fact.numeric == null || link.eventValue?.numeric === fact.numeric)
  );
}

function sourceMessageEvent(
  message: {
    id: string;
    dealId: string;
    subject: string | null;
    bodyText: string;
    sentAt: Date | null;
    receivedAt: Date | null;
    createdAt: Date;
    facts: Array<{
      id: string;
      factType: string;
      canonicalType: string | null;
      side: string;
      assertionStatus: string;
      evidenceQuote: string;
      structuredPayload: unknown;
      reviews?: Array<{ id: string }>;
      activityExtractionRun: { id: string; status: string; completedAt: Date | null; createdAt: Date } | null;
    }>;
    extractionRuns: Array<{ id: string; status: string; factCount: number; createdAt: Date; completedAt: Date | null; failureCode: string | null; failureReason: string | null }>;
    reviewDecisions: Array<{ id: string; decision: string; activityExtractionRunId: string | null; presentedFactIds: unknown; createdAt: Date }>;
  },
  links: ReconciliationLink[],
  refs: ActivityEntityRef[]
): ActivityEvent {
  const facts = factsFromLatestRun(message.facts);
  const negotiationCount = facts.filter((fact) => fact.factType === "NEGOTIATION_VALUE").length;
  const lifecycle = deriveMessageLifecycle({
    runs: message.extractionRuns,
    decisions: message.reviewDecisions,
    currentFactIds: facts.map((fact) => fact.id),
    facts,
  });
  const factDescription = facts.length > 0 ? `${facts.length} commercial fact${facts.length === 1 ? "" : "s"}` : "No commercial facts";
  const analyzedDescription = negotiationCount > 0
    ? `${factDescription} · ${negotiationCount} negotiation fact${negotiationCount === 1 ? "" : "s"}`
    : factDescription;
  const occurredAt = message.sentAt ?? message.receivedAt ?? message.createdAt;
  return {
    id: `source-message:${message.id}`,
    occurredAt: occurredAt.toISOString(),
    recordedAt: message.createdAt.toISOString(),
    eventType: "DEAL_ACTIVITY",
    title: message.subject?.trim() || "Email",
    description: lifecycle.analysisState === "NOT_ANALYZED"
      ? "Not analyzed"
      : lifecycle.evidenceSettled
        ? `${analyzedDescription} · Message reviewed`
        : lifecycle.reviewState === "REVIEWED" && lifecycle.actionReviewState === "PENDING"
          ? `${analyzedDescription} · Message reviewed · Action evidence pending`
          : lifecycle.analysisState === "ANALYSIS_FAILED"
            ? "Analysis failed"
            : analyzedDescription,
    entityRefs: refs,
    dealId: message.dealId,
    sourceType: "SOURCE_MESSAGE",
    sourceId: message.id,
    sourceHref: `/messages/${message.id}`,
    dedupeKey: `source-message:${message.id}`,
    reconciliation: links,
    details: facts.map((fact) => {
      const value = storedFactValue(fact.structuredPayload);
      const reconciliation = linkForFact(links, { canonicalType: fact.canonicalType, side: fact.side, numeric: value.numeric });
      return {
        canonicalType: fact.canonicalType ?? fact.factType,
        label: fact.canonicalType ? canonicalLabel(fact.canonicalType) : canonicalLabel(fact.factType),
        value: value.display ?? fact.evidenceQuote,
        status: fact.assertionStatus,
        side: activitySideLabel(fact.side),
        evidenceQuote: fact.evidenceQuote,
        reconciliation,
      };
    }),
    evidence: {
      title: message.subject?.trim() || "Email",
      supportCount: 1,
      supports: [{
        observationId: message.id,
        quote: message.subject?.trim() || "Email",
        provenanceStatus: null,
        pageNumber: null,
        documentId: null,
        documentName: null,
        messageId: message.id,
        messageSubject: message.subject,
        messageSender: null,
        sourceKind: "SOURCE_MESSAGE",
        sourceLocation: null,
        sourceDate: occurredAt.toISOString(),
        href: `/messages/${message.id}`,
        reviewHref: null,
        evidenceStartOffset: null,
        evidenceEndOffset: null,
        reviewState: null,
      }],
    },
  };
}

function compareEvent(a: Pick<ActivityEvent, "occurredAt" | "recordedAt" | "id">, b: Pick<ActivityEvent, "occurredAt" | "recordedAt" | "id">): number {
  if (a.occurredAt && !b.occurredAt) return -1;
  if (!a.occurredAt && b.occurredAt) return 1;
  if (a.occurredAt && b.occurredAt && a.occurredAt !== b.occurredAt) return b.occurredAt.localeCompare(a.occurredAt);
  if (a.recordedAt && !b.recordedAt) return -1;
  if (!a.recordedAt && b.recordedAt) return 1;
  if (a.recordedAt && b.recordedAt && a.recordedAt !== b.recordedAt) return b.recordedAt.localeCompare(a.recordedAt);
  return a.id.localeCompare(b.id);
}

export async function getActivityPage(db: GraphDb, input: ActivityQuery): Promise<ActivityPage | null> {
  const scope = await resolveScope(db, input.rootType, input.rootId);
  if (!scope) return null;
  const limit = input.limit ?? 25;
  const filter = input.filter ?? "ALL";
  const dealIds = scope.dealIds;
  const wantsDocuments = filter === "ALL" || filter === "DOCUMENTS";
  const wantsNegotiation = filter === "ALL" || filter === "NEGOTIATION";
  const wantsRelationships = filter === "ALL" || filter === "RELATIONSHIPS";
  const wantsMessages = filter === "ALL" || filter === "NEGOTIATION";
  const documentRootWhere: Prisma.DocumentWhereInput = scope.root.type === "PERSON"
    ? { entityObservations: { some: { workspaceId: scope.workspaceId, resolutionLinks: { some: { status: "ACCEPTED", personId: scope.root.id } }, dispositions: { none: { disposition: "REJECTED" } } } } }
    : scope.root.type === "COMPANY"
      ? { entityObservations: { some: { workspaceId: scope.workspaceId, resolutionLinks: { some: { status: "ACCEPTED", companyId: scope.root.id } }, dispositions: { none: { disposition: "REJECTED" } } } } }
      : {};
  const [documents, milestones, negotiationRows, dealEvents, relationshipEvents, observationEvents, sources] = await Promise.all([
    wantsDocuments && dealIds.length ? db.document.findMany({ where: { dealId: { in: dealIds }, deal: { workspaceId: scope.workspaceId }, ...documentRootWhere }, include: { deal: { select: { id: true, name: true } } }, orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }] }) : Promise.resolve([]),
    wantsDocuments && dealIds.length ? db.documentMilestone.findMany({ where: { document: { dealId: { in: dealIds }, deal: { workspaceId: scope.workspaceId } } }, include: { document: { select: { id: true, originalFilename: true, dealId: true } } }, orderBy: { occurredAt: "desc" } }) : Promise.resolve([]),
    wantsNegotiation && dealIds.length ? db.negotiationRound.findMany({
      where: { dealId: { in: dealIds }, deal: { workspaceId: scope.workspaceId } },
      include: {
        deal: { select: { id: true, name: true } },
        document: { select: { id: true, originalFilename: true, documentType: true, documentDate: true } },
        terms: { include: { documentPage: { select: { id: true, pageNumber: true } } }, orderBy: [{ canonicalType: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
    }) : Promise.resolve([]),
    filter === "ALL" && dealIds.length ? db.dealEvent.findMany({ where: { dealId: { in: dealIds }, deal: { workspaceId: scope.workspaceId } }, include: { deal: true, message: true }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }] }) : Promise.resolve([]),
    wantsRelationships ? loadCanonicalRelationshipEvents(db, scope) : Promise.resolve([]),
    wantsRelationships ? loadObservationEvents(db, scope) : Promise.resolve([]),
    wantsMessages ? loadDealMessageSources(db, scope.workspaceId, dealIds) : Promise.resolve({ messages: [], eventFacts: [] }),
  ]);
  const coveredEvents = linkedLegacyEventIds(sources.messages);
  const factsForEvent = eventFactsByEventId(sources.eventFacts);
  const visibleEvents = dealEvents.filter((event) => !coveredEvents.has(event.id));

  const reconciliation = linksByActivityEventId({
    events: [
      ...messageActivities(sources.messages),
      ...visibleEvents.map((event) => ({
        id: event.id,
        dealId: event.dealId,
        type: event.type,
        description: event.description,
        evidenceQuote: event.evidenceQuote,
        occurredAt: event.occurredAt,
        messageId: event.messageId,
        message: event.message ? { sender: event.message.sender, sentAt: event.message.sentAt } : null,
        structuredFacts: structuredFactsForEvent(factsForEvent.get(event.id) ?? []),
      })),
    ],
    rounds: negotiationRows.map((round) => ({
      id: round.id,
      dealId: round.dealId,
      side: round.side,
      roundNumber: round.roundNumber,
      documentName: round.documentName,
      documentDate: round.documentDate,
      createdAt: round.createdAt,
      sourceType: round.sourceType,
      documentId: round.documentId,
      terms: round.terms.map((term) => ({
        id: term.id,
        canonicalType: term.canonicalType,
        normalizedValue: term.normalizedValue,
        normalizedNumeric: term.normalizedNumeric,
        normalizedUnit: term.normalizedUnit,
        rawValue: term.rawValue,
        status: term.status,
        side: term.side,
        evidenceQuote: term.evidenceQuote,
        structuredPayload: term.structuredPayload,
        pageNumber: term.documentPage?.pageNumber ?? null,
      })),
    })),
  });
  const mappedRounds: ActivityNegotiationRound[] = negotiationRows.map((round) => ({
    ...round,
    terms: round.terms.map((term) => ({
      ...term,
      documentId: round.documentId,
      documentPageId: term.documentPageId,
      messageId: null,
      sourceKind: round.sourceType,
      document: round.document ? { id: round.document.id, originalFilename: round.document.originalFilename, documentDate: round.document.documentDate } : null,
      message: null,
    })),
  }));
  const events: ActivityEvent[] = [
    ...documents.map((document) => buildDocumentEvent(document, refsForDeal(scope, document.dealId))),
    ...milestones.map((milestone): ActivityEvent => ({
      id: `milestone:${milestone.id}`,
      occurredAt: milestone.occurredAt.toISOString(),
      recordedAt: milestone.occurredAt.toISOString(),
      eventType: "DOCUMENT_REVIEW",
      title: milestoneTitle(milestone.kind),
      description: milestone.document.originalFilename,
      entityRefs: refsForDeal(scope, milestone.document.dealId),
      dealId: milestone.document.dealId,
      documentId: milestone.document.id,
      sourceType: "DOCUMENT",
      sourceId: milestone.id,
      dedupeKey: milestone.dedupeKey,
    })),
    ...buildNegotiationEvents(mappedRounds, (dealId) => refsForDeal(scope, dealId)),
    ...visibleEvents.map((event): ActivityEvent => ({
      id: `deal-event:${event.id}`,
      occurredAt: event.occurredAt.toISOString(),
      recordedAt: null,
      eventType: "DEAL_ACTIVITY",
      title: sentence(event.type),
      description: event.description,
      entityRefs: refsForDeal(scope, event.dealId),
      dealId: event.dealId,
      evidence: { title: event.description, supportCount: 1, supports: [{ observationId: event.id, quote: event.evidenceQuote, provenanceStatus: null, pageNumber: null, documentId: null, documentName: null, messageId: event.messageId, messageSubject: null, messageSender: null, sourceKind: event.messageId ? "MESSAGE" : "MANUAL", sourceLocation: null, sourceDate: event.message?.sentAt.toISOString() ?? null, href: null, reviewHref: null, evidenceStartOffset: null, evidenceEndOffset: null, reviewState: null }] },
      sourceType: "DEAL_EVENT",
      sourceId: event.id,
      dedupeKey: `deal-event:${event.id}`,
      reconciliation: reconciliation.get(`deal-event:${event.id}`),
    })),
    ...sources.messages.map((message) => sourceMessageEvent(message, reconciliation.get(`source-message:${message.id}`) ?? [], refsForDeal(scope, message.dealId))),
    ...relationshipEvents,
    ...observationEvents,
  ];
  const unique = [...new Map(events.map((event) => [event.dedupeKey, event])).values()];
  const ordered = filterEvents(unique, filter).sort(compareEvent);
  const cursor = input.cursor ? decodeActivityCursor(input.cursor) : null;
  const afterCursor = cursor ? ordered.filter((event) => compareEvent(event, cursor) > 0) : ordered;
  const page = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > limit;
  const last = page.at(-1);
  return {
    root: scope.root,
    events: page,
    nextCursor: hasMore && last ? encodeActivityCursor({ occurredAt: last.occurredAt, recordedAt: last.recordedAt, id: last.id }) : null,
  };
}
