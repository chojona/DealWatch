import { parseStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType, NegotiationSide } from "@/lib/ai/negotiation/schemas";
import { resolveCurrentState } from "@/lib/negotiation/resolveCurrentState";
import type { NegotiationRoundRecord, NegotiationTermRecord } from "@/lib/negotiation/types";
import { readActivityText, type ExtractedFact } from "./extract";
import type {
  ReconciliationActivity,
  ReconciliationExplanationCode,
  ReconciliationLink,
  ReconciliationRelationship,
  ReconciliationRound,
  ReconciliationSide,
  ReconciliationTerm,
} from "./types";

const NUMERIC_EPSILON = 1e-6;

function activityEventId(activity: ReconciliationActivity): string {
  if (activity.sourceMessageId) return `source-message:${activity.sourceMessageId}`;
  return activity.id.startsWith("deal-event:") ? activity.id : `deal-event:${activity.id}`;
}

function numbersEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < NUMERIC_EPSILON;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function negotiationSide(value: string): NegotiationSide | null {
  return value === "TENANT" || value === "LANDLORD" ? value : null;
}

function observationValue(term: ReconciliationTerm): { numeric: number | null; unit: string | null; display: string } {
  const payload = parseStructuredPayload(term.structuredPayload, term.canonicalType as CanonicalTermType);
  if (payload?.termType === "BASE_RENT" && payload.rent.kind === "simple") {
    return {
      numeric: payload.rent.amountPerRSFYear,
      unit: "USD_PER_RSF_YEAR",
        display: `$${payload.rent.amountPerRSFYear.toFixed(2)} / RSF / year`,
    };
  }
  if (payload?.termType === "TI_ALLOWANCE") {
    return {
      numeric: payload.amount.amount,
      unit: payload.amount.unit,
      display: term.normalizedValue?.trim() || String(payload.amount.amount),
    };
  }
  if (payload?.termType === "FREE_RENT" && payload.abatement.kind === "contiguous") {
    return {
      numeric: payload.abatement.months,
      unit: "MONTHS",
      display: term.normalizedValue?.trim() || `${payload.abatement.months} months`,
    };
  }
  return {
    numeric: term.normalizedNumeric,
    unit: term.normalizedUnit,
    display: term.normalizedValue?.trim() || term.rawValue,
  };
}

function toRoundRecord(round: ReconciliationRound): NegotiationRoundRecord {
  return {
    id: round.id,
    side: (negotiationSide(round.side) ?? "TENANT"),
    roundNumber: round.roundNumber,
    documentName: round.documentName,
    documentText: "",
    documentDate: round.documentDate,
    createdAt: round.createdAt,
    terms: round.terms.flatMap((term): NegotiationTermRecord[] => {
      const side = negotiationSide(term.side);
      if (!side) return [];
      return [{
        id: term.id,
        canonicalType: term.canonicalType as CanonicalTermType,
        normalizedValue: term.normalizedValue,
        normalizedNumeric: term.normalizedNumeric,
        normalizedUnit: term.normalizedUnit,
        rawValue: term.rawValue,
        status: term.status as NegotiationTermRecord["status"],
        side,
        roundNumber: round.roundNumber,
        confidence: 1,
        evidenceQuote: term.evidenceQuote,
        sourceLocation: null,
      }];
    }),
  };
}

interface IndexedObservation {
  term: ReconciliationTerm;
  round: ReconciliationRound;
  numeric: number | null;
  unit: string | null;
  display: string;
  side: NegotiationSide;
}

function indexRounds(rounds: ReconciliationRound[]) {
  const observations: IndexedObservation[] = [];
  for (const round of rounds) {
    for (const term of round.terms) {
      const side = negotiationSide(term.side);
      if (!side) continue;
      const value = observationValue(term);
      observations.push({ term, round, side, ...value });
    }
  }
  return observations;
}

function currentIds(records: NegotiationRoundRecord[], canonicalType: string): {
  ids: string[];
  bySide: Partial<Record<NegotiationSide, NegotiationTermRecord>>;
} {
  const state = resolveCurrentState(records, canonicalType as CanonicalTermType);
  const bySide: Partial<Record<NegotiationSide, NegotiationTermRecord>> = {};
  if (state.currentTenantTerm) bySide.TENANT = state.currentTenantTerm;
  if (state.currentLandlordTerm) bySide.LANDLORD = state.currentLandlordTerm;
  return {
    ids: [state.currentTenantTerm?.id, state.currentLandlordTerm?.id].filter((id): id is string => Boolean(id)),
    bySide,
  };
}

function sourceFor(activity: ReconciliationActivity): ReconciliationLink["eventSource"] {
  if (activity.sourceMessageId) {
    return {
      kind: "MESSAGE",
      messageId: activity.sourceMessageId,
      label: "Email",
      href: `/messages/${activity.sourceMessageId}`,
    };
  }
  if (activity.messageId) {
    const sender = activity.message?.sender?.trim();
    return {
      kind: "MESSAGE",
      messageId: activity.messageId,
      label: sender ? `Email · ${sender}` : "Email",
      href: null,
    };
  }
  return { kind: "MANUAL", messageId: null, label: "Recorded activity", href: null };
}

function link(input: {
  activity: ReconciliationActivity;
  fact: ExtractedFact | null;
  side: ReconciliationSide;
  canonicalType: string | null;
  relationship: ReconciliationRelationship;
  explanationCode: ReconciliationExplanationCode;
  matchedObservationIds?: string[];
  matchedRoundId?: string | null;
  currentObservationIds?: string[];
  comparedSide?: "TENANT" | "LANDLORD" | null;
  currentPosition?: ReconciliationLink["currentPosition"];
  disagreement?: ReconciliationLink["disagreement"];
}): ReconciliationLink {
  return {
    activityEventId: activityEventId(input.activity),
    eventType: input.activity.type,
    eventDate: input.activity.occurredAt.toISOString(),
    eventValue: input.fact
      ? { numeric: input.fact.numeric, unit: input.fact.unit, display: input.fact.display }
      : null,
    eventSide: input.side,
    eventSource: sourceFor(input.activity),
    canonicalType: input.canonicalType,
    relationship: input.relationship,
    matchedObservationIds: input.matchedObservationIds ?? [],
    matchedRoundId: input.matchedRoundId ?? null,
    currentObservationIds: input.currentObservationIds ?? [],
    explanationCode: input.explanationCode,
    comparedSide: input.comparedSide ?? null,
    currentPosition: input.currentPosition ?? null,
    disagreement: input.disagreement ?? null,
  };
}

function positionView(
  observation: IndexedObservation | undefined
): ReconciliationLink["currentPosition"] {
  if (!observation) return null;
  return {
    side: observation.side,
    observationId: observation.term.id,
    display: observation.display,
  };
}

function reconcileFact(
  activity: ReconciliationActivity,
  fact: ExtractedFact,
  eventSide: ReconciliationSide,
  observations: IndexedObservation[],
  records: NegotiationRoundRecord[]
): ReconciliationLink {
  const typed = observations.filter((item) => item.term.canonicalType === fact.canonicalType);
  const sided = eventSide === "UNKNOWN" ? typed : typed.filter((item) => item.side === eventSide);
  const sameUnit = sided.filter((item) => item.unit === fact.unit && item.numeric !== null);
  const incompatible = sided.filter((item) => item.unit !== null && item.unit !== fact.unit && item.numeric !== null);
  const current = currentIds(records, fact.canonicalType);
  const currentSet = new Set(current.ids);

  const equals = sameUnit.filter((item) => numbersEqual(item.numeric!, fact.numeric));
  const currentMatches = equals.filter((item) => currentSet.has(item.term.id));
  const historicalMatches = equals.filter((item) => !currentSet.has(item.term.id));

  const comparedSide = eventSide === "UNKNOWN"
    ? (currentMatches.length === 1 ? currentMatches[0].side : historicalMatches.length > 0 && historicalMatches.every((item) => item.side === historicalMatches[0].side) ? historicalMatches[0].side : null)
    : eventSide;

  const currentObservation = comparedSide ? observations.find((item) => item.term.id === current.bySide[comparedSide]?.id) : undefined;

  if (currentMatches.length > 0) {
    const sideForCurrent = currentMatches.length === 1 ? currentMatches[0].side : comparedSide;
    const currentObservationForMatch = sideForCurrent
      ? observations.find((item) => item.term.id === current.bySide[sideForCurrent]?.id) ?? currentMatches[0]
      : currentMatches[0];
    return link({
      activity,
      fact,
      side: eventSide,
      canonicalType: fact.canonicalType,
      relationship: "MATCHES_CURRENT",
      explanationCode: "MATCHES_CURRENT_OBSERVATION",
      matchedObservationIds: currentMatches.map((item) => item.term.id),
      matchedRoundId: currentMatches.length === 1 ? currentMatches[0].round.id : null,
      currentObservationIds: current.ids,
      comparedSide: currentMatches.length === 1 ? currentMatches[0].side : comparedSide,
      currentPosition: positionView(currentObservationForMatch),
    });
  }

  if (historicalMatches.length > 0) {
    const sideForHistory = historicalMatches.every((item) => item.side === historicalMatches[0].side)
      ? historicalMatches[0].side
      : comparedSide;
    const currentForSide = sideForHistory
      ? observations.find((item) => item.term.id === current.bySide[sideForHistory]?.id)
      : undefined;
    return link({
      activity,
      fact,
      side: eventSide,
      canonicalType: fact.canonicalType,
      relationship: "MATCHES_HISTORICAL",
      explanationCode: "MATCHES_HISTORICAL_OBSERVATION",
      matchedObservationIds: historicalMatches.map((item) => item.term.id),
      matchedRoundId: historicalMatches.length === 1 ? historicalMatches[0].round.id : null,
      currentObservationIds: current.ids,
      comparedSide: sideForHistory,
      currentPosition: positionView(currentForSide),
    });
  }

  if (incompatible.length > 0 && sameUnit.length === 0) {
    return link({
      activity,
      fact,
      side: eventSide,
      canonicalType: fact.canonicalType,
      relationship: "NO_NEGOTIATION_MATCH",
      explanationCode: "INCOMPATIBLE_UNITS",
      currentObservationIds: current.ids,
      comparedSide: eventSide === "UNKNOWN" ? null : eventSide,
      currentPosition: positionView(currentObservation),
    });
  }

  if (eventSide !== "UNKNOWN" && currentObservation && currentObservation.unit === fact.unit && currentObservation.numeric !== null && !numbersEqual(currentObservation.numeric, fact.numeric)) {
    return link({
      activity,
      fact,
      side: eventSide,
      canonicalType: fact.canonicalType,
      relationship: "DIFFERS_FROM_CURRENT",
      explanationCode: "DIFFERS_FROM_CURRENT_OBSERVATION",
      matchedObservationIds: [],
      matchedRoundId: null,
      currentObservationIds: current.ids,
      comparedSide: eventSide,
      currentPosition: positionView(currentObservation),
      disagreement: {
        activityDisplay: fact.display,
        observationDisplay: currentObservation.display,
        observationId: currentObservation.term.id,
        currentDisplay: currentObservation.display,
      },
    });
  }

  return link({
    activity,
    fact,
    side: eventSide,
    canonicalType: fact.canonicalType,
    relationship: "NO_NEGOTIATION_MATCH",
    explanationCode: "NO_CORRESPONDING_OBSERVATION",
    currentObservationIds: current.ids,
    comparedSide: eventSide === "UNKNOWN" ? null : eventSide,
    currentPosition: positionView(currentObservation),
  });
}

function sameDayRounds(activity: ReconciliationActivity, rounds: ReconciliationRound[], canonicalType: string): ReconciliationRound[] {
  const day = utcDay(activity.occurredAt);
  return rounds.filter((round) => utcDay(round.documentDate) === day && round.terms.some((term) => term.canonicalType === canonicalType));
}

/**
 * Compare one deal's stored activity with that deal's negotiation observations.
 * Pure and read-only: it does not choose a winner or write either source.
 */
export function reconcileDealSources(input: {
  activities: ReconciliationActivity[];
  rounds: ReconciliationRound[];
}): ReconciliationLink[] {
  const dealRounds = input.rounds;
  const records = dealRounds.map(toRoundRecord);
  const observations = indexRounds(dealRounds);
  const links: ReconciliationLink[] = [];

  for (const activity of input.activities) {
    if (activity.structuredFacts) {
      const negotiation = activity.structuredFacts.filter((fact) =>
        fact.factType === "NEGOTIATION_VALUE"
        && fact.canonicalType
        && fact.numeric != null
        && fact.unit
        && fact.display
      );
      const qualitative = activity.structuredFacts.filter((fact) =>
        fact.factType === "NEGOTIATION_VALUE" && (fact.numeric == null || !fact.unit || !fact.display)
      );
      const other = activity.structuredFacts.filter((fact) => fact.factType !== "NEGOTIATION_VALUE");
      for (const fact of negotiation) {
        links.push(reconcileFact(activity, {
          canonicalType: fact.canonicalType!,
          numeric: fact.numeric!,
          unit: fact.unit!,
          display: fact.display!,
        }, fact.side, observations, records));
      }
      for (const fact of qualitative) {
        links.push(link({
          activity,
          fact: null,
          side: fact.side,
          canonicalType: fact.canonicalType,
          relationship: "NO_NEGOTIATION_MATCH",
          explanationCode: "NO_CORRESPONDING_OBSERVATION",
        }));
      }
      if (negotiation.length === 0 && qualitative.length === 0 && other.length > 0) {
        links.push(link({
          activity,
          fact: null,
          side: other[0]?.side ?? "UNKNOWN",
          canonicalType: null,
          relationship: "NO_NEGOTIATION_MATCH",
          explanationCode: "NON_ECONOMIC_ACTIVITY",
        }));
      }
      continue;
    }

    const reading = readActivityText(activity.description, activity.evidenceQuote);
    if (reading.facts.length > 0) {
      for (const fact of reading.facts) {
        links.push(reconcileFact(activity, fact, reading.side, observations, records));
      }
      continue;
    }

    if (reading.qualitativeType) {
      const related = sameDayRounds(activity, dealRounds, reading.qualitativeType);
      const current = currentIds(records, reading.qualitativeType);
      if (related.length > 0) {
        links.push(link({
          activity,
          fact: null,
          side: reading.side,
          canonicalType: reading.qualitativeType,
          relationship: "POSSIBLE_RELATED",
          explanationCode: "POSSIBLE_SAME_DAY_MOVEMENT",
          matchedRoundId: related.length === 1 ? related[0].id : null,
          currentObservationIds: current.ids,
          comparedSide: reading.side === "UNKNOWN" ? null : reading.side,
        }));
        continue;
      }
      links.push(link({
        activity,
        fact: null,
        side: reading.side,
        canonicalType: reading.qualitativeType,
        relationship: "NO_NEGOTIATION_MATCH",
        explanationCode: "NO_CORRESPONDING_OBSERVATION",
        currentObservationIds: current.ids,
      }));
      continue;
    }

    links.push(link({
      activity,
      fact: null,
      side: reading.side,
      canonicalType: null,
      relationship: "NO_NEGOTIATION_MATCH",
      explanationCode: "NON_ECONOMIC_ACTIVITY",
    }));
  }

  return links;
}

export function linksByActivityEventId(input: {
  events: ReconciliationActivity[];
  rounds: ReconciliationRound[];
}): Map<string, ReconciliationLink[]> {
  const roundsByDeal = new Map<string, ReconciliationRound[]>();
  for (const round of input.rounds) {
    const group = roundsByDeal.get(round.dealId) ?? [];
    group.push(round);
    roundsByDeal.set(round.dealId, group);
  }
  const eventsByDeal = new Map<string, ReconciliationActivity[]>();
  for (const event of input.events) {
    const group = eventsByDeal.get(event.dealId) ?? [];
    group.push(event);
    eventsByDeal.set(event.dealId, group);
  }
  const grouped = new Map<string, ReconciliationLink[]>();
  for (const [dealId, activities] of eventsByDeal) {
    const links = reconcileDealSources({
      activities,
      rounds: roundsByDeal.get(dealId) ?? [],
    });
    for (const item of links) {
      const existing = grouped.get(item.activityEventId) ?? [];
      existing.push(item);
      grouped.set(item.activityEventId, existing);
    }
  }
  return grouped;
}
