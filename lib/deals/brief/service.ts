import type { Prisma, PrismaClient } from "@prisma/client";
import { getDealActionState } from "@/lib/deals/actions/service";
import { getInbox } from "@/lib/inbox/service";
import { canonicalLabel } from "@/lib/messages/facts";
import { effectiveActivityFact } from "@/lib/messages/effective";
import { factsFromLatestRun } from "@/lib/messages/latestRun";
import { deriveMessageLifecycle } from "@/lib/messages/state";
import { currentFormalObservation, getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import type { NegotiationRoundView } from "@/lib/negotiation/intelligence/types";
import { buildDealEvidenceComparisons } from "./comparison";
import {
  countOpenFormalTerms,
  formalPositionFullyRejected,
  projectFormalBriefStatus,
} from "./formalStatus";
import { displayedComparisons } from "./presentation";
import type {
  DealBrief,
  DealBriefAttentionItem,
  DealBriefChange,
  DealBriefCommunication,
  DealBriefOptions,
  DealBriefSourceRef,
  DealBriefTimelineItem,
} from "./types";

const DEFAULT_COMMUNICATION_LIMIT = 12;
const DEFAULT_CHANGE_LIMIT = 16;
const DEFAULT_TIMELINE_LIMIT = 16;
const MAX_LIMIT = 50;

const messageSelect = {
  id: true,
  workspaceId: true,
  dealId: true,
  subject: true,
  senderName: true,
  senderAddress: true,
  sentAt: true,
  receivedAt: true,
  sourceType: true,
  createdAt: true,
  participants: {
    select: { role: true, displayName: true, address: true },
    orderBy: [{ role: "asc" }, { address: "asc" }],
  },
  extractionRuns: {
    select: {
      id: true,
      status: true,
      factCount: true,
      failureCode: true,
      failureReason: true,
      createdAt: true,
      completedAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  reviewDecisions: {
    select: {
      id: true,
      decision: true,
      activityExtractionRunId: true,
      presentedFactIds: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  facts: {
    select: {
      id: true,
      factType: true,
      canonicalType: true,
      side: true,
      assertionStatus: true,
      structuredPayload: true,
      evidenceQuote: true,
      createdAt: true,
      activityExtractionRun: {
        select: { id: true, status: true, completedAt: true, createdAt: true },
      },
      reviews: {
        select: {
          id: true,
          state: true,
          createdAt: true,
          correction: {
            select: {
              id: true,
              structuredPayload: true,
              note: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.SourceMessageSelect;

type BriefMessageRow = Prisma.SourceMessageGetPayload<{ select: typeof messageSelect }>;

function bounded(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value!), MAX_LIMIT));
}

function source(
  kind: DealBriefSourceRef["kind"],
  id: string,
  label: string,
  href: string | null,
  extra: Partial<DealBriefSourceRef> = {}
): DealBriefSourceRef {
  return { kind, id, label, href, ...extra };
}

function iso(value: Date): string {
  return value.toISOString();
}

function afterSince(value: string | null, since?: Date): boolean {
  if (!since) return true;
  return Boolean(value && new Date(value).getTime() > since.getTime());
}

function occurredAt(message: BriefMessageRow): Date {
  return message.sentAt ?? message.receivedAt ?? message.createdAt;
}

function communicationWhere(
  deal: { id: string; workspaceId: string },
  since?: Date
): Prisma.SourceMessageWhereInput {
  const scope: Prisma.SourceMessageWhereInput = {
    workspaceId: deal.workspaceId,
    dealId: deal.id,
  };
  if (!since) return scope;
  return {
    ...scope,
    OR: [
      { sentAt: { gt: since } },
      { sentAt: null, receivedAt: { gt: since } },
      { sentAt: null, receivedAt: null, createdAt: { gt: since } },
    ],
  };
}

function presentCommunication(message: BriefMessageRow): DealBriefCommunication {
  const facts = factsFromLatestRun(message.facts);
  const lifecycle = deriveMessageLifecycle({
    runs: message.extractionRuns,
    decisions: message.reviewDecisions,
    currentFactIds: facts.map((fact) => fact.id),
    facts,
  });
  const timestamp = occurredAt(message);
  return {
    id: message.id,
    timestamp: iso(timestamp),
    importedAt: iso(message.createdAt),
    sender: {
      name: message.senderName,
      address: message.senderAddress,
      label: message.senderName ?? message.senderAddress ?? "Unknown sender",
    },
    participants: message.participants,
    subject: message.subject?.trim() || "Email",
    sourceType: message.sourceType,
    ...lifecycle,
    facts: facts.map((fact) => {
      const effective = effectiveActivityFact(fact);
      const correctionRow = effective.correction
        ? fact.reviews.find((review) => review.correction?.id === effective.correction?.id)?.correction ?? null
        : null;
      return {
        id: fact.id,
        factType: fact.factType,
        canonicalType: fact.canonicalType,
        label: canonicalLabel(fact.canonicalType ?? fact.factType),
        side: fact.side,
        assertionStatus: fact.assertionStatus,
        evidenceQuote: fact.evidenceQuote,
        raw: effective.raw,
        review: effective.review,
        correction: effective.correction && correctionRow ? {
          ...effective.correction,
          createdAt: iso(correctionRow.createdAt),
        } : null,
        presentation: {
          value: effective.presentationValue.display ?? fact.evidenceQuote,
          payload: effective.presentationPayload,
          corrected: Boolean(effective.correction),
        },
      };
    }),
    source: source(
      "COMMUNICATION_EVIDENCE",
      message.id,
      message.subject?.trim() || "Email",
      `/messages/${message.id}`,
      { messageId: message.id }
    ),
  };
}

function formalSource(dealId: string, round: NegotiationRoundView): DealBriefSourceRef {
  return source(
    "FORMAL_NEGOTIATION",
    round.id,
    round.documentName,
    round.documentHref ?? `/deals/${dealId}/negotiation?round=${round.id}`,
    { documentId: round.documentId, negotiationRoundId: round.id }
  );
}

function changeForRound(dealId: string, round: NegotiationRoundView): DealBriefChange {
  const changed = round.changes.filter((item) => item.kind === "CHANGED");
  const agreed = round.changes.filter((item) => item.kind === "AGREED");
  const type = agreed.length > 0 && changed.length === 0
    ? "FORMAL_AGREEMENT"
    : round.changes.some((item) => item.previousValue !== null)
      ? "FORMAL_POSITION_CHANGED"
      : "FORMAL_PROPOSAL";
  const side = round.side === "TENANT" ? "Tenant" : "Landlord";
  const meaningful = [...changed, ...agreed].slice(0, 3).map((item) => {
    if (item.kind === "AGREED") return `${item.label}: ${item.currentValue} agreed`;
    return item.previousValue
      ? `${item.label}: ${item.previousValue} → ${item.currentValue}`
      : `${item.label}: ${item.currentValue}`;
  });
  return {
    id: `formal-round:${round.id}`,
    type,
    sourceKind: "FORMAL_NEGOTIATION",
    timestamp: round.documentDate,
    label: `${side} ${type === "FORMAL_AGREEMENT" ? "agreement" : round.roundNumber > 1 ? "counterproposal" : "proposal"}`,
    description: meaningful.join(" · ") || null,
    source: formalSource(dealId, round),
    priority: type === "FORMAL_PROPOSAL" ? 2 : 1,
  };
}

function compareRecent<T extends { id: string; timestamp: string; priority: number }>(left: T, right: T): number {
  return left.priority - right.priority
    || right.timestamp.localeCompare(left.timestamp)
    || left.id.localeCompare(right.id);
}

function compareAttention(left: DealBriefAttentionItem, right: DealBriefAttentionItem): number {
  return left.priority - right.priority
    || (right.timestamp ?? "").localeCompare(left.timestamp ?? "")
    || left.id.localeCompare(right.id);
}

function compareTimeline(left: DealBriefTimelineItem, right: DealBriefTimelineItem): number {
  const leftTime = left.occurredAt ?? left.recordedAt ?? "";
  const rightTime = right.occurredAt ?? right.recordedAt ?? "";
  return rightTime.localeCompare(leftTime)
    || (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "")
    || left.id.localeCompare(right.id);
}

function timelineAfterSince(item: DealBriefTimelineItem, since?: Date): boolean {
  return afterSince(item.occurredAt ?? item.recordedAt, since);
}

/**
 * Read-only Phase 10A projection. It composes existing deterministic read
 * services and bounded source queries; it never invokes extraction or writes.
 */
export async function getDealBrief(
  db: PrismaClient,
  dealId: string,
  options: DealBriefOptions = {}
): Promise<DealBrief | null> {
  const communicationLimit = bounded(options.communicationLimit, DEFAULT_COMMUNICATION_LIMIT);
  const changeLimit = bounded(options.changeLimit, DEFAULT_CHANGE_LIMIT);
  const timelineLimit = bounded(options.timelineLimit, DEFAULT_TIMELINE_LIMIT);
  const sourceLimit = Math.min(MAX_LIMIT, Math.max(changeLimit, timelineLimit) * 2);
  const now = options.now ?? new Date();
  const scopedDeal = await db.deal.findUnique({
    where: { id: dealId },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      company: true,
      property: true,
      propertyId: true,
      stage: true,
      status: true,
      estimatedValue: true,
      createdAt: true,
    },
  });
  if (!scopedDeal || (options.expectedWorkspaceId && scopedDeal.workspaceId !== options.expectedWorkspaceId)) {
    return null;
  }

  const milestoneWhere = {
    document: { dealId: scopedDeal.id, deal: { workspaceId: scopedDeal.workspaceId } },
    ...(options.since ? { occurredAt: { gt: options.since } } : {}),
  };
  const legacyWhere = {
    dealId: scopedDeal.id,
    deal: { workspaceId: scopedDeal.workspaceId },
    linkedSourceMessages: { none: {} },
    ...(options.since ? { occurredAt: { gt: options.since } } : {}),
  };
  const correctionWhere = {
    workspaceId: scopedDeal.workspaceId,
    sourceMessage: { dealId: scopedDeal.id, workspaceId: scopedDeal.workspaceId },
    ...(options.since ? { createdAt: { gt: options.since } } : {}),
  };
  const [negotiation, inbox, messageRows, communicationTotal, milestones, milestoneTotal, nonAnalyzedMilestoneTotal, legacyEvents, legacyTotal, corrections, correctionTotal, unpromotedAttachments, actions] = await Promise.all([
    getNegotiationWorkspace(db, scopedDeal.id),
    getInbox(db, {
      workspaceId: scopedDeal.workspaceId,
      scopeDealId: scopedDeal.id,
      includeMessages: false,
    }),
    db.sourceMessage.findMany({
      where: communicationWhere(scopedDeal),
      take: sourceLimit,
      orderBy: [
        { sentAt: "desc" },
        { receivedAt: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: messageSelect,
    }),
    db.sourceMessage.count({ where: communicationWhere(scopedDeal, options.since) }),
    db.documentMilestone.findMany({
      where: milestoneWhere,
      take: sourceLimit,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        kind: true,
        occurredAt: true,
        document: { select: { id: true, originalFilename: true } },
      },
    }),
    db.documentMilestone.count({ where: milestoneWhere }),
    db.documentMilestone.count({ where: { ...milestoneWhere, kind: { not: "ANALYZED" } } }),
    db.dealEvent.findMany({
      where: legacyWhere,
      take: sourceLimit,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        type: true,
        description: true,
        occurredAt: true,
        messageId: true,
        message: { select: { sender: true, sentAt: true } },
      },
    }),
    db.dealEvent.count({ where: legacyWhere }),
    db.activityFactCorrection.findMany({
      where: correctionWhere,
      take: changeLimit,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        activityFactId: true,
        createdAt: true,
        note: true,
        structuredPayload: true,
        activityFact: { select: { factType: true, canonicalType: true, evidenceQuote: true } },
        sourceMessage: { select: { id: true, subject: true } },
      },
    }),
    db.activityFactCorrection.count({ where: correctionWhere }),
    db.sourceMessageAttachment.findMany({
      where: {
        contentType: "application/pdf",
        promotion: { is: null },
        sourceMessage: { dealId: scopedDeal.id, workspaceId: scopedDeal.workspaceId },
      },
      take: 20,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, filename: true, sourceMessageId: true, createdAt: true },
    }),
    getDealActionState(db, scopedDeal.id, { expectedWorkspaceId: scopedDeal.workspaceId, now }),
  ]);
  if (!negotiation || !actions) return null;

  const allCommunications = messageRows.map(presentCommunication);
  const communications = allCommunications
    .filter((communication) => afterSince(communication.timestamp, options.since))
    .slice(0, communicationLimit);
  const roundById = new Map(negotiation.rounds.map((round) => [round.id, round]));
  const projectedTerms = negotiation.terms.map((term) => {
    const projection = projectFormalBriefStatus({
      label: term.label,
      status: term.status,
      conflict: term.conflict,
      reviewRejected: formalPositionFullyRejected(term.history),
    });
    const latestHistory = currentFormalObservation(term);
    const round = latestHistory ? roundById.get(latestHistory.roundId) ?? null : null;
    const latestEvidence = latestHistory?.evidence ?? term.evidence.at(-1) ?? null;
    return {
      projection,
      term: {
      canonicalType: term.canonicalType,
      label: term.label,
      status: term.status,
      briefStatus: projection.briefStatus,
      statusLabel: projection.label,
      conflict: term.conflict,
      tenantPosition: term.tenantPosition,
      landlordPosition: term.landlordPosition,
      agreedPosition: term.agreedPosition,
      movement: term.movement,
      lastChangedAt: latestHistory?.roundDate ?? null,
      source: round ? formalSource(scopedDeal.id, round) : null,
      provenance: {
        observationIds: term.sourceObservationIds,
        evidenceHref: latestEvidence?.href ?? null,
        evidenceLabel: latestEvidence?.sourceLabel ?? null,
        evidenceQuote: latestEvidence?.quote ?? null,
        pageLabel: latestEvidence?.pageLabel ?? null,
        provenanceStatus: latestEvidence?.provenanceStatus ?? null,
        formalReviewState: latestHistory?.formalReview?.state ?? null,
      },
      },
    };
  });
  const negotiationTerms = projectedTerms.map((item) => item.term);
  const comparisons = buildDealEvidenceComparisons({
    terms: negotiationTerms,
    communications: allCommunications,
  });

  const formalChanges = negotiation.rounds
    .filter((round) => (round.changedCount > 0 || round.agreedCount > 0)
      && afterSince(round.documentDate, options.since))
    .map((round) => changeForRound(scopedDeal.id, round));
  const communicationChanges: DealBriefChange[] = allCommunications.flatMap((communication) => {
    return communication.facts.flatMap((fact): DealBriefChange[] => {
      if (fact.review?.state !== "CONFIRMED" || !afterSince(fact.review.createdAt, options.since)) return [];
      return [{
        id: `message-fact-reviewed:${fact.id}:${fact.review.id}`,
        type: "MESSAGE_FACTS_ADDED",
        sourceKind: "COMMUNICATION_EVIDENCE",
        timestamp: fact.review.createdAt,
        label: `${fact.label} confirmed in communication`,
        description: `${fact.presentation.value} · ${communication.subject}`,
        source: communication.source,
        priority: 3,
      }];
    });
  });
  const correctionChanges: DealBriefChange[] = corrections.map((correction) => ({
    id: `message-correction:${correction.id}`,
    type: "MESSAGE_FACT_CORRECTED",
    sourceKind: "COMMUNICATION_EVIDENCE",
    timestamp: iso(correction.createdAt),
    label: `${canonicalLabel(correction.activityFact.canonicalType ?? correction.activityFact.factType)} presentation corrected`,
    description: correction.note ?? correction.sourceMessage.subject ?? correction.activityFact.evidenceQuote,
    source: source(
      "COMMUNICATION_EVIDENCE",
      correction.sourceMessage.id,
      correction.sourceMessage.subject?.trim() || "Email",
      `/messages/${correction.sourceMessage.id}`,
      { messageId: correction.sourceMessage.id }
    ),
    priority: 3,
  }));
  const milestoneChanges: DealBriefChange[] = milestones
    .filter((milestone) => milestone.kind !== "ANALYZED")
    .map((milestone) => ({
    id: `document-milestone:${milestone.id}`,
    type: "DOCUMENT_MILESTONE",
    sourceKind: "DOCUMENT",
    timestamp: iso(milestone.occurredAt),
    label: canonicalLabel(milestone.kind),
    description: milestone.document.originalFilename,
    source: source(
      "DOCUMENT",
      milestone.document.id,
      milestone.document.originalFilename,
      `/documents/${milestone.document.id}/review`,
      { documentId: milestone.document.id }
    ),
    priority: 5,
  }));
  const documentChanges: DealBriefChange[] = inbox.items
    .filter((item) => afterSince(item.uploadedAt, options.since))
    .map((item) => ({
      id: `document-added:${item.document.id}`,
      type: "DOCUMENT_ADDED",
      sourceKind: "DOCUMENT",
      timestamp: item.uploadedAt,
      label: "Document added",
      description: item.document.originalFilename,
      source: source(
        "DOCUMENT",
        item.document.id,
        item.document.originalFilename,
        item.reviewHref,
        { documentId: item.document.id }
      ),
      priority: 4,
    }));
  const orderedChanges = [
    ...formalChanges,
    ...communicationChanges,
    ...correctionChanges,
    ...milestoneChanges,
    ...documentChanges,
  ].sort(compareRecent);
  const loadedNonAnalyzedMilestones = milestones.filter((milestone) => milestone.kind !== "ANALYZED").length;
  const changeTotal = orderedChanges.length
    + Math.max(0, correctionTotal - corrections.length)
    + Math.max(0, nonAnalyzedMilestoneTotal - loadedNonAnalyzedMilestones);
  const recentChanges = orderedChanges.slice(0, changeLimit);

  // Commercial attention is deal work: open or unresolved terms, conflicts,
  // rejected and withdrawn positions, deadlines, follow-ups, new commercial
  // evidence, and paper/communication differences.
  // Operational attention is DealWatch remediation: analysis or extraction
  // failure, plus review-queue debt. Failures stay visible under system
  // attention and are not presented as negotiation issues.
  const productAttention: DealBriefAttentionItem[] = [];
  const systemAttention: DealBriefAttentionItem[] = [];
  for (const communication of allCommunications) {
    if (communication.analysisState === "ANALYSIS_FAILED") {
      systemAttention.push({
        id: `message-failed:${communication.id}`,
        type: "MESSAGE_ANALYSIS_FAILED",
        sourceId: communication.id,
        sourceKind: "COMMUNICATION_EVIDENCE",
        label: "Message analysis failed",
        description: communication.failureReason ?? communication.subject,
        href: communication.source.href!,
        timestamp: communication.importedAt,
        category: "SYSTEM_REVIEW",
        priority: 5,
      });
    } else if (communication.reviewState === "NEEDS_FOLLOW_UP") {
      productAttention.push({
        id: `message-follow-up:${communication.id}`,
        type: "MESSAGE_FOLLOW_UP",
        sourceId: communication.id,
        sourceKind: "COMMUNICATION_EVIDENCE",
        label: "Message needs follow-up",
        description: communication.subject,
        href: communication.source.href!,
        timestamp: communication.timestamp,
        category: "PRODUCT",
        priority: 1,
      });
    } else if (communication.reviewState === "REVIEW_REQUIRED") {
      systemAttention.push({
        id: `message-review:${communication.id}`,
        type: "MESSAGE_REVIEW_REQUIRED",
        sourceId: communication.id,
        sourceKind: "COMMUNICATION_EVIDENCE",
        label: "Message requires review",
        description: communication.subject,
        href: communication.source.href!,
        timestamp: communication.timestamp,
        category: "SYSTEM_REVIEW",
        priority: 6,
      });
    }
    if (communication.actionReviewState === "PENDING") {
      systemAttention.push({
        id: `message-action-evidence:${communication.id}`,
        type: "MESSAGE_ACTION_EVIDENCE_PENDING",
        sourceId: communication.id,
        sourceKind: "COMMUNICATION_EVIDENCE",
        label: "Action evidence pending",
        description: communication.subject,
        href: communication.source.href!,
        timestamp: communication.timestamp,
        category: "SYSTEM_REVIEW",
        priority: 4,
      });
    }
    if (communication.reviewState !== "NEEDS_FOLLOW_UP") {
      const deadline = communication.facts.find((fact) => fact.factType === "DEADLINE"
        && (fact.review?.state === "CONFIRMED" || (fact.review?.state === "INCORRECT" && fact.correction)));
      if (deadline) {
        productAttention.push({
          id: `reviewed-deadline:${deadline.id}`,
          type: "REVIEWED_DEADLINE",
          sourceId: deadline.id,
          sourceKind: "COMMUNICATION_EVIDENCE",
          label: "Reviewed deadline in communication",
          description: `${deadline.presentation.value} · ${communication.subject}`,
          href: communication.source.href!,
          timestamp: communication.timestamp,
          category: "PRODUCT",
          priority: 1,
        });
      }
    }
  }
  const comparisonTermKeys = new Set<string>();
  for (const comparison of comparisons) {
    if (comparison.outcome !== "DIFFERS") continue;
    const key = `${comparison.canonicalType}:${comparison.side}`;
    if (comparisonTermKeys.has(key)) continue;
    comparisonTermKeys.add(key);
    productAttention.push({
      id: `communication-formal-difference:${key}`,
      type: "COMMUNICATION_FORMAL_DIFFERENCE",
      sourceId: comparison.communication.factId,
      sourceKind: "COMMUNICATION_EVIDENCE",
      label: `${comparison.label} differs between paper and communication`,
      description: `${comparison.formal.value} on the paper · ${comparison.communication.value} in communication`,
      href: comparison.communication.source.href!,
      timestamp: comparison.timestamp,
      category: "PRODUCT",
      priority: 2,
    });
  }
  for (const item of inbox.items) {
    if (item.processingStatus === "FAILED") {
      systemAttention.push({
        id: `document-failed:${item.document.id}`,
        type: "DOCUMENT_ANALYSIS_FAILED",
        sourceId: item.document.id,
        sourceKind: "DOCUMENT",
        label: "Document analysis failed",
        description: item.document.failureReason ?? item.document.originalFilename,
        href: item.reviewHref,
        timestamp: item.uploadedAt,
        category: "SYSTEM_REVIEW",
        priority: 5,
      });
    }
    if (item.reviewReasons.includes("NEGOTIATION_FOLLOW_UP")) {
      productAttention.push({
        id: `document-follow-up:${item.document.id}`,
        type: "NEW_COMMERCIAL_EVIDENCE",
        sourceId: item.document.id,
        sourceKind: "DOCUMENT",
        label: "Formal negotiation review needs follow-up",
        description: item.document.originalFilename,
        href: item.reviewHref,
        timestamp: item.uploadedAt,
        category: "PRODUCT",
        priority: 1,
      });
    } else if (item.processingStatus !== "FAILED" && item.reviewReasons.includes("NEGOTIATION_REVIEW_PENDING")) {
      productAttention.push({
        id: `new-commercial-evidence:${item.document.id}`,
        type: "NEW_COMMERCIAL_EVIDENCE",
        sourceId: item.document.id,
        sourceKind: "DOCUMENT",
        label: "New formal terms need consideration",
        description: item.document.originalFilename,
        href: item.reviewHref,
        timestamp: item.uploadedAt,
        category: "PRODUCT",
        priority: 4,
      });
    }
    if (item.requiresReview && item.processingStatus !== "FAILED" && item.reviewReasons.length === 0) {
      systemAttention.push({
        id: `document-review:${item.document.id}`,
        type: "DOCUMENT_REVIEW_REQUIRED",
        sourceId: item.document.id,
        sourceKind: "DOCUMENT",
        label: "Document requires review",
        description: item.document.originalFilename,
        href: item.reviewHref,
        timestamp: item.uploadedAt,
        category: "SYSTEM_REVIEW",
        priority: 6,
      });
    }
    if (item.reviewReasons.includes("UNRESOLVED_ENTITIES")) {
      systemAttention.push({
        id: `entity-review:${item.document.id}`,
        type: "ENTITY_REVIEW_REQUIRED",
        sourceId: item.document.id,
        sourceKind: "DOCUMENT",
        label: "Entity evidence requires review",
        description: `${item.entityReviewSummary.unresolved} unresolved ${item.entityReviewSummary.unresolved === 1 ? "entity" : "entities"} in ${item.document.originalFilename}`,
        href: item.reviewHref,
        timestamp: item.uploadedAt,
        category: "SYSTEM_REVIEW",
        priority: 7,
      });
    }
    if (item.reviewReasons.includes("UNRESOLVED_RELATIONSHIPS")) {
      const count = item.relationshipReviewSummary.ready + item.relationshipReviewSummary.blocked;
      systemAttention.push({
        id: `relationship-review:${item.document.id}`,
        type: "RELATIONSHIP_REVIEW_REQUIRED",
        sourceId: item.document.id,
        sourceKind: "DOCUMENT",
        label: "Relationship evidence requires review",
        description: `${count} unresolved ${count === 1 ? "relationship" : "relationships"} in ${item.document.originalFilename}`,
        href: item.reviewHref,
        timestamp: item.uploadedAt,
        category: "SYSTEM_REVIEW",
        priority: 8,
      });
    }
    if (item.reviewReasons.includes("AMBIGUOUS_PROVENANCE") || item.reviewReasons.includes("UNLOCATED_PROVENANCE")) {
      systemAttention.push({
        id: `provenance-review:${item.document.id}`,
        type: "PROVENANCE_REVIEW_REQUIRED",
        sourceId: item.document.id,
        sourceKind: "DOCUMENT",
        label: "Evidence provenance requires review",
        description: item.document.originalFilename,
        href: item.reviewHref,
        timestamp: item.uploadedAt,
        category: "SYSTEM_REVIEW",
        priority: 9,
      });
    }
  }
  for (const attachment of unpromotedAttachments) {
    systemAttention.push({
      id: `attachment-promotion:${attachment.id}`,
      type: "ATTACHMENT_PROMOTION_AVAILABLE",
      sourceId: attachment.id,
      sourceKind: "COMMUNICATION_EVIDENCE",
      label: "PDF attachment can be promoted",
      description: attachment.filename,
      href: `/messages/${attachment.sourceMessageId}`,
      timestamp: iso(attachment.createdAt),
      category: "SYSTEM_REVIEW",
      priority: 10,
    });
  }
  for (const projected of projectedTerms) {
    const attentionCopy = projected.projection.attention;
    if (!attentionCopy) continue;
    const term = projected.term;
    if (attentionCopy.type === "NEGOTIATION_UNRESOLVED"
      && (comparisonTermKeys.has(`${term.canonicalType}:TENANT`)
        || comparisonTermKeys.has(`${term.canonicalType}:LANDLORD`))) {
      continue;
    }
    productAttention.push({
      id: `negotiation-${attentionCopy.type.toLowerCase()}:${term.canonicalType}`,
      type: attentionCopy.type,
      sourceId: term.canonicalType,
      sourceKind: "FORMAL_NEGOTIATION",
      label: attentionCopy.label,
      description: attentionCopy.description,
      href: `/deals/${scopedDeal.id}/negotiation`,
      timestamp: term.lastChangedAt,
      category: "PRODUCT",
      priority: 3,
    });
  }
  productAttention.sort(compareAttention);
  systemAttention.sort(compareAttention);
  const attention = [...productAttention, ...systemAttention];

  const formalTimeline: DealBriefTimelineItem[] = negotiation.rounds.map((round) => {
    const side = round.side === "TENANT" ? "Tenant" : "Landlord";
    return {
      id: `formal:${round.id}`,
      type: "FORMAL_NEGOTIATION",
      sourceKind: "FORMAL_NEGOTIATION",
      occurredAt: round.documentDate,
      recordedAt: null,
      title: `${side} ${round.roundNumber > 1 ? "counterproposal" : "proposal"}`,
      description: `${round.documentName} · ${round.changedCount} changed · ${round.agreedCount} agreed`,
      source: formalSource(scopedDeal.id, round),
    };
  });
  const communicationTimeline: DealBriefTimelineItem[] = allCommunications.map((communication) => ({
    id: `communication:${communication.id}`,
    type: "COMMUNICATION",
    sourceKind: "COMMUNICATION_EVIDENCE",
    occurredAt: communication.timestamp,
    recordedAt: communication.importedAt,
    title: communication.subject,
    description: `${communication.sender.label} · ${communication.facts.length} ${communication.facts.length === 1 ? "fact" : "facts"} · ${canonicalLabel(communication.lifecycleState)}`,
    source: communication.source,
  }));
  // A document's `documentDate` is a calendar date from the paper, not the
  // offset-aware instant when DealWatch learned about it. Timeline catch-up
  // therefore uses the upload instant.
  const documentTimeline: DealBriefTimelineItem[] = inbox.items.map((item) => ({
    id: `document:${item.document.id}`,
    type: "DOCUMENT",
    sourceKind: "DOCUMENT",
    occurredAt: null,
    recordedAt: item.uploadedAt,
    title: item.document.originalFilename,
    description: `${canonicalLabel(item.document.documentType)} · ${canonicalLabel(item.processingStatus)}`,
    source: source("DOCUMENT", item.document.id, item.document.originalFilename, item.reviewHref, { documentId: item.document.id }),
  }));
  const timelineMilestones = options.since
    ? milestones.filter((milestone) => milestone.kind !== "ANALYZED")
    : milestones;
  const milestoneTimeline: DealBriefTimelineItem[] = timelineMilestones.map((milestone) => ({
    id: `milestone:${milestone.id}`,
    type: "DOCUMENT_REVIEW",
    sourceKind: "DOCUMENT",
    occurredAt: iso(milestone.occurredAt),
    recordedAt: iso(milestone.occurredAt),
    title: canonicalLabel(milestone.kind),
    description: milestone.document.originalFilename,
    source: source("DOCUMENT", milestone.document.id, milestone.document.originalFilename, `/documents/${milestone.document.id}/review`, { documentId: milestone.document.id }),
  }));
  const legacyTimeline: DealBriefTimelineItem[] = legacyEvents.map((event) => ({
    id: `legacy:${event.id}`,
    type: "LEGACY_ACTIVITY",
    sourceKind: "LEGACY_ACTIVITY",
    occurredAt: iso(event.occurredAt),
    recordedAt: null,
    title: canonicalLabel(event.type),
    description: event.description,
    source: source(
      "LEGACY_ACTIVITY",
      event.id,
      event.message ? `${event.message.sender} · legacy message activity` : "Legacy deal activity",
      `/deals/${scopedDeal.id}/activity`
    ),
  }));
  const orderedTimeline = [
    ...formalTimeline,
    ...communicationTimeline,
    ...documentTimeline,
    ...milestoneTimeline,
    ...legacyTimeline,
  ].filter((item) => timelineAfterSince(item, options.since)).sort(compareTimeline);
  const loadedCommunicationsAfterSince = allCommunications
    .filter((communication) => afterSince(communication.timestamp, options.since)).length;
  const availableMilestoneTotal = options.since ? nonAnalyzedMilestoneTotal : milestoneTotal;
  const timelineTotal = orderedTimeline.length
    + Math.max(0, communicationTotal - loadedCommunicationsAfterSince)
    + Math.max(0, availableMilestoneTotal - timelineMilestones.length)
    + Math.max(0, legacyTotal - legacyEvents.length);
  const timeline = orderedTimeline.slice(0, timelineLimit);

  return {
    deal: { ...scopedDeal, createdAt: iso(scopedDeal.createdAt) },
    negotiation: {
      summary: {
        termCount: negotiation.terms.length,
        openCount: countOpenFormalTerms(projectedTerms.map((item) => item.projection)),
        agreedCount: negotiation.agreedCount,
        conflictCount: negotiation.conflictCount,
        rejectedCount: negotiationTerms.filter((term) => term.briefStatus === "REJECTED").length,
        withdrawnCount: negotiationTerms.filter((term) => term.briefStatus === "WITHDRAWN").length,
        latestFormalMovementAt: negotiation.latestRound?.documentDate ?? null,
      },
      terms: negotiationTerms,
    },
    recentChanges,
    changeSummary: {
      meaningfulCount: changeTotal,
      emptyState: options.since && recentChanges.length === 0
        ? `No meaningful changes since ${options.since.toISOString()}.`
        : null,
    },
    communications,
    comparisons,
    productAttention,
    systemAttention,
    attention,
    preview: {
      attention: { returned: productAttention.length, total: productAttention.length },
      changes: { returned: recentChanges.length, total: changeTotal },
      communications: { returned: communications.length, total: communicationTotal },
      timeline: { returned: timeline.length, total: timelineTotal },
      comparisons: {
        returned: displayedComparisons(comparisons).length,
        total: displayedComparisons(comparisons).length,
      },
    },
    timeline,
    actions,
    since: options.since?.toISOString() ?? null,
    generatedAt: now.toISOString(),
  };
}
