import { comparableNegotiationValue } from "@/lib/deals/reconciliation/value";
import type { NegotiationPositionView } from "@/lib/negotiation/intelligence/types";
import type {
  DealBriefCommunication,
  DealBriefCommunicationFact,
  DealBriefNegotiationTerm,
  DealBriefSourceRef,
  DealEvidenceComparison,
  DealEvidenceComparisonReason,
} from "./types";

const NUMERIC_EPSILON = 1e-6;

function formalSource(term: DealBriefNegotiationTerm): DealBriefSourceRef | null {
  if (!term.source) return null;
  return {
    ...term.source,
    href: term.provenance.evidenceHref ?? term.source.href,
    label: term.provenance.evidenceLabel ?? term.source.label,
  };
}

function positionFor(
  term: DealBriefNegotiationTerm,
  side: DealEvidenceComparison["side"]
): NegotiationPositionView | null {
  if (term.status === "AGREED" && term.agreedPosition) return term.agreedPosition;
  if (side === "TENANT") return term.tenantPosition;
  if (side === "LANDLORD") return term.landlordPosition;
  return null;
}

function notComparableReason(fact: DealBriefCommunicationFact): DealEvidenceComparisonReason | null {
  if (!fact.review) return "UNREVIEWED_COMMUNICATION";
  if (fact.review.state === "SUPERSEDED") return "SUPERSEDED_COMMUNICATION";
  if (fact.review.state === "INCORRECT" && !fact.correction) return "CORRECTION_MISSING";
  if (fact.review.state !== "CONFIRMED" && fact.review.state !== "INCORRECT") {
    return "UNREVIEWED_COMMUNICATION";
  }
  return null;
}

function comparisonFor(
  term: DealBriefNegotiationTerm | undefined,
  communication: DealBriefCommunication,
  fact: DealBriefCommunicationFact
): DealEvidenceComparison {
  const communicationValue = fact.presentation;
  const stored = fact.correction?.value ?? fact.raw.value;
  const side = fact.side === "TENANT" || fact.side === "LANDLORD" ? fact.side : "UNKNOWN";
  const position = term ? positionFor(term, side) : null;
  const source = term ? formalSource(term) : null;
  const base: Omit<DealEvidenceComparison, "outcome" | "reason"> = {
    id: `paper-communication:${fact.id}`,
    canonicalType: fact.canonicalType!,
    label: term?.label ?? fact.label,
    side,
    timestamp: communication.timestamp,
    formal: {
      value: position?.kind === "VALUE" ? position.value.summary : null,
      numeric: null,
      unit: null,
      observationIds: position?.observationIds ?? [],
      source,
    },
    communication: {
      factId: fact.id,
      value: communicationValue.value,
      numeric: stored.numeric,
      unit: stored.unit,
      reviewed: false,
      corrected: communicationValue.corrected,
      source: communication.source,
    },
  };

  const reviewReason = notComparableReason(fact);
  if (reviewReason) {
    return { ...base, outcome: "NOT_COMPARABLE", reason: reviewReason };
  }
  base.communication.reviewed = true;
  if (side === "UNKNOWN") {
    return { ...base, outcome: "NOT_COMPARABLE", reason: "UNKNOWN_SIDE" };
  }
  if (!term || !position) {
    return { ...base, outcome: "NOT_COMPARABLE", reason: "FORMAL_POSITION_MISSING" };
  }
  if (position.kind === "CONFLICT") {
    return { ...base, outcome: "NOT_COMPARABLE", reason: "FORMAL_POSITION_CONFLICT" };
  }

  const formalValue = comparableNegotiationValue({
    canonicalType: term.canonicalType,
    structuredPayload: position.structuredPayload,
    display: position.value.summary,
  });
  if (!formalValue || stored.numeric == null || !stored.unit) {
    return { ...base, outcome: "NOT_COMPARABLE", reason: "VALUE_NOT_SCALAR" };
  }
  base.formal.numeric = formalValue.numeric;
  base.formal.unit = formalValue.unit;
  if (formalValue.unit !== stored.unit) {
    return { ...base, outcome: "NOT_COMPARABLE", reason: "UNIT_MISMATCH" };
  }
  const matches = Math.abs(formalValue.numeric - stored.numeric) < NUMERIC_EPSILON;
  return {
    ...base,
    outcome: matches ? "MATCH" : "DIFFERS",
    reason: matches ? "EXACT_VALUE_MATCH" : "EXACT_VALUE_DIFFERENCE",
  };
}

/**
 * Read-time paper/communication comparison. It consumes the already assembled
 * brief inputs and never changes either source or invokes the resolver.
 */
export function buildDealEvidenceComparisons(input: {
  terms: DealBriefNegotiationTerm[];
  communications: DealBriefCommunication[];
}): DealEvidenceComparison[] {
  const terms = new Map(input.terms.map((term) => [term.canonicalType, term]));
  return input.communications
    .flatMap((communication) => communication.facts
      .filter((fact) => fact.factType === "NEGOTIATION_VALUE" && fact.canonicalType)
      .map((fact) => comparisonFor(terms.get(fact.canonicalType!), communication, fact)))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id));
}
