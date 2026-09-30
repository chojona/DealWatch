import type { ActivityEvent } from "@/lib/activity/types";
import { canonicalEntityHref } from "@/lib/intelligence/routes";
import type { InboxItem } from "@/lib/inbox/types";
import { processingLabel } from "@/lib/inbox/status";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import { termCountsAsOpen } from "@/lib/deals/brief/formalStatus";
import { formatNumericValue } from "@/lib/negotiation/intelligence/formatting";
import type {
  NegotiationEvidenceView,
  NegotiationMovementView,
  NegotiationPositionView,
  NegotiationTermView,
  NegotiationWorkspace,
} from "@/lib/negotiation/intelligence/types";
import { roleLabel } from "@/lib/promotion/service";
import type { DealKnowledge } from "@/lib/promotion/types";
import type {
  DealAgreedTerm,
  DealDocumentRollup,
  DealFact,
  DealHealth,
  DealIntelligence,
  DealIntelligenceStatus,
  DealMovementItem,
  DealOpenItem,
  DealParty,
  DealReviewQueueItem,
  DealSourceRef,
  DealTeam,
} from "./types";

const MAJOR_TERMS = new Set(["BASE_RENT", "TI_ALLOWANCE", "FREE_RENT", "LEASE_TERM"]);

const QUEUE_ORDER = [
  "PREPARE",
  "ANALYZE",
  "FAILED",
  "NEGOTIATION_REVIEW",
  "CONFLICT",
  "ENTITY",
  "RELATIONSHIP",
  "PROVENANCE",
  "FOLLOW_UP",
] as const;

export function deriveDealIntelligenceStatus(health: DealHealth): DealIntelligenceStatus {
  if (health.negotiationTermCount > 0) {
    const settled =
      health.agreedTermCount === health.negotiationTermCount &&
      health.openTermCount === 0 &&
      health.conflictCount === 0;
    if (settled) return "AGREED";
    if (
      health.conflictCount === 0 &&
      health.agreedTermCount > 0 &&
      health.openTermCount > 0 &&
      health.agreedTermCount >= health.openTermCount
    ) {
      return "MOSTLY_AGREED";
    }
    return "NEGOTIATING";
  }

  const awaitingAnalysis =
    health.documentCount -
    health.reviewedDocumentCount -
    health.reviewRequiredDocumentCount -
    health.failedDocumentCount -
    health.processingDocumentCount;
  if (health.documentCount === 0) return "SETUP";
  if (health.processingDocumentCount > 0 || awaitingAnalysis > 0) return "DOCUMENTS_PROCESSING";
  if (health.reviewRequiredDocumentCount > 0 || health.failedDocumentCount > 0) return "REVIEW_REQUIRED";
  return "SETUP";
}

export function intelligenceStatusLabel(status: DealIntelligenceStatus): string {
  if (status === "SETUP") return "Setup";
  if (status === "DOCUMENTS_PROCESSING") return "Documents processing";
  if (status === "REVIEW_REQUIRED") return "Review required";
  if (status === "NEGOTIATING") return "Negotiating";
  if (status === "MOSTLY_AGREED") return "Mostly agreed";
  return "Agreed";
}

function positionLine(
  side: "TENANT" | "LANDLORD",
  position: NegotiationPositionView | null,
  movement: NegotiationMovementView
): string | null {
  if (!position) return null;
  if (position.kind === "CONFLICT") return position.label;
  if (
    movement.side === side &&
    movement.kind === "NUMERIC" &&
    movement.from !== null &&
    movement.to !== null &&
    movement.unit
  ) {
    return `${formatNumericValue(movement.from, movement.unit)} → ${formatNumericValue(movement.to, movement.unit)}`;
  }
  return position.value.summary;
}

function sourceFromEvidence(
  evidence: NegotiationEvidenceView | undefined,
  roundId: string | null,
  roundName: string | null,
  roundDate: string | null
): DealSourceRef {
  return {
    roundId,
    roundName: roundName ?? evidence?.sourceLabel ?? null,
    roundDate,
    documentId: evidence?.documentId ?? null,
    sourceLabel: evidence?.sourceLabel ?? null,
    sourceKind: evidence?.sourceKind ?? null,
    pageNumber: evidence?.pageNumber ?? null,
    href: evidence?.href ?? null,
  };
}

function latestObservation(term: NegotiationTermView) {
  const side = term.latestSideToChange;
  const matching = side ? term.history.filter((item) => item.side === side) : term.history;
  return matching.at(-1) ?? term.history.at(-1) ?? null;
}

function openRank(term: NegotiationTermView): number {
  if (term.conflict) return 1;
  const twoSided = Boolean(term.tenantPosition && term.landlordPosition);
  if (twoSided && term.status !== "AGREED") return 2;
  const oneSided = Boolean(term.tenantPosition) !== Boolean(term.landlordPosition);
  if (oneSided && term.status === "PROPOSED") return 3;
  return 4;
}

function openItems(terms: NegotiationTermView[]): DealOpenItem[] {
  return terms
    .filter((term) => termCountsAsOpen(term))
    .map((term) => {
      const latest = latestObservation(term);
      const evidence = latest ? [latest.evidence] : [];
      return {
        canonicalType: term.canonicalType,
        label: term.label,
        tenantPosition: term.tenantPosition,
        landlordPosition: term.landlordPosition,
        numericGap: term.numericGap,
        status: term.status,
        latestChangingSide: term.latestSideToChange,
        lastChangedAt: latest?.roundDate ?? null,
        source: sourceFromEvidence(latest?.evidence, latest?.roundId ?? null, latest?.roundName ?? null, latest?.roundDate ?? null),
        evidence,
        rank: openRank(term),
      };
    })
    .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
}

function agreedTerms(terms: NegotiationTermView[]): DealAgreedTerm[] {
  const agreed: DealAgreedTerm[] = [];
  for (const term of terms) {
    const position = term.agreedPosition;
    if (term.status !== "AGREED" || !position || position.kind !== "VALUE") continue;
    const observationIds = new Set(position.observationIds);
    const latest = term.history.filter((item) => observationIds.has(item.id) && item.status === "AGREED").at(-1) ?? null;
    agreed.push({
      canonicalType: term.canonicalType,
      label: term.label,
      agreedValue: position.value,
      agreedAt: latest?.roundDate ?? null,
      source: sourceFromEvidence(latest?.evidence, latest?.roundId ?? null, latest?.roundName ?? null, latest?.roundDate ?? null),
      evidence: latest ? [latest.evidence] : [],
    });
  }
  return agreed;
}

function recentMovement(workspace: NegotiationWorkspace): DealMovementItem[] {
  const rounds = new Map(workspace.rounds.map((round) => [round.id, round]));
  return workspace.terms
    .filter((term) => term.movement.kind === "NUMERIC" || term.movement.kind === "CHANGED")
    .map((term) => {
      const round = term.movement.roundId ? rounds.get(term.movement.roundId) : undefined;
      const evidence = term.history.find((item) => item.roundId === term.movement.roundId)?.evidence;
      return {
        canonicalType: term.canonicalType,
        label: term.label,
        tenantLine: positionLine("TENANT", term.tenantPosition, term.movement),
        landlordLine: positionLine("LANDLORD", term.landlordPosition, term.movement),
        movement: term.movement,
        source: sourceFromEvidence(
          evidence,
          round?.id ?? term.movement.roundId,
          round?.documentName ?? null,
          round?.documentDate ?? null
        ),
      };
    })
    .sort((left, right) => (right.source.roundDate ?? "").localeCompare(left.source.roundDate ?? "") || left.label.localeCompare(right.label));
}

function analysisLabel(item: InboxItem): string {
  if (item.document.ingestionStatus === "COMPLETE") return "Complete";
  if (item.document.ingestionStatus === "FAILED") return "Failed";
  if (item.document.ingestionStatus === "ANALYZING" || item.document.ingestionStatus === "EXTRACTING") return "Running";
  if (item.processingStatus === "READY_TO_ANALYZE") return "Ready";
  return "Not run";
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function documentAction(item: InboxItem): { label: string; href: string } {
  if (item.processingStatus === "READY_TO_PREPARE" || item.processingStatus === "NOT_READY") {
    return { label: "Prepare", href: item.reviewHref };
  }
  if (item.processingStatus === "READY_TO_ANALYZE") {
    return { label: "Analyze", href: item.reviewHref };
  }
  if (item.processingStatus === "REVIEW_REQUIRED") {
    return { label: "Review", href: item.reviewHref };
  }
  if (item.processingStatus === "REVIEWED") {
    return { label: "View reviewed document", href: item.reviewHref };
  }
  if (item.processingStatus === "FAILED") {
    return { label: item.canRetry ? "Retry analysis" : "View failure", href: item.reviewHref };
  }
  return { label: "View document", href: item.reviewHref };
}

function documents(items: InboxItem[]): DealDocumentRollup[] {
  return [...items]
    .sort((left, right) => {
      const leftDate = left.documentDate ?? left.uploadedAt;
      const rightDate = right.documentDate ?? right.uploadedAt;
      return leftDate.localeCompare(rightDate) || left.document.originalFilename.localeCompare(right.document.originalFilename);
    })
    .map((item) => {
      const entities = [
        countLabel(item.entityReviewSummary.found, "found"),
        item.entityReviewSummary.unresolved > 0 ? `${item.entityReviewSummary.unresolved} unreviewed` : null,
        item.entityReviewSummary.leftUnresolved > 0 ? `${item.entityReviewSummary.leftUnresolved} left unresolved` : null,
      ].filter((part): part is string => Boolean(part));
      const relationships = [
        countLabel(item.relationshipReviewSummary.found, "found"),
        item.relationshipReviewSummary.ready + item.relationshipReviewSummary.blocked > 0
          ? `${item.relationshipReviewSummary.ready + item.relationshipReviewSummary.blocked} unreviewed`
          : null,
        item.relationshipReviewSummary.acknowledgedBlocked > 0
          ? `${item.relationshipReviewSummary.acknowledgedBlocked} acknowledged blocked`
          : null,
      ].filter((part): part is string => Boolean(part));
      const evidence = [
        item.evidenceSummary.exact > 0 ? `${item.evidenceSummary.exact} exact` : null,
        item.evidenceSummary.ambiguous > 0 ? `${item.evidenceSummary.ambiguous} ambiguous` : null,
        item.evidenceSummary.unlocated > 0 ? `${item.evidenceSummary.unlocated} unlocated` : null,
      ].filter((part): part is string => Boolean(part));
      const negotiation = [
        countLabel(item.negotiationSummary.termCount, "finding"),
        item.negotiationSummary.pendingReviewCount > 0 ? `${item.negotiationSummary.pendingReviewCount} unreviewed` : null,
        item.negotiationSummary.followUpCount > 0 ? `${item.negotiationSummary.followUpCount} follow-up` : null,
        item.negotiationSummary.unreviewedConflictCount > 0 ? `${item.negotiationSummary.unreviewedConflictCount} conflicts` : null,
      ].filter((part): part is string => Boolean(part));
      return {
        id: item.document.id,
        name: item.document.originalFilename,
        documentType: DOCUMENT_TYPE_LABELS[item.document.documentType] ?? item.document.documentType,
        side: item.document.negotiationSide,
        documentDate: item.documentDate,
        uploadedAt: item.uploadedAt,
        analysis: analysisLabel(item),
        review: processingLabel(item.processingStatus),
        reviewState: item.processingStatus,
        negotiationFindings: negotiation.join(" · "),
        entities: entities.join(" · "),
        relationships: relationships.join(" · "),
        evidence: evidence.length > 0 ? evidence.join(" · ") : "None recorded",
        action: documentAction(item),
      };
    });
}

function outstandingReasons(item: InboxItem): Set<string> {
  const reasons = new Set(item.reviewReasons);
  if (item.negotiationSummary.pendingReviewCount > 0) reasons.add("NEGOTIATION_REVIEW_PENDING");
  if (item.negotiationSummary.followUpCount > 0) reasons.add("NEGOTIATION_FOLLOW_UP");
  if (item.negotiationSummary.unreviewedConflictCount > 0) reasons.add("NEGOTIATION_CONFLICT");
  if (item.entityReviewSummary.unresolved > 0) reasons.add("UNRESOLVED_ENTITIES");
  if (item.relationshipReviewSummary.ready + item.relationshipReviewSummary.blocked > 0) {
    reasons.add("UNRESOLVED_RELATIONSHIPS");
  }
  if (item.evidenceSummary.ambiguous > 0) reasons.add("AMBIGUOUS_PROVENANCE");
  if (item.evidenceSummary.unlocated > 0) reasons.add("UNLOCATED_PROVENANCE");
  return reasons;
}

function reviewQueue(items: InboxItem[]): DealReviewQueueItem[] {
  const queued: DealReviewQueueItem[] = [];
  for (const item of items) {
    const reasons = outstandingReasons(item);
    const base = {
      documentId: item.document.id,
      documentName: item.document.originalFilename,
      href: item.reviewHref,
    };
    if (item.processingStatus === "NOT_READY" || item.processingStatus === "READY_TO_PREPARE") {
      queued.push({ ...base, id: `${item.document.id}:prepare`, kind: "PREPARE", label: "Prepare document", detail: item.document.originalFilename });
    }
    if (item.processingStatus === "READY_TO_ANALYZE") {
      queued.push({ ...base, id: `${item.document.id}:analyze`, kind: "ANALYZE", label: "Analyze document", detail: item.document.originalFilename });
    }
    if (item.processingStatus === "FAILED") {
      queued.push({
        ...base,
        id: `${item.document.id}:failed`,
        kind: "FAILED",
        label: "Analysis failed",
        detail: item.document.failureReason,
      });
    }
    if (reasons.has("NEGOTIATION_REVIEW_PENDING")) {
      queued.push({
        ...base,
        id: `${item.document.id}:negotiation`,
        kind: "NEGOTIATION_REVIEW",
        label: "Unreviewed negotiation findings",
        detail: countLabel(item.negotiationSummary.pendingReviewCount, "finding"),
      });
    }
    if (reasons.has("NEGOTIATION_CONFLICT")) {
      queued.push({
        ...base,
        id: `${item.document.id}:conflict`,
        kind: "CONFLICT",
        label: "Negotiation conflict requires review",
        detail: countLabel(item.negotiationSummary.unreviewedConflictCount, "conflict"),
      });
    }
    if (reasons.has("UNRESOLVED_ENTITIES")) {
      queued.push({
        ...base,
        id: `${item.document.id}:entities`,
        kind: "ENTITY",
        label: "Unreviewed entities",
        detail: countLabel(item.entityReviewSummary.unresolved, "entity", "entities"),
      });
    }
    if (reasons.has("UNRESOLVED_RELATIONSHIPS")) {
      queued.push({
        ...base,
        id: `${item.document.id}:relationships`,
        kind: "RELATIONSHIP",
        label: "Unreviewed relationships",
        detail: countLabel(item.relationshipReviewSummary.ready + item.relationshipReviewSummary.blocked, "relationship"),
      });
    }
    if (reasons.has("AMBIGUOUS_PROVENANCE") || reasons.has("UNLOCATED_PROVENANCE")) {
      queued.push({
        ...base,
        id: `${item.document.id}:provenance`,
        kind: "PROVENANCE",
        label: "Provenance needs review",
        detail: [
          item.evidenceSummary.ambiguous > 0 ? `${item.evidenceSummary.ambiguous} ambiguous` : null,
          item.evidenceSummary.unlocated > 0 ? `${item.evidenceSummary.unlocated} unlocated` : null,
        ].filter(Boolean).join(" · ") || null,
      });
    }
    if (reasons.has("NEGOTIATION_FOLLOW_UP")) {
      queued.push({
        ...base,
        id: `${item.document.id}:follow-up`,
        kind: "FOLLOW_UP",
        label: "Needs follow-up",
        detail: countLabel(item.negotiationSummary.followUpCount, "decision"),
      });
    }
  }
  return queued.sort((left, right) => {
    const kind = QUEUE_ORDER.indexOf(left.kind) - QUEUE_ORDER.indexOf(right.kind);
    return kind || left.documentName.localeCompare(right.documentName);
  });
}

function partyGroup(role: string): keyof Omit<DealTeam, "property"> {
  if (role === "TENANT" || role === "SUBTENANT") return "tenant";
  if (role === "LANDLORD" || role === "SUBLANDLORD") return "landlord";
  if (role === "TENANT_BROKER" || role === "TENANT_BROKERAGE") return "tenantBrokers";
  if (role === "LANDLORD_BROKER" || role === "LANDLORD_BROKERAGE") return "landlordBrokers";
  return "other";
}

function teamFrom(knowledge: DealKnowledge): DealTeam {
  const employers = new Map<string, DealParty["employers"]>();
  for (const person of knowledge.canonical.people) {
    employers.set(
      person.personId,
      person.employers.map((employer) => ({
        companyId: employer.companyId,
        companyName: employer.companyName,
        href: canonicalEntityHref("COMPANY", employer.companyId),
        title: employer.titleAtTime,
      }))
    );
  }
  const team: DealTeam = {
    property: knowledge.canonical.property
      ? {
          id: knowledge.canonical.property.id,
          name: knowledge.canonical.property.name,
          href: canonicalEntityHref("PROPERTY", knowledge.canonical.property.id),
          address: knowledge.canonical.property.address,
          evidence: knowledge.canonical.property.evidence,
        }
      : null,
    tenant: [],
    landlord: [],
    tenantBrokers: [],
    landlordBrokers: [],
    other: [],
  };
  for (const participation of knowledge.canonical.participations) {
    const party: DealParty = {
      id: participation.id,
      actorId: participation.actorId,
      actorType: participation.actorType,
      name: participation.actorName,
      href: participation.actorId && participation.actorType
        ? canonicalEntityHref(participation.actorType, participation.actorId)
        : null,
      role: roleLabel(participation.role, participation.roleLabel),
      representsCompanyId: participation.representsCompanyId,
      representsCompanyName: participation.representsCompanyName,
      representsHref: participation.representsCompanyId
        ? canonicalEntityHref("COMPANY", participation.representsCompanyId)
        : null,
      employers: participation.actorType === "PERSON" && participation.actorId
        ? employers.get(participation.actorId) ?? []
        : [],
      evidence: participation.evidence,
    };
    team[partyGroup(participation.role)].push(party);
  }
  return team;
}

function positionFactValue(position: NegotiationPositionView): string {
  if (position.kind === "CONFLICT") {
    return position.candidates.map((candidate, index) => `Candidate ${index + 1}: ${candidate.value.summary}`).join("; ");
  }
  return position.value.summary;
}

function factsFrom(terms: NegotiationTermView[], team: DealTeam): DealFact[] {
  const facts: DealFact[] = [];
  for (const term of terms) {
    if (!MAJOR_TERMS.has(term.canonicalType)) continue;
    if (term.status === "AGREED" && term.agreedPosition?.kind === "VALUE") {
      const observationIds = new Set(term.agreedPosition.observationIds);
      facts.push({
        id: `term:${term.canonicalType}`,
        label: term.label,
        value: term.agreedPosition.value.summary,
        evidence: term.history.filter((item) => observationIds.has(item.id)).map((item) => item.evidence),
      });
      continue;
    }
    if (term.tenantPosition) {
      facts.push({
        id: `term:${term.canonicalType}:tenant`,
        label: `${term.label} · Tenant`,
        value: positionFactValue(term.tenantPosition),
        evidence: evidenceForPosition(term, term.tenantPosition),
      });
    }
    if (term.landlordPosition) {
      facts.push({
        id: `term:${term.canonicalType}:landlord`,
        label: `${term.label} · Landlord`,
        value: positionFactValue(term.landlordPosition),
        evidence: evidenceForPosition(term, term.landlordPosition),
      });
    }
  }
  if (team.property) {
    facts.push({
      id: `property:${team.property.id}`,
      label: "Property",
      value: team.property.name,
      evidence: team.property.evidence,
    });
  }
  for (const party of [...team.tenant, ...team.landlord, ...team.tenantBrokers, ...team.landlordBrokers, ...team.other]) {
    facts.push({
      id: `party:${party.id}`,
      label: party.role,
      value: party.name,
      evidence: party.evidence,
    });
  }
  return facts;
}

function evidenceForPosition(term: NegotiationTermView, position: NegotiationPositionView): NegotiationEvidenceView[] {
  const ids = new Set(position.observationIds);
  return term.history.filter((item) => ids.has(item.id)).map((item) => item.evidence);
}

function healthFrom(input: {
  documents: InboxItem[];
  workspace: NegotiationWorkspace;
  activity: ActivityEvent[];
}): DealHealth {
  const count = (status: string) => input.documents.filter((item) => item.processingStatus === status).length;
  return {
    documentCount: input.documents.length,
    reviewedDocumentCount: count("REVIEWED"),
    reviewRequiredDocumentCount: count("REVIEW_REQUIRED"),
    failedDocumentCount: count("FAILED"),
    processingDocumentCount: count("ANALYZING"),
    negotiationTermCount: input.workspace.terms.length,
    openTermCount: input.workspace.summary.openCount,
    agreedTermCount: input.workspace.terms.filter((term) => term.status === "AGREED").length,
    conflictCount: input.workspace.terms.filter((term) => term.conflict).length,
    unresolvedEntityCount: input.documents.reduce((sum, item) => sum + item.entityReviewSummary.unresolved, 0),
    blockedRelationshipCount: input.documents.reduce((sum, item) => sum + item.relationshipReviewSummary.blocked, 0),
    evidenceIssueCount: input.documents.reduce(
      (sum, item) => sum + item.evidenceSummary.ambiguous + item.evidenceSummary.unlocated,
      0
    ),
    latestActivityAt: latestTimestamp(input.activity.map((event) => event.occurredAt ?? event.recordedAt)),
    latestNegotiationAt: latestTimestamp(input.workspace.rounds.map((round) => round.documentDate)),
  };
}

function latestTimestamp(values: Array<string | null>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  if (present.length === 0) return null;
  return present.reduce((latest, value) => (value > latest ? value : latest));
}

export function projectDealIntelligence(input: {
  workspace: NegotiationWorkspace;
  documents: InboxItem[];
  knowledge: DealKnowledge;
  activity: ActivityEvent[];
}): DealIntelligence {
  const team = teamFrom(input.knowledge);
  const health = healthFrom({ documents: input.documents, workspace: input.workspace, activity: input.activity });
  return {
    deal: {
      id: input.workspace.deal.id,
      name: input.workspace.deal.name,
      company: input.workspace.deal.company,
      property: input.workspace.deal.property,
      propertyId: input.workspace.deal.propertyId,
      stage: input.workspace.deal.stage,
      recordStatus: input.workspace.deal.status,
      estimatedValue: input.workspace.deal.estimatedValue,
      createdAt: input.workspace.deal.createdAt,
      workspaceId: input.knowledge.workspaceId,
    },
    intelligenceStatus: deriveDealIntelligenceStatus(health),
    health,
    terms: input.workspace.terms,
    openItems: openItems(input.workspace.terms),
    agreedTerms: agreedTerms(input.workspace.terms),
    recentMovement: recentMovement(input.workspace),
    documents: documents(input.documents),
    messageRollup: { total: 0, needsReview: 0, failed: 0 },
    reviewQueue: reviewQueue(input.documents),
    team,
    facts: factsFrom(input.workspace.terms, team),
    activity: input.activity,
    activityHref: `/deals/${input.workspace.deal.id}/activity`,
  };
}
