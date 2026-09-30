import type { Prisma, PrismaClient } from "@prisma/client";
import {
  parseStructuredPayload,
  supportsStructuredPayload,
  type CREStructuredPayload,
  type CRETermType,
} from "@/lib/ai/negotiation/payloads";
import type {
  CanonicalTermType,
  NegotiationSide,
  NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";
import {
  effectiveFormalTerm,
  projectEffectiveRounds,
  type FormalReviewSnapshot,
} from "@/lib/negotiation/formalReview";
import { presentTermSource } from "@/lib/negotiation/presentSource";
import {
  chronologicalRounds,
  resolveCurrentState,
  termObservations,
} from "@/lib/negotiation/resolveCurrentState";
import {
  isSideConflict,
  resolveStructuredState,
  type RoundWithPayload,
  type SideResult,
  type TermWithPayload,
} from "@/lib/negotiation/resolveStructuredState";
import { TERM_CATALOG } from "@/lib/negotiation/termCatalog";
import { negotiationReviewSummaries } from "@/lib/review/decisions";
import { getDocumentStorage } from "@/lib/documents/storage";
import { inspectSourceFile } from "@/lib/documents/sourceFile";
import { termCountsAsOpen } from "@/lib/deals/brief/formalStatus";
import { formatLegacyTerm, formatNumericValue, formatStructuredPayload } from "./formatting";
import { calculateWorkspaceMovement, observationFingerprint } from "./movement";
import type {
  FormattedTermValue,
  NegotiationDocumentView,
  NegotiationEvidenceView,
  NegotiationObservationView,
  NegotiationPositionCandidateView,
  NegotiationPositionView,
  NegotiationRoundChangeView,
  NegotiationRoundView,
  NegotiationTermGroup,
  FormalObservationReview,
  NegotiationTermView,
  NegotiationWorkspace,
  NegotiationWorkspaceFilter,
} from "./types";

const workspaceSelect = {
  id: true,
  name: true,
  company: true,
  property: true,
  propertyId: true,
  stage: true,
  status: true,
  estimatedValue: true,
  createdAt: true,
  negotiationRounds: {
    select: {
      id: true,
      side: true,
      roundNumber: true,
      documentName: true,
      documentDate: true,
      sourceType: true,
      documentId: true,
      createdAt: true,
      document: {
        select: {
          id: true,
          originalFilename: true,
          documentType: true,
          documentDate: true,
        },
      },
      terms: {
        select: {
          id: true,
          canonicalType: true,
          normalizedValue: true,
          normalizedNumeric: true,
          normalizedUnit: true,
          rawValue: true,
          status: true,
          side: true,
          roundNumber: true,
          confidence: true,
          evidenceQuote: true,
          sourceLocation: true,
          provenanceStatus: true,
          structuredPayload: true,
          documentPage: { select: { id: true, pageNumber: true } },
          formalTermReview: {
            select: {
              state: true,
              normalizedValue: true,
              normalizedNumeric: true,
              normalizedUnit: true,
              rawValue: true,
              structuredPayload: true,
              note: true,
              reviewedAt: true,
              actor: true,
              reviewerUserId: true,
            },
          },
          evidenceCorrections: {
            where: { supersededAt: null },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              evidenceQuote: true,
              documentPage: { select: { pageNumber: true } },
            },
          },
        },
        orderBy: [{ canonicalType: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  },
  documents: {
    select: {
      id: true,
      originalFilename: true,
      documentType: true,
      documentDate: true,
      ingestionStatus: true,
      pageCount: true,
      createdAt: true,
    },
    orderBy: [{ documentDate: "desc" }, { createdAt: "desc" }],
  },
} as const satisfies Prisma.DealSelect;

export type NegotiationWorkspaceSource = Prisma.DealGetPayload<{
  select: typeof workspaceSelect;
}>;

const GROUPS: Record<CanonicalTermType, NegotiationTermGroup> = {
  BASE_RENT: "ECONOMICS",
  TI_ALLOWANCE: "ECONOMICS",
  FREE_RENT: "ECONOMICS",
  ANNUAL_ESCALATION: "ECONOMICS",
  SECURITY_DEPOSIT: "ECONOMICS",
  RENT_STRUCTURE: "ECONOMICS",
  PREMISES_RSF: "OPERATIONS",
  OPERATING_EXPENSES: "OPERATIONS",
  PARKING: "OPERATIONS",
  DELIVERY_CONDITION: "OPERATIONS",
  COMMENCEMENT_DATE: "TIMING",
  LEASE_TERM: "TIMING",
  RENEWAL_OPTIONS: "RIGHTS",
  TERMINATION_RIGHTS: "RIGHTS",
  EXPANSION_RIGHTS: "RIGHTS",
  ASSIGNMENT_SUBLETTING: "RIGHTS",
};

const GAP_TYPES = new Set<CanonicalTermType>([
  "BASE_RENT",
  "TI_ALLOWANCE",
  "FREE_RENT",
  "ANNUAL_ESCALATION",
  "SECURITY_DEPOSIT",
]);

interface RoundMetadata {
  sourceType: string;
  documentId: string | null;
  documentOriginalFilename: string | null;
  documentPageByTermId: Map<string, { pageNumber: number } | null>;
  provenanceByTermId: Map<
    string,
    "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null
  >;
  correctedSpanByTermId: Map<string, { quote: string; pageNumber: number | null }>;
}

function asRounds(source: NegotiationWorkspaceSource): {
  rounds: RoundWithPayload[];
  metadata: Map<string, RoundMetadata>;
  reviews: Map<string, FormalReviewSnapshot>;
} {
  const metadata = new Map<string, RoundMetadata>();
  const reviews = new Map<string, FormalReviewSnapshot>();
  const rounds: RoundWithPayload[] = source.negotiationRounds.map((round) => {
    for (const term of round.terms) {
      if (term.formalTermReview) {
        reviews.set(term.id, {
          state: term.formalTermReview.state,
          normalizedValue: term.formalTermReview.normalizedValue,
          normalizedNumeric: term.formalTermReview.normalizedNumeric,
          normalizedUnit: term.formalTermReview.normalizedUnit,
          rawValue: term.formalTermReview.rawValue,
          structuredPayload: term.formalTermReview.structuredPayload,
          note: term.formalTermReview.note,
          reviewedAt: term.formalTermReview.reviewedAt,
          actor: term.formalTermReview.actor,
          reviewerUserId: term.formalTermReview.reviewerUserId,
        });
      }
    }
    metadata.set(round.id, {
      sourceType: round.sourceType,
      documentId: round.documentId,
      documentOriginalFilename: round.document?.originalFilename ?? null,
      documentPageByTermId: new Map(
        round.terms.map((term) => [term.id, term.documentPage] as const)
      ),
      provenanceByTermId: new Map(
        round.terms.map((term) => [term.id, term.provenanceStatus] as const)
      ),
      correctedSpanByTermId: new Map(
        round.terms.flatMap((term) => {
          const correction = term.evidenceCorrections[0];
          return correction
            ? [[term.id, { quote: correction.evidenceQuote, pageNumber: correction.documentPage?.pageNumber ?? null }] as const]
            : [];
        })
      ),
    });
    return {
      id: round.id,
      side: round.side as NegotiationSide,
      roundNumber: round.roundNumber,
      documentName: round.documentName,
      // The resolver contract includes source text, but resolution never reads it.
      // The workspace query intentionally avoids loading large document bodies.
      documentText: "",
      documentDate: round.documentDate,
      createdAt: round.createdAt,
      terms: round.terms.map((term) => ({
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
        structuredPayload: parseStructuredPayload(
          term.structuredPayload,
          term.canonicalType as CanonicalTermType
        ),
      })),
    };
  });
  return { rounds, metadata, reviews };
}

function formattedTerm(term: TermWithPayload): FormattedTermValue {
  const payload = parseStructuredPayload(term.structuredPayload, term.canonicalType);
  return payload ? formatStructuredPayload(payload) : formatLegacyTerm(term);
}

function candidate(
  payload: CREStructuredPayload,
  observationIds: string[]
): NegotiationPositionCandidateView {
  return {
    value: formatStructuredPayload(payload),
    structuredPayload: payload,
    observationIds,
  };
}

function structuredPosition(result: SideResult | undefined): NegotiationPositionView | null {
  if (!result) return null;
  if (isSideConflict(result)) {
    return {
      kind: "CONFLICT",
      label: "Conflicting positions detected",
      candidates: result.candidates.map((item) =>
        candidate(item.payload, item.observationIds)
      ),
      observationIds: [
        ...new Set(result.candidates.flatMap((item) => item.observationIds)),
      ],
    };
  }
  return {
    kind: "VALUE",
    ...candidate(result.payload, result.observationIds),
  };
}

function legacyPosition(term: TermWithPayload | undefined): NegotiationPositionView | null {
  if (!term) return null;
  return {
    kind: "VALUE",
    value: formattedTerm(term),
    structuredPayload: parseStructuredPayload(term.structuredPayload, term.canonicalType),
    observationIds: [term.id],
  };
}

function active(term: TermWithPayload): boolean {
  return term.status === "PROPOSED" || term.status === "AGREED" || term.status === "UNRESOLVED";
}

function latestSideTerms(
  rounds: RoundWithPayload[],
  canonicalType: CanonicalTermType,
  side: NegotiationSide
): TermWithPayload[] {
  const observations = termObservations(rounds as never, canonicalType) as Array<{
    round: RoundWithPayload;
    term: TermWithPayload;
  }>;
  const sideObservations = observations.filter(({ term }) => term.side === side);
  if (sideObservations.at(-1)?.term.status === "WITHDRAWN") return [];
  const activeObservations = sideObservations.filter(({ term }) => active(term));
  const latestRoundId = activeObservations.at(-1)?.round.id;
  return latestRoundId
    ? activeObservations
        .filter(({ round }) => round.id === latestRoundId)
        .map(({ term }) => term)
    : [];
}

function displayTermForSide(
  rounds: RoundWithPayload[],
  canonicalType: CanonicalTermType,
  side: NegotiationSide,
  resolved: TermWithPayload | undefined
): TermWithPayload | undefined {
  const observations = termObservations(rounds as never, canonicalType) as Array<{
    term: TermWithPayload;
  }>;
  const latest = observations
    .map(({ term }) => term)
    .filter((term) => term.side === side)
    .at(-1);
  if (!latest || latest.status === "WITHDRAWN") return resolved;
  if (latest.status === "UNRESOLVED" || latest.status === "REJECTED") return latest;
  return resolved;
}

function canResolveStructured(
  rounds: RoundWithPayload[],
  canonicalType: CanonicalTermType
): canonicalType is CRETermType {
  if (!supportsStructuredPayload(canonicalType)) return false;
  const currentTerms = (["TENANT", "LANDLORD"] as const).flatMap((side) =>
    latestSideTerms(rounds, canonicalType, side)
  );
  return (
    currentTerms.length > 0 &&
    currentTerms.every((term) =>
      Boolean(parseStructuredPayload(term.structuredPayload, canonicalType))
    )
  );
}

function legacyConflictPosition(
  rounds: RoundWithPayload[],
  canonicalType: CanonicalTermType,
  fallback: NegotiationPositionView | null
): NegotiationPositionView | null {
  const observations = termObservations(rounds as never, canonicalType) as Array<{
    round: RoundWithPayload;
    term: TermWithPayload;
  }>;
  const latestRoundId = observations.at(-1)?.round.id;
  if (!latestRoundId) return fallback;
  const candidates = observations
    .filter(({ round, term }) => round.id === latestRoundId && active(term))
    .map(({ term }) => ({
      value: formattedTerm(term),
      structuredPayload: parseStructuredPayload(term.structuredPayload, canonicalType),
      observationIds: [term.id],
    }));
  if (new Set(candidates.map((item) => item.value.summary)).size < 2) return fallback;
  return {
    kind: "CONFLICT",
    label: "Conflicting positions detected",
    candidates,
    observationIds: candidates.flatMap((item) => item.observationIds),
  };
}

function termEvidence(
  round: RoundWithPayload,
  term: TermWithPayload,
  metadata: RoundMetadata
): NegotiationEvidenceView {
  const span = metadata.correctedSpanByTermId.get(term.id);
  const source = presentTermSource({
    documentName: round.documentName,
    evidenceQuote: span?.quote ?? term.evidenceQuote,
    sourceLocation: term.sourceLocation,
    provenanceStatus: span ? "EXACT" : metadata.provenanceByTermId.get(term.id) ?? null,
    pageNumber: span?.pageNumber ?? metadata.documentPageByTermId.get(term.id)?.pageNumber ?? null,
    originalFilename: metadata.documentOriginalFilename,
    documentId: metadata.documentId,
  });
  const href = source.documentId
    ? `/api/documents/${source.documentId}/file${source.pageNumber ? `#page=${source.pageNumber}` : ""}`
    : null;
  return {
    observationId: term.id,
    quote: source.evidenceQuote,
    originalQuote: term.evidenceQuote,
    spanCorrected: Boolean(span),
    confidence: term.confidence,
    sourceKind: metadata.sourceType,
    sourceLabel:
      metadata.sourceType === "PASTED_TEXT"
        ? `${source.filename} · Pasted text`
        : source.filename,
    sourceLocation: source.sectionLabel,
    provenanceStatus: source.provenanceStatus,
    pageNumber: source.pageNumber,
    pageLabel: source.pageLabel,
    documentId: source.documentId,
    href,
    modelDerived: true,
  };
}

function observationReview(
  term: TermWithPayload,
  reviews: Map<string, FormalReviewSnapshot>
): FormalObservationReview | null {
  const review = reviews.get(term.id);
  if (!review) return null;
  const effective = effectiveFormalTerm(term, review);
  return {
    state: review.state,
    extractedSummary: formattedTerm(term).summary,
    effectiveSummary: effective ? formattedTerm(effective).summary : null,
    note: review.note,
    reviewedAt: review.reviewedAt.toISOString(),
    actor: review.actor,
    reviewerUserId: review.reviewerUserId,
  };
}

function termHistory(
  rounds: RoundWithPayload[],
  canonicalType: CanonicalTermType,
  metadata: Map<string, RoundMetadata>,
  reviews: Map<string, FormalReviewSnapshot>
): NegotiationObservationView[] {
  return (termObservations(rounds as never, canonicalType) as Array<{
    round: RoundWithPayload;
    term: TermWithPayload;
  }>).map(({ round, term }) => ({
    id: term.id,
    roundId: round.id,
    roundName: round.documentName,
    roundDate: round.documentDate.toISOString(),
    side: term.side,
    status: term.status,
    value: formattedTerm(term),
    evidence: termEvidence(round, term, metadata.get(round.id)!),
    formalReview: observationReview(term, reviews),
  }));
}

export function currentFormalObservation(term: NegotiationTermView) {
  const ids = new Set([
    ...(term.agreedPosition?.observationIds ?? []),
    ...(term.tenantPosition?.observationIds ?? []),
    ...(term.landlordPosition?.observationIds ?? []),
  ]);
  if (ids.size === 0) return term.history.at(-1) ?? null;
  return [...term.history].reverse().find((item) => ids.has(item.id)) ?? term.history.at(-1) ?? null;
}

function numericGap(
  canonicalType: CanonicalTermType,
  tenant: TermWithPayload | undefined,
  landlord: TermWithPayload | undefined,
  conflict: boolean
) {
  if (
    conflict ||
    !GAP_TYPES.has(canonicalType) ||
    tenant?.normalizedNumeric === null ||
    tenant?.normalizedNumeric === undefined ||
    landlord?.normalizedNumeric === null ||
    landlord?.normalizedNumeric === undefined ||
    !tenant.normalizedUnit ||
    tenant.normalizedUnit !== landlord.normalizedUnit
  ) {
    return null;
  }
  const value = Math.abs(landlord.normalizedNumeric - tenant.normalizedNumeric);
  return {
    value,
    unit: tenant.normalizedUnit,
    display: formatNumericValue(value, tenant.normalizedUnit),
  };
}

function changeValue(terms: TermWithPayload[]): string {
  const unique = [...new Map(terms.map((term) => [formattedTerm(term).summary, term])).values()];
  return unique.map((term) => formattedTerm(term).summary).join(" / ");
}

function buildRoundViews(
  rounds: RoundWithPayload[],
  metadata: Map<string, RoundMetadata>
): NegotiationRoundView[] {
  const labels = new Map(TERM_CATALOG.map((item) => [item.type, item.label]));
  const ordered = chronologicalRounds(rounds as never) as RoundWithPayload[];
  return ordered.map((round, index) => {
    const prior = ordered.slice(0, index);
    const grouped = new Map<CanonicalTermType, TermWithPayload[]>();
    for (const term of round.terms) {
      const group = grouped.get(term.canonicalType) ?? [];
      group.push(term);
      grouped.set(term.canonicalType, group);
    }
    const changes: NegotiationRoundChangeView[] = [...grouped.entries()].map(
      ([canonicalType, terms]) => {
        const previous = (
          termObservations(prior as never, canonicalType) as Array<{
            term: TermWithPayload;
          }>
        )
          .map(({ term }) => term)
          .filter((term) => term.side === round.side && active(term))
          .at(-1);
        const fingerprints = new Set(terms.map(observationFingerprint));
        const kind = terms.some((term) => term.status === "AGREED")
          ? "AGREED"
          : previous &&
              fingerprints.size === 1 &&
              fingerprints.has(observationFingerprint(previous))
            ? "UNCHANGED"
            : "CHANGED";
        return {
          canonicalType,
          label: labels.get(canonicalType) ?? canonicalType,
          kind,
          previousValue: previous ? formattedTerm(previous).summary : null,
          currentValue: changeValue(terms),
        };
      }
    );
    const roundMetadata = metadata.get(round.id)!;
    return {
      id: round.id,
      side: round.side,
      roundNumber: round.roundNumber,
      documentName: round.documentName,
      documentDate: round.documentDate.toISOString(),
      sourceType: roundMetadata.sourceType,
      documentId: roundMetadata.documentId,
      documentHref: roundMetadata.documentId
        ? `/api/documents/${roundMetadata.documentId}/file`
        : null,
      changedCount: changes.filter((change) => change.kind === "CHANGED").length,
      unchangedCount: changes.filter((change) => change.kind === "UNCHANGED").length,
      agreedCount: changes.filter((change) => change.kind === "AGREED").length,
      changes,
    };
  });
}

function buildTermView(
  rounds: RoundWithPayload[],
  resolverRounds: RoundWithPayload[],
  canonicalType: CanonicalTermType,
  label: string,
  metadata: Map<string, RoundMetadata>,
  latestRound: NegotiationRoundView | null,
  reviews: Map<string, FormalReviewSnapshot>
): NegotiationTermView | null {
  const history = termHistory(rounds, canonicalType, metadata, reviews);
  if (history.length === 0) return null;
  const flat = resolveCurrentState(resolverRounds as never, canonicalType);
  const displayTenantTerm = displayTermForSide(
    resolverRounds,
    canonicalType,
    "TENANT",
    flat.currentTenantTerm as TermWithPayload | undefined
  );
  const displayLandlordTerm = displayTermForSide(
    resolverRounds,
    canonicalType,
    "LANDLORD",
    flat.currentLandlordTerm as TermWithPayload | undefined
  );
  const useStructured = canResolveStructured(resolverRounds, canonicalType);
  let tenantPosition: NegotiationPositionView | null;
  let landlordPosition: NegotiationPositionView | null;
  let agreedPosition: NegotiationPositionView | null;
  let status: NegotiationTermStatus;
  let structuredState: NegotiationTermView["structuredState"] = null;

  if (useStructured) {
    const resolved = resolveStructuredState({ rounds: resolverRounds, canonicalType });
    tenantPosition = structuredPosition(resolved.tenant) ?? legacyPosition(displayTenantTerm);
    landlordPosition = structuredPosition(resolved.landlord) ?? legacyPosition(displayLandlordTerm);
    agreedPosition = resolved.agreed
      ? {
          kind: "VALUE",
          ...candidate(resolved.agreed.payload, resolved.agreed.observationIds),
        }
      : null;
    status = resolved.status;
    structuredState = {
      status: resolved.status,
      sourceObservationIds: resolved.sourceObservationIds,
    };
  } else {
    tenantPosition = legacyPosition(displayTenantTerm);
    landlordPosition = legacyPosition(displayLandlordTerm);
    agreedPosition = legacyPosition(flat.agreedTerm as TermWithPayload | undefined);
    if (flat.contradictory) {
      const conflict = legacyConflictPosition(resolverRounds, canonicalType, null);
      const latestSide = history.at(-1)?.side;
      if (latestSide === "TENANT") tenantPosition = conflict;
      if (latestSide === "LANDLORD") landlordPosition = conflict;
    }
    status = flat.status;
  }

  const conflict =
    tenantPosition?.kind === "CONFLICT" || landlordPosition?.kind === "CONFLICT";
  const latestChange = latestRound?.changes.find(
    (change) => change.canonicalType === canonicalType
  );
  const calculatedMovement = calculateWorkspaceMovement(resolverRounds, canonicalType);
  const movement = conflict
    ? {
        kind: "CHANGED" as const,
        label: "Changed · conflicting candidates require review",
        side: latestChange ? latestRound?.side ?? null : null,
        from: null,
        to: null,
        amount: null,
        unit: null,
        direction: "UNKNOWN" as const,
        roundId: latestChange ? latestRound?.id ?? null : null,
      }
    : calculatedMovement;
  const sourceObservationIds = [...new Set(history.map((item) => item.id))];
  return {
    canonicalType,
    label,
    group: GROUPS[canonicalType],
    resolutionMode: useStructured ? "STRUCTURED" : "LEGACY",
    tenantPosition,
    landlordPosition,
    agreedPosition,
    status,
    conflict,
    movement,
    numericGap: numericGap(
      canonicalType,
      flat.currentTenantTerm as TermWithPayload | undefined,
      flat.currentLandlordTerm as TermWithPayload | undefined,
      conflict
    ),
    changedInLatestRound: Boolean(latestChange && latestChange.kind !== "UNCHANGED"),
    latestSideToChange:
      latestChange && latestChange.kind !== "UNCHANGED"
        ? latestRound?.side ?? null
        : null,
    structuredState,
    evidence: history.map((item) => item.evidence),
    history,
    sourceObservationIds,
  };
}

function documents(
  source: NegotiationWorkspaceSource,
  rounds: NegotiationRoundView[]
): NegotiationDocumentView[] {
  const termCountByDocument = new Map<string, number>();
  for (const round of source.negotiationRounds) {
    if (round.documentId) {
      termCountByDocument.set(
        round.documentId,
        (termCountByDocument.get(round.documentId) ?? 0) + round.terms.length
      );
    }
  }
  const roundByDocument = new Map(
    rounds
      .filter((round) => round.documentId)
      .map((round) => [round.documentId!, round] as const)
  );
  return source.documents.map((document) => {
    const round = roundByDocument.get(document.id);
    return {
      id: document.id,
      name: document.originalFilename,
      documentType: document.documentType,
      documentDate: document.documentDate?.toISOString() ?? null,
      ingestionStatus: document.ingestionStatus,
      pageCount: document.pageCount,
      termCount: termCountByDocument.get(document.id) ?? 0,
      sourceHref: `/api/documents/${document.id}/file`,
      reviewHref: `/documents/${document.id}/review`,
      workspaceHref: `/deals/${source.id}/negotiation${round ? `?round=${round.id}` : ""}`,
      review: null,
    };
  });
}

export function buildNegotiationWorkspace(
  source: NegotiationWorkspaceSource
): NegotiationWorkspace {
  const normalized = asRounds(source);
  const resolverRounds = projectEffectiveRounds(normalized.rounds, normalized.reviews);
  const roundViews = buildRoundViews(normalized.rounds, normalized.metadata);
  const latestRound = roundViews.at(-1) ?? null;
  const terms = TERM_CATALOG.map(({ type, label }) =>
    buildTermView(
      normalized.rounds,
      resolverRounds,
      type,
      label,
      normalized.metadata,
      latestRound,
      normalized.reviews
    )
  ).filter((term): term is NegotiationTermView => term !== null);
  const agreedCount = terms.filter((term) => term.status === "AGREED").length;
  const conflictCount = terms.filter((term) => term.conflict).length;
  const openCount = terms.filter((term) => termCountsAsOpen(term)).length;
  return {
    deal: {
      id: source.id,
      name: source.name,
      company: source.company,
      property: source.property,
      propertyId: source.propertyId,
      stage: source.stage,
      status: source.status,
      estimatedValue: source.estimatedValue,
      createdAt: source.createdAt.toISOString(),
    },
    summary: {
      openCount,
      agreedCount,
      conflictCount,
      changedThisRoundCount: latestRound?.changedCount ?? 0,
    },
    terms,
    rounds: roundViews,
    documents: documents(source, roundViews),
    latestRound,
    unresolvedCount: openCount,
    agreedCount,
    conflictCount,
  };
}

export function filterNegotiationTerms(
  terms: NegotiationTermView[],
  filter: NegotiationWorkspaceFilter
): NegotiationTermView[] {
  if (filter === "ALL") return terms;
  if (filter === "AGREED") return terms.filter((term) => term.status === "AGREED");
  if (filter === "CONFLICTS") return terms.filter((term) => term.conflict);
  if (filter === "CHANGED") return terms.filter((term) => term.changedInLatestRound);
  return terms.filter((term) => termCountsAsOpen(term));
}

export async function getNegotiationWorkspace(
  db: PrismaClient,
  dealId: string
): Promise<NegotiationWorkspace | null> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: workspaceSelect,
  });
  if (!deal) return null;
  const workspace = buildNegotiationWorkspace(deal);
  const documentIds = deal.documents.map((document) => document.id);
  const [summaries, storedKeys] = await Promise.all([
    negotiationReviewSummaries(db, deal.negotiationRounds),
    documentIds.length
      ? db.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, storageKey: true } })
      : Promise.resolve([]),
  ]);
  const storage = getDocumentStorage();
  const available = new Map(
    await Promise.all(
      storedKeys.map(async (document) => [document.id, await inspectSourceFile(storage, document.storageKey)] as const)
    )
  );
  return {
    ...workspace,
    documents: workspace.documents.map((document) => ({
      ...document,
      sourceHref: available.get(document.id) === "AVAILABLE" ? document.sourceHref : null,
      review: summaries.get(document.id) ?? { findingsReviewed: 0, findingsFollowUp: 0, findingsTotal: document.termCount },
    })),
  };
}
