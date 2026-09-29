import type { Prisma } from "@prisma/client";
import { parseStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType, NegotiationSide, NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";
import { effectiveFormalTerm, type FormalReviewSnapshot } from "@/lib/negotiation/formalReview";
import { chronologicalRounds, currentPositionForSide } from "@/lib/negotiation/resolveCurrentState";
import type { TermWithPayload } from "@/lib/negotiation/resolveStructuredState";
import { TERM_LABELS } from "@/lib/negotiation/termCatalog";
import type { NegotiationRoundRecord } from "@/lib/negotiation/types";
import { activityEvidenceSupport, type ActivityEvidenceObservation } from "./documents";
import type { ActivityEntityRef, ActivityEvent, ActivityStructuredDetail, ActivityTermDetail } from "./types";

export interface ActivityNegotiationTerm extends ActivityEvidenceObservation {
  canonicalType: string;
  normalizedValue: string | null;
  normalizedNumeric: number | null;
  normalizedUnit: string | null;
  rawValue: string;
  status: string;
  side: string;
  roundNumber: number;
  confidence: number;
  structuredPayload: Prisma.JsonValue | null;
}

export interface ActivityNegotiationRound {
  id: string;
  dealId: string;
  side: string;
  roundNumber: number;
  documentName: string;
  documentText: string;
  documentDate: Date;
  sourceType: string;
  documentId: string | null;
  createdAt: Date;
  deal: { id: string; name: string };
  document: { id: string; originalFilename: string; documentType: string; documentDate: Date | null } | null;
  terms: ActivityNegotiationTerm[];
}

function displayValue(term: ActivityNegotiationTerm): string {
  return term.normalizedValue?.trim() || term.rawValue;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function structuredDetail(term: ActivityNegotiationTerm): ActivityStructuredDetail | undefined {
  const payload = parseStructuredPayload(term.structuredPayload, term.canonicalType as CanonicalTermType);
  if (!payload) return undefined;
  if (payload.termType === "BASE_RENT" && payload.rent.kind === "stepped") {
    return { kind: "RENT_SCHEDULE", rows: payload.rent.steps.map((step) => ({ label: `Months ${step.startMonth}–${step.endMonth}`, value: `${money(step.amountPerRSFYear)}/RSF/year` })) };
  }
  if (payload.termType === "FREE_RENT" && payload.abatement.kind === "irregular") {
    return { kind: "FREE_RENT_SCHEDULE", rows: payload.abatement.periods.map((period) => ({ label: `Months ${period.startMonth}–${period.endMonth}`, value: period.abatementType === "PARTIAL" ? `${period.partialPct ?? 0}% abatement` : "Full abatement" })) };
  }
  if (payload.termType === "RENEWAL_OPTIONS") {
    return { kind: "RENEWAL_OPTIONS", rows: payload.options.map((option) => ({ label: `Option ${option.optionNumber}`, value: `${option.durationMonths} months · ${option.pricingMethod.toLowerCase().replaceAll("_", " ")}${option.pricingValue ? ` · ${option.pricingValue}` : ""}` })) };
  }
  if (payload.termType === "TERMINATION_RIGHTS") {
    if (!payload.right) return { kind: "TERMINATION_RIGHT", rows: [{ label: "Right", value: "None stated / rejected" }] };
    return { kind: "TERMINATION_RIGHT", rows: [
      ...(payload.right.eligibleAfterYear ? [{ label: "Eligible", value: `After lease year ${payload.right.eligibleAfterYear}` }] : []),
      ...(payload.right.eligibleAfterMonth ? [{ label: "Eligible", value: `After lease month ${payload.right.eligibleAfterMonth}` }] : []),
      ...(payload.right.noticeMonths ? [{ label: "Notice", value: `${payload.right.noticeMonths} months` }] : []),
      ...payload.right.conditions.map((value, index) => ({ label: `Condition ${index + 1}`, value })),
    ] };
  }
  if (payload.termType === "PARKING") {
    return { kind: "PARKING", rows: [
      ...(payload.spacesCount ? [{ label: "Spaces", value: String(payload.spacesCount) }] : []),
      ...(payload.spacesRatio ? [{ label: "Ratio", value: payload.spacesRatio }] : []),
      ...(payload.ratePerSpacePerMonth !== null ? [{ label: "Rate", value: `${money(payload.ratePerSpacePerMonth)}/space/month` }] : []),
      ...(payload.reserved !== null ? [{ label: "Reserved", value: payload.reserved ? "Yes" : "No" }] : []),
    ] };
  }
  if (payload.termType === "OPERATING_EXPENSES") {
    return { kind: "OPERATING_EXPENSES", rows: [
      { label: "Structure", value: payload.structure.replaceAll("_", " ") },
      ...(payload.baseYear ? [{ label: "Base year", value: String(payload.baseYear) }] : []),
      ...(payload.controllableCapPct !== null ? [{ label: "Controllable cap", value: `${payload.controllableCapPct}%` }] : []),
      ...(payload.taxesInsuranceUncapped !== null ? [{ label: "Taxes / insurance uncapped", value: payload.taxesInsuranceUncapped ? "Yes" : "No" }] : []),
    ] };
  }
  return undefined;
}

function asTerm(term: ActivityNegotiationTerm): TermWithPayload {
  return {
    id: term.id,
    canonicalType: term.canonicalType as CanonicalTermType,
    normalizedValue: term.normalizedValue,
    normalizedNumeric: term.normalizedNumeric,
    normalizedUnit: term.normalizedUnit,
    rawValue: term.rawValue,
    status: term.status as NegotiationTermStatus,
    side: term.side as NegotiationSide,
    roundNumber: term.roundNumber,
    confidence: term.confidence,
    evidenceQuote: term.evidenceQuote,
    sourceLocation: term.sourceLocation,
    structuredPayload: parseStructuredPayload(term.structuredPayload, term.canonicalType as CanonicalTermType),
  };
}

/**
 * Chronology shows effective formal truth. Rejected extractions drop out.
 * Corrected extractions display the reviewed value. Raw NegotiationTerm rows
 * are not modified; reconciliation continues to read those raw rows.
 * A round whose every term was rejected is not formal movement.
 */
export function projectActivityNegotiationRounds(
  rows: ActivityNegotiationRound[],
  reviews: ReadonlyMap<string, FormalReviewSnapshot>
): ActivityNegotiationRound[] {
  return rows.flatMap((row) => {
    const terms = row.terms.flatMap((term) => {
      const effective = effectiveFormalTerm(asTerm(term), reviews.get(term.id));
      if (!effective) return [];
      return [{
        ...term,
        normalizedValue: effective.normalizedValue,
        normalizedNumeric: effective.normalizedNumeric,
        normalizedUnit: effective.normalizedUnit,
        rawValue: effective.rawValue,
        structuredPayload: (effective.structuredPayload ?? null) as Prisma.JsonValue,
      }];
    });
    if (row.terms.length > 0 && terms.length === 0) return [];
    return [{ ...row, terms }];
  });
}

function asRoundRecord(round: ActivityNegotiationRound): NegotiationRoundRecord {
  return {
    id: round.id,
    side: round.side as "TENANT" | "LANDLORD",
    roundNumber: round.roundNumber,
    documentName: round.documentName,
    documentText: round.documentText,
    documentDate: round.documentDate,
    createdAt: round.createdAt,
    terms: round.terms.map((term) => ({
      id: term.id,
      canonicalType: term.canonicalType as CanonicalTermType,
      normalizedValue: term.normalizedValue,
      normalizedNumeric: term.normalizedNumeric,
      normalizedUnit: term.normalizedUnit,
      rawValue: term.rawValue,
      status: term.status as "PROPOSED" | "AGREED" | "REJECTED" | "WITHDRAWN" | "UNRESOLVED",
      side: term.side as "TENANT" | "LANDLORD",
      roundNumber: term.roundNumber,
      confidence: term.confidence,
      evidenceQuote: term.evidenceQuote,
      sourceLocation: term.sourceLocation,
    })),
  };
}

function eventKind(round: ActivityNegotiationRound): Pick<ActivityEvent, "eventType" | "title"> {
  const side = round.side === "TENANT" ? "Tenant" : "Landlord";
  if (round.terms.length > 0 && round.terms.every((term) => term.status === "AGREED")) {
    return { eventType: "NEGOTIATION_AGREEMENT", title: `${side} agreement` };
  }
  const counter = round.document?.documentType === "COUNTERPROPOSAL" || /\bcounter(?:proposal)?\b/i.test(round.documentName) || round.roundNumber > 1;
  return counter
    ? { eventType: "NEGOTIATION_COUNTER", title: `${side} counterproposal` }
    : { eventType: "NEGOTIATION_PROPOSAL", title: `${side} proposal` };
}

export function buildNegotiationEvents(
  rows: ActivityNegotiationRound[],
  refsForDeal: (dealId: string) => ActivityEntityRef[]
): ActivityEvent[] {
  const ordered = chronologicalRounds(rows.map(asRoundRecord));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ordered.map((record, index) => {
    const row = byId.get(record.id)!;
    const prior = ordered.slice(0, index);
    const uniqueTerms = new Map<string, ActivityNegotiationTerm>();
    for (const term of row.terms) uniqueTerms.set(`${term.canonicalType}:${term.status}:${JSON.stringify(term.structuredPayload)}`, term);
    let changedCount = 0;
    let agreedCount = 0;
    const details: ActivityTermDetail[] = [...uniqueTerms.values()].map((term) => {
      const previous = currentPositionForSide(prior, term.canonicalType as CanonicalTermType, row.side as "TENANT" | "LANDLORD");
      const value = displayValue(term);
      const previousValue = previous ? previous.normalizedValue?.trim() || previous.rawValue : undefined;
      if (!previous || previousValue !== value || previous.status !== term.status) changedCount += 1;
      if (term.status === "AGREED") agreedCount += 1;
      return {
        canonicalType: term.canonicalType,
        label: TERM_LABELS[term.canonicalType as CanonicalTermType] ?? term.canonicalType.toLowerCase().replaceAll("_", " "),
        value,
        ...(previousValue && previousValue !== value ? { previousValue } : {}),
        status: term.status,
        ...(structuredDetail(term) ? { structured: structuredDetail(term) } : {}),
      };
    });
    const supports = row.terms.map(activityEvidenceSupport);
    const exactPageIds = [...new Set(row.terms.filter((term) => term.provenanceStatus === "EXACT" && term.documentPageId).map((term) => term.documentPageId!))];
    return {
      id: `negotiation:${row.id}`,
      occurredAt: row.documentDate.toISOString(),
      recordedAt: row.createdAt.toISOString(),
      ...eventKind(row),
      description: `${row.documentName} · ${changedCount} ${changedCount === 1 ? "term" : "terms"} changed${agreedCount ? ` · ${agreedCount} agreed` : ""}`,
      entityRefs: refsForDeal(row.dealId),
      dealId: row.dealId,
      negotiationHref: `/deals/${row.dealId}/negotiation?round=${row.id}`,
      ...(row.documentId ? {
        documentId: row.documentId,
        sourceHref: `/documents/${row.documentId}/review?section=negotiation`,
      } : {}),
      ...(exactPageIds.length === 1 ? { documentPageId: exactPageIds[0] } : {}),
      evidence: { title: `Terms recorded in ${row.document?.originalFilename ?? row.documentName}`, supportCount: supports.length, supports },
      details,
      sourceType: "NEGOTIATION_ROUND",
      sourceId: row.id,
      dedupeKey: `negotiation-round:${row.id}`,
    };
  });
}
