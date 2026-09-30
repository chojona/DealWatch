import { termCountsAsOpen } from "@/lib/deals/brief/formalStatus";
import type { CanonicalTermType, NegotiationSide } from "@/lib/ai/negotiation/schemas";
import { TERM_CATALOG } from "@/lib/negotiation/termCatalog";
import { formatNumericValue } from "./formatting";
import type {
  NegotiationMovementView,
  NegotiationObservationView,
  NegotiationPositionView,
  NegotiationRoundChangeView,
  NegotiationTermView,
} from "./types";

const significance = new Map(TERM_CATALOG.map((item) => [item.type, item.significance]));

const ACTIVE = new Set(["PROPOSED", "AGREED", "UNRESOLVED", "REJECTED"]);

/** Companion facts already stored as their own agreed terms. */
const COMPANION_TERMS: Record<string, CanonicalTermType> = {
  Escalation: "ANNUAL_ESCALATION",
  Structure: "RENT_STRUCTURE",
};

export interface SideStep {
  side: NegotiationSide;
  previous: string;
  current: string;
  delta: string | null;
}

export interface GapClosure {
  display: string;
  widened: boolean;
}

export function positionSummary(position: NegotiationPositionView | null): string | null {
  if (!position) return null;
  if (position.kind === "CONFLICT") return position.label;
  return position.value.summary;
}

export function roundChangeLine(change: NegotiationRoundChangeView): string {
  if (change.kind === "AGREED") return `${change.label}: ${change.currentValue} agreed`;
  if (change.previousValue && change.previousValue !== change.currentValue) {
    return `${change.label}: ${change.previousValue} → ${change.currentValue}`;
  }
  return `${change.label}: ${change.currentValue}`;
}

function observationsForSide(term: NegotiationTermView, side: NegotiationSide): NegotiationObservationView[] {
  return term.history.filter((item) => item.side === side && ACTIVE.has(item.status));
}

export function sideStep(term: NegotiationTermView, side: NegotiationSide): SideStep | null {
  const observations = observationsForSide(term, side);
  const current = observations.at(-1);
  if (!current) return null;
  const previous = observations
    .slice(0, -1)
    .findLast((item) => item.value.summary !== current.value.summary);
  if (!previous) return null;
  return {
    side,
    previous: previous.value.summary,
    current: current.value.summary,
    delta: numericDelta(term.movement, side),
  };
}

function numericDelta(movement: NegotiationMovementView, side: NegotiationSide): string | null {
  if (movement.kind !== "NUMERIC" || movement.side !== side) return null;
  if (movement.from === null || movement.to === null || movement.amount === null || !movement.unit) return null;
  const sign = movement.to > movement.from ? "+" : "−";
  return `${sign}${formatNumericValue(movement.amount, movement.unit)}`;
}

export function sideSteps(term: NegotiationTermView): SideStep[] {
  return (["TENANT", "LANDLORD"] as const)
    .map((side) => sideStep(term, side))
    .filter((step): step is SideStep => step !== null);
}

/**
 * Total gap closure is shown only when both sides have a stored numeric
 * movement in the same unit as the current gap. Summary text is not parsed.
 */
export function gapClosure(term: NegotiationTermView): GapClosure | null {
  if (!term.numericGap || term.numericGap.value === 0) return null;
  const movement = term.movement;
  if (
    movement.kind !== "NUMERIC"
    || movement.from === null
    || movement.to === null
    || movement.unit !== term.numericGap.unit
    || movement.side === null
  ) {
    return null;
  }
  const other = movement.side === "TENANT" ? "LANDLORD" : "TENANT";
  const otherStep = sideStep(term, other);
  if (!otherStep) return null;
  const otherFrom = numberMatchingUnit(otherStep.previous, movement.unit);
  const otherTo = numberMatchingUnit(otherStep.current, movement.unit);
  if (otherFrom === null || otherTo === null) return null;
  const tenantFrom = movement.side === "TENANT" ? movement.from : otherFrom;
  const landlordFrom = movement.side === "LANDLORD" ? movement.from : otherFrom;
  const tenantTo = movement.side === "TENANT" ? movement.to : otherTo;
  const landlordTo = movement.side === "LANDLORD" ? movement.to : otherTo;
  const opened = Math.abs(landlordFrom - tenantFrom);
  const closed = Math.abs(landlordTo - tenantTo);
  const change = opened - closed;
  if (change === 0) return null;
  return {
    display: formatNumericValue(Math.abs(change), movement.unit),
    widened: change < 0,
  };
}

function numberMatchingUnit(summary: string, unit: string): number | null {
  const match = summary.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replaceAll(",", ""));
  if (!Number.isFinite(value)) return null;
  const formatted = formatNumericValue(value, unit);
  if (summary !== formatted && !summary.startsWith(formatted)) return null;
  return value;
}

export type OpenTermTreatment = "rail" | "pair" | "prose";

export function openTermTreatment(term: NegotiationTermView): OpenTermTreatment {
  if (term.canonicalType === "COMMENCEMENT_DATE") return "prose";
  const tenant = positionSummary(term.tenantPosition);
  const landlord = positionSummary(term.landlordPosition);
  if (tenant && landlord && tenant === landlord && !(term.numericGap && term.numericGap.value > 0)) return "prose";
  if (term.conflict || term.tenantPosition?.kind === "CONFLICT" || term.landlordPosition?.kind === "CONFLICT") {
    return "pair";
  }
  if (term.numericGap && term.numericGap.value > 0 && term.tenantPosition?.kind === "VALUE" && term.landlordPosition?.kind === "VALUE") {
    return "rail";
  }
  return "pair";
}

/** Relation words already stored on the term. Visual labels such as Opposed are not invented. */
export function storedRelation(term: NegotiationTermView): string | null {
  if (term.conflict) return "Conflict";
  switch (term.status) {
    case "AGREED":
      return "Agreed";
    case "REJECTED":
      return "Rejected";
    case "UNRESOLVED":
      return "Unresolved";
    case "WITHDRAWN":
      return "Withdrawn";
    case "PROPOSED":
      return "Proposed";
    case "NOT_MENTIONED":
      return "Not mentioned";
    default:
      return null;
  }
}

export function agreedSummary(terms: NegotiationTermView[]): Array<{ type: CanonicalTermType; label: string; summary: string }> {
  return terms
    .filter((term) => term.status === "AGREED")
    .map((term) => ({
      type: term.canonicalType,
      label: term.label,
      summary: positionSummary(term.agreedPosition) ?? positionSummary(term.tenantPosition) ?? positionSummary(term.landlordPosition) ?? term.label,
    }));
}

export function decisionCopy(terms: NegotiationTermView[]): { sentence: string; support: string | null } {
  const open = terms.filter((term) => termCountsAsOpen(term));
  const comparable = open
    .filter((term) => openTermTreatment(term) === "rail" && term.numericGap)
    .sort((a, b) => (significance.get(b.canonicalType) ?? 0) - (significance.get(a.canonicalType) ?? 0));
  const focus = comparable[0];
  if (!focus?.numericGap) {
    if (open.length === 0) {
      return { sentence: "No open terms are stored.", support: null };
    }
    return {
      sentence: open.length === 1 ? "1 term is still open." : `${open.length} terms are still open.`,
      support: null,
    };
  }
  const others = open.filter((term) => term.canonicalType !== focus.canonicalType).length;
  const agreedEscalation = terms.find((term) => term.canonicalType === "ANNUAL_ESCALATION" && term.status === "AGREED");
  const escalationSummary = agreedEscalation
    ? positionSummary(agreedEscalation.agreedPosition) ?? positionSummary(agreedEscalation.tenantPosition)
    : null;
  const parts = [
    escalationSummary ? `Annual escalation is agreed at ${escalationSummary}.` : null,
    others === 0 ? null : others === 1 ? "1 other term is still open." : `${others} other terms are still open.`,
  ].filter(Boolean);
  return {
    sentence: `${focus.label} is ${focus.numericGap.display} apart.`,
    support: parts.length > 0 ? parts.join(" ") : null,
  };
}

export function settledCompanions(term: NegotiationTermView, terms: NegotiationTermView[]): string[] {
  const positions = [term.tenantPosition, term.landlordPosition].filter((position) => position?.kind === "VALUE");
  const lines: string[] = [];
  for (const position of positions) {
    if (!position || position.kind !== "VALUE") continue;
    for (const detail of position.value.details) {
      const companionType = COMPANION_TERMS[detail.label];
      if (!companionType || companionType === term.canonicalType) continue;
      const companion = terms.find((item) => item.canonicalType === companionType && item.status === "AGREED");
      if (!companion) continue;
      const summary = positionSummary(companion.agreedPosition) ?? positionSummary(companion.tenantPosition);
      if (!summary) continue;
      const line = `${detail.label} is already agreed at ${summary}.`;
      if (!lines.includes(line)) lines.push(line);
    }
  }
  return lines;
}

export function currentFormalObservations(term: NegotiationTermView): NegotiationObservationView[] {
  const ids = new Set<string>();
  for (const position of [term.tenantPosition, term.landlordPosition, term.agreedPosition]) {
    if (!position || position.kind === "CONFLICT") continue;
    for (const id of position.observationIds) ids.add(id);
  }
  return term.history.filter((item) => ids.has(item.id) && item.formalReview?.state !== "REJECTED");
}

export function proseStatement(term: NegotiationTermView): string | null {
  const tenant = positionSummary(term.tenantPosition);
  const landlord = positionSummary(term.landlordPosition);
  if (tenant && landlord && tenant === landlord) {
    return `${term.label}. Both sides name ${tenant}. The term is ${term.status === "UNRESOLVED" ? "unresolved" : term.status.toLowerCase().replaceAll("_", " ")}.`;
  }
  return null;
}
