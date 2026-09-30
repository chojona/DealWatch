import type { Prisma, PrismaClient } from "@prisma/client";
import { buildDealEvidenceComparisons } from "@/lib/deals/brief/comparison";
import type {
  DealBriefCommunication,
  DealBriefNegotiationTerm,
  DealBriefSourceRef,
} from "@/lib/deals/brief/types";
import { effectiveActivityFact } from "@/lib/messages/effective";
import { canonicalLabel } from "@/lib/messages/facts";
import { factsFromLatestRun } from "@/lib/messages/latestRun";
import { actionEvidenceReviewState } from "@/lib/messages/state";
import {
  formalPositionFullyRejected,
  projectFormalBriefStatus,
  termCountsAsOpen,
} from "@/lib/deals/brief/formalStatus";
import { currentFormalObservation, getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import type { NegotiationPositionView, NegotiationRoundView } from "@/lib/negotiation/intelligence/types";
import { deriveDealActionState, type ActionFactInput } from "./derive";
import type { DealActionState, DealDiscrepancySignal, DealPreparationTerm } from "./types";

export interface DealActionOptions {
  expectedWorkspaceId?: string;
  now?: Date;
}

const messageSelect = {
  id: true,
  workspaceId: true,
  dealId: true,
  subject: true,
  sentAt: true,
  receivedAt: true,
  createdAt: true,
  participants: {
    select: { role: true, displayName: true, address: true },
    orderBy: [{ role: "asc" }, { address: "asc" }],
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
            select: { id: true, structuredPayload: true, note: true, createdAt: true },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.SourceMessageSelect;

type ActionMessageRow = Prisma.SourceMessageGetPayload<{ select: typeof messageSelect }>;

function iso(value: Date): string {
  return value.toISOString();
}

function occurredAt(message: ActionMessageRow): Date {
  return message.sentAt ?? message.receivedAt ?? message.createdAt;
}

function source(kind: DealBriefSourceRef["kind"], id: string, label: string, href: string | null): DealBriefSourceRef {
  return { kind, id, label, href };
}

function formalSource(dealId: string, round: NegotiationRoundView): DealBriefSourceRef {
  return {
    kind: "FORMAL_NEGOTIATION",
    id: round.id,
    label: round.documentName,
    href: round.documentHref ?? `/deals/${dealId}/negotiation?round=${round.id}`,
    documentId: round.documentId,
    negotiationRoundId: round.id,
  };
}

function positionSummary(position: NegotiationPositionView | null): string | null {
  if (!position) return null;
  if (position.kind === "CONFLICT") return "Conflicting formal evidence";
  return position.value.summary;
}

function presentCommunication(message: ActionMessageRow): DealBriefCommunication {
  const facts = factsFromLatestRun(message.facts);
  const timestamp = occurredAt(message);
  const actionReviewState = actionEvidenceReviewState(facts);
  return {
    id: message.id,
    timestamp: iso(timestamp),
    importedAt: iso(message.createdAt),
    sender: { name: null, address: null, label: "Sender" },
    participants: message.participants,
    subject: message.subject?.trim() || "Email",
    sourceType: "FIXTURE",
    analysisState: "ANALYZED",
    reviewState: "REVIEWED",
    actionReviewState,
    evidenceSettled: actionReviewState !== "PENDING",
    lifecycleState: actionReviewState === "PENDING" ? "REVIEW_REQUIRED" : "REVIEWED",
    failureReason: null,
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
    source: source("COMMUNICATION_EVIDENCE", message.id, message.subject?.trim() || "Email", `/messages/${message.id}`),
  };
}

function actionFacts(message: ActionMessageRow): ActionFactInput[] {
  const timestamp = iso(occurredAt(message));
  const subject = message.subject?.trim() || "Email";
  return factsFromLatestRun(message.facts).map((fact) => {
    const effective = effectiveActivityFact(fact);
    const reviewed = effective.review?.state === "CONFIRMED"
      || (effective.review?.state === "INCORRECT" && Boolean(effective.correction));
    return {
      id: fact.id,
      messageId: message.id,
      factType: fact.factType,
      assertionStatus: fact.assertionStatus,
      evidenceQuote: fact.evidenceQuote,
      timestamp,
      subject,
      href: `/messages/${message.id}`,
      display: effective.presentationValue.display,
      participants: message.participants,
      reviewed,
      payload: effective.presentationPayload,
    };
  });
}

/**
 * Read-only action intelligence. This function performs no writes and no model calls.
 */
export async function getDealActionState(
  db: PrismaClient,
  dealId: string,
  options: DealActionOptions = {}
): Promise<DealActionState | null> {
  const now = options.now ?? new Date();
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { id: true, workspaceId: true },
  });
  if (!deal || (options.expectedWorkspaceId && deal.workspaceId !== options.expectedWorkspaceId)) return null;

  const [negotiation, messages] = await Promise.all([
    getNegotiationWorkspace(db, deal.id),
    db.sourceMessage.findMany({
      where: { workspaceId: deal.workspaceId, dealId: deal.id },
      orderBy: [{ sentAt: "asc" }, { receivedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: messageSelect,
    }),
  ]);
  if (!negotiation) return null;

  const roundById = new Map(negotiation.rounds.map((round) => [round.id, round]));
  const terms: DealBriefNegotiationTerm[] = negotiation.terms.map((term) => {
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
      source: round ? formalSource(deal.id, round) : null,
      provenance: {
        observationIds: term.sourceObservationIds,
        evidenceHref: latestEvidence?.href ?? null,
        evidenceLabel: latestEvidence?.sourceLabel ?? null,
        evidenceQuote: latestEvidence?.quote ?? null,
        pageLabel: latestEvidence?.pageLabel ?? null,
        provenanceStatus: latestEvidence?.provenanceStatus ?? null,
        formalReviewState: latestHistory?.formalReview?.state ?? null,
      },
    };
  });
  const communications = messages.map(presentCommunication);
  const comparisons = buildDealEvidenceComparisons({ terms, communications });
  const openCanonicalTypes = new Set(
    negotiation.terms.filter((term) => termCountsAsOpen(term)).map((term) => term.canonicalType)
  );
  const openTerms: DealPreparationTerm[] = terms
    .filter((term) => openCanonicalTypes.has(term.canonicalType))
    .map((term) => ({
      canonicalType: term.canonicalType,
      label: term.label,
      status: term.status,
      summary: [
        positionSummary(term.agreedPosition),
        term.tenantPosition ? `Tenant ${positionSummary(term.tenantPosition)}` : null,
        term.landlordPosition ? `Landlord ${positionSummary(term.landlordPosition)}` : null,
      ].filter((value): value is string => Boolean(value)).join(" · "),
      href: term.provenance.evidenceHref ?? term.source?.href ?? `/deals/${deal.id}/negotiation`,
    }));
  const termStatus = new Map(terms.map((term) => [term.canonicalType, term.status]));
  const discrepancies: DealDiscrepancySignal[] = comparisons
    .filter((comparison) => comparison.outcome === "DIFFERS" && termStatus.get(comparison.canonicalType) !== "AGREED")
    .map((comparison) => ({
      id: comparison.id,
      canonicalType: comparison.canonicalType,
      label: comparison.label,
      formalValue: comparison.formal.value,
      communicationValue: comparison.communication.value,
      href: comparison.communication.source.href,
      priority: "PAPER_COMMUNICATION_DISCREPANCY" as const,
    }));
  const facts = messages.flatMap(actionFacts);
  const changes = [
    ...negotiation.rounds
      .filter((round) => round.changedCount > 0 || round.agreedCount > 0)
      .map((round) => ({
        id: `formal:${round.id}`,
        timestamp: round.documentDate,
        label: `${round.side === "TENANT" ? "Tenant" : "Landlord"} proposal · ${round.documentName}`,
        href: round.documentHref ?? `/deals/${deal.id}/negotiation?round=${round.id}`,
      })),
    ...facts.filter((fact) => fact.reviewed).map((fact) => ({
      id: `communication:${fact.id}`,
      timestamp: fact.timestamp,
      label: fact.display || fact.evidenceQuote,
      href: fact.href,
    })),
  ];

  return deriveDealActionState({
    facts,
    openTerms,
    changes,
    discrepancies,
    now,
  });
}
