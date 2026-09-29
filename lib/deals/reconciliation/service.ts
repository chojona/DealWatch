import type { PrismaClient } from "@prisma/client";
import { eventFactsByEventId, linkedLegacyEventIds, loadDealMessageSources, messageActivities, structuredFactsForEvent } from "@/lib/messages/load";
import { linksByActivityEventId } from "./reconcile";
import type { DealReconciliation, ReconciliationRound, ReconciliationTerm } from "./types";
import { factsFromLatestRun } from "@/lib/messages/latestRun";
import { effectiveActivityFact } from "@/lib/messages/effective";
import { reviewedReconciliationForFact } from "@/lib/messages/reviewedReconciliation";

export async function getDealReconciliation(
  db: PrismaClient,
  dealId: string
): Promise<DealReconciliation | null> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { id: true, workspaceId: true },
  });
  if (!deal) return null;

  const [events, rounds, sources] = await Promise.all([
    db.dealEvent.findMany({
      where: { dealId: deal.id, deal: { workspaceId: deal.workspaceId } },
      include: { message: { select: { sender: true, sentAt: true } } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    db.negotiationRound.findMany({
      where: { dealId: deal.id, deal: { workspaceId: deal.workspaceId } },
      include: {
        terms: {
          include: { documentPage: { select: { pageNumber: true } } },
          orderBy: [{ canonicalType: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }],
    }),
    loadDealMessageSources(db, deal.workspaceId, [deal.id]),
  ]);
  const coveredEvents = linkedLegacyEventIds(sources.messages);
  const factsForEvent = eventFactsByEventId(sources.eventFacts);

  const mappedRounds: ReconciliationRound[] = rounds.map((round) => ({
    id: round.id,
    dealId: round.dealId,
    side: round.side,
    roundNumber: round.roundNumber,
    documentName: round.documentName,
    documentDate: round.documentDate,
    createdAt: round.createdAt,
    sourceType: round.sourceType,
    documentId: round.documentId,
    terms: round.terms.map((term): ReconciliationTerm => ({
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
  }));

  const grouped = linksByActivityEventId({
    events: [
      ...messageActivities(sources.messages),
      ...events.filter((event) => !coveredEvents.has(event.id)).map((event) => ({
        id: event.id,
        dealId: event.dealId,
        type: event.type,
        description: event.description,
        evidenceQuote: event.evidenceQuote,
        occurredAt: event.occurredAt,
        messageId: event.messageId,
        message: event.message,
        structuredFacts: structuredFactsForEvent(factsForEvent.get(event.id) ?? []),
      })),
    ],
    rounds: mappedRounds,
  });

  const links = [...grouped.values()].flat().map((link) => {
    const messageId = link.eventSource.messageId;
    if (!messageId) return link;
    const message = sources.messages.find((item) => item.id === messageId);
    if (!message) return link;
    const fact = factsFromLatestRun(message.facts).find((item) => {
      if (item.canonicalType !== link.canonicalType || item.side !== link.eventSide) return false;
      const numeric = typeof item.structuredPayload === "object" && item.structuredPayload && "numeric" in item.structuredPayload ? (item.structuredPayload as { numeric?: unknown }).numeric : null;
      return link.eventValue?.numeric == null || numeric === link.eventValue.numeric;
    });
    if (!fact) return link;
    const effective = effectiveActivityFact(fact);
    if (!effective.correction) return link;
    const reviewed = reviewedReconciliationForFact(link, effective.correction.payload);
    return { ...link, reviewedValue: effective.correction.value, reviewedRelationship: reviewed?.relationship ?? null };
  });
  return {
    dealId: deal.id,
    workspaceId: deal.workspaceId,
    links,
  };
}
