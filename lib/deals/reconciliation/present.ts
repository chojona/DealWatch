import type { ReconciliationLink, ReconciliationRelationship, SourceChronology, SourceChronologyEntry } from "./types";

const BADGE: Record<ReconciliationRelationship, string> = {
  MATCHES_CURRENT: "Current position",
  MATCHES_HISTORICAL: "Historical position",
  POSSIBLE_RELATED: "Related negotiation",
  DIFFERS_FROM_CURRENT: "Different from current",
  NO_NEGOTIATION_MATCH: "Activity only",
};

export function reconciliationBadge(relationship: ReconciliationRelationship): string {
  return BADGE[relationship];
}

export function primaryReconciliation(links: ReconciliationLink[]): ReconciliationLink | null {
  if (links.length === 0) return null;
  const rank: Record<ReconciliationRelationship, number> = {
    DIFFERS_FROM_CURRENT: 0,
    MATCHES_HISTORICAL: 1,
    MATCHES_CURRENT: 2,
    POSSIBLE_RELATED: 3,
    NO_NEGOTIATION_MATCH: 4,
  };
  return [...links].sort((left, right) => {
    const byRank = rank[left.relationship] - rank[right.relationship];
    if (byRank !== 0) return byRank;
    if (left.canonicalType === "BASE_RENT") return -1;
    if (right.canonicalType === "BASE_RENT") return 1;
    return left.canonicalType?.localeCompare(right.canonicalType ?? "") ?? 0;
  })[0];
}

function sideLabel(side: string | null | undefined): string {
  if (side === "TENANT") return "tenant";
  if (side === "LANDLORD") return "landlord";
  return "stored";
}

export function reconciliationSummary(link: ReconciliationLink): string | null {
  const side = sideLabel(link.comparedSide ?? link.currentPosition?.side);
  if (link.explanationCode === "MATCHES_CURRENT_OBSERVATION") {
    if (link.eventSide === "UNKNOWN") {
      return `This value corresponds to the current ${side} position. The activity does not record an authoring side.`;
    }
    return `This matches the current ${side} position.`;
  }
  if (link.explanationCode === "MATCHES_HISTORICAL_OBSERVATION") {
    const current = link.currentPosition ? ` Current ${side} position: ${link.currentPosition.display}.` : "";
    return `This matches a prior ${side} proposal.${current}`;
  }
  if (link.explanationCode === "DIFFERS_FROM_CURRENT_OBSERVATION") {
    return "Source values differ";
  }
  if (link.explanationCode === "POSSIBLE_SAME_DAY_MOVEMENT") {
    return "Possible correspondence with negotiation activity on the same date. Stored text does not support numeric equivalence.";
  }
  if (link.explanationCode === "INCOMPATIBLE_UNITS") {
    return "These amounts use incompatible units and were not treated as the same value.";
  }
  return null;
}

export function chronologyRelationshipLabel(relationship: ReconciliationRelationship): string {
  if (relationship === "DIFFERS_FROM_CURRENT") return "Different from formal negotiation history";
  return BADGE[relationship];
}

export function eventTypeLabel(type: string): string {
  const sentence = type.toLowerCase().replaceAll("_", " ");
  return sentence.replace(/^./, (letter) => letter.toUpperCase());
}

export interface ChronologyObservation {
  id: string;
  roundId: string;
  roundName: string;
  roundDate: string;
  side: "TENANT" | "LANDLORD";
  valueDisplay: string;
  href: string | null;
  sourceLabel: string;
}

export function buildSourceChronology(input: {
  observations: ChronologyObservation[];
  links: ReconciliationLink[];
  canonicalType: string;
  currentTenant: string | null;
  currentLandlord: string | null;
}): SourceChronology {
  const related = input.links.filter((item) =>
    item.canonicalType === input.canonicalType && item.relationship !== "NO_NEGOTIATION_MATCH"
  );
  const fromRounds: SourceChronologyEntry[] = input.observations.map((observation) => ({
    occurredAt: observation.roundDate,
    sourceKind: "NEGOTIATION_ROUND",
    sourceLabel: observation.sourceLabel || observation.roundName,
    side: observation.side,
    statement: `${observation.side === "TENANT" ? "Tenant" : "Landlord"} proposed ${observation.valueDisplay}`,
    valueDisplay: observation.valueDisplay,
    roundId: observation.roundId,
    activityEventId: null,
    href: observation.href,
    relationship: null,
    reviewedValueDisplay: null,
  }));
  const fromActivity: SourceChronologyEntry[] = related.map((item) => {
    const actor = item.eventSide === "TENANT" ? "Tenant" : item.eventSide === "LANDLORD" ? "Landlord" : "Activity";
    const verb = /COUNTER/i.test(item.eventType) ? "countered" : "recorded";
    const value = item.eventValue?.display;
    const email = item.eventSource.kind === "MESSAGE" && Boolean(item.eventSource.href);
    return {
      occurredAt: item.eventDate,
      sourceKind: "DEAL_ACTIVITY",
      sourceLabel: item.eventSource.kind === "MESSAGE" ? "Email" : item.eventSource.label,
      side: item.eventSide,
      statement: email
        ? (item.reviewedValue?.display ? `Email extraction: ${value ?? "—"} · Reviewed value: ${item.reviewedValue.display}` : (value ?? `${actor} recorded related activity`))
        : value
          ? `${actor} ${verb} ${value}`
          : `${actor} ${verb} related ${input.canonicalType.toLowerCase().replaceAll("_", " ")} activity`,
      valueDisplay: value ?? null,
      roundId: null,
      activityEventId: item.activityEventId,
      href: item.eventSource.href,
      relationship: item.relationship,
      reviewedValueDisplay: item.reviewedValue?.display ?? null,
    };
  });
  const entries = [...fromRounds, ...fromActivity].sort((left, right) => {
    const byDate = left.occurredAt.localeCompare(right.occurredAt);
    if (byDate !== 0) return byDate;
    if (left.sourceKind !== right.sourceKind) return left.sourceKind === "DEAL_ACTIVITY" ? -1 : 1;
    return left.sourceLabel.localeCompare(right.sourceLabel);
  });
  return {
    entries,
    current: { tenant: input.currentTenant, landlord: input.currentLandlord },
  };
}
