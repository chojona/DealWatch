import type { Prisma, PrismaClient } from "@prisma/client";
import { parseStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType, NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";
import { deriveReadiness } from "@/lib/documents/readiness";
import { presentDocumentLifecycle } from "@/lib/documents/lifecycle";
import { getDocumentStorage } from "@/lib/documents/storage";
import { inspectSourceFile, type SourceFileState } from "@/lib/documents/sourceFile";
import { emptyReviewWork, type ReviewWork } from "@/lib/review/completion";
import {
  formatLegacyTerm,
  formatStructuredPayload,
} from "@/lib/negotiation/intelligence/formatting";
import {
  buildNegotiationWorkspace,
  type NegotiationWorkspaceSource,
} from "@/lib/negotiation/intelligence/service";
import {
  effectiveFormalTerm,
  formalCorrectionMode,
  type FormalReviewSnapshot,
} from "@/lib/negotiation/formalReview";
import { presentTermSource } from "@/lib/negotiation/presentSource";
import { TERM_LABELS } from "@/lib/negotiation/termCatalog";
import type {
  DocumentCompletionSummary,
  InboxFilter,
  InboxItem,
  InboxPageModel,
  NegotiationConflictView,
  NegotiationFinding,
  ProvenanceStatus,
} from "./types";
import { factsFromLatestRun } from "@/lib/messages/latestRun";
import { deriveMessageLifecycle } from "@/lib/messages/state";
import {
  canRetryDocument,
  deriveInboxStatus,
  matchesInboxFilter,
  nextActionFor,
  reviewProgress,
  reviewReasonsFor,
} from "./status";

const roundSelect = {
  id: true,
  dealId: true,
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
} as const satisfies Prisma.NegotiationRoundSelect;

type RoundRow = Prisma.NegotiationRoundGetPayload<{ select: typeof roundSelect }>;

type DealRow = {
  id: string;
  name: string;
  company: string;
  property: string;
  propertyId: string | null;
  stage: string;
  status: string;
  estimatedValue: number | null;
  createdAt: Date;
  workspaceId: string;
};

type DocumentRow = {
  id: string;
  dealId: string;
  filename: string;
  originalFilename: string;
  documentType: string;
  documentDate: Date | null;
  negotiationSide: string | null;
  ingestionStatus: string;
  failureCode: string | null;
  failureReason: string | null;
  graphExtractionStatus: string;
  graphFailureCode: string | null;
  graphFailureReason: string | null;
  sha256: string;
  mimeType: string;
  pageCount: number | null;
  storageKey: string;
  createdAt: Date;
  deal: DealRow;
};

type EntityRow = {
  id: string;
  documentId: string | null;
  surfaceForm: string;
  observedType: string;
  evidenceQuote: string;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
  documentPage: { pageNumber: number } | null;
  resolutionLinks: Array<{ id: string }>;
  dispositions: Array<{ disposition: "ACCEPTED" | "REJECTED" }>;
};

type EndpointRow = { resolutionLinks: Array<{ id: string }> } | null;

type RelationshipRow = {
  id: string;
  documentId: string | null;
  predicate: string;
  evidenceQuote: string;
  provenanceStatus: "EXACT" | "AMBIGUOUS" | "UNLOCATED" | null;
  objectObservationId: string | null;
  principalObservationId: string | null;
  documentPage: { pageNumber: number } | null;
  promotion: { decision: "APPROVED" | "REJECTED" | "ACKNOWLEDGED_BLOCKED" } | null;
  subjectObservation: EndpointRow;
  objectObservation: EndpointRow;
  principalObservation: EndpointRow;
};

function emptyNegotiation() {
  return {
    termCount: 0,
    changedCount: 0,
    agreedCount: 0,
    unchangedCount: 0,
    newCount: 0,
    conflictCount: 0,
    pendingReviewCount: 0,
    acknowledgedCount: 0,
    followUpCount: 0,
    unreviewedConflictCount: 0,
  };
}

function sideLabel(side: string): string {
  if (side === "LANDLORD") return "Landlord";
  if (side === "TENANT") return "Tenant";
  return side;
}

function impactLabel(input: {
  kind: "CHANGED" | "UNCHANGED" | "AGREED";
  previousValue: string | null;
  currentValue: string;
  side: string;
}): string {
  if (input.kind === "UNCHANGED") return "No change";
  if (input.kind === "AGREED") return `${sideLabel(input.side)} agreed ${input.currentValue}`;
  if (!input.previousValue) return "New proposal";
  return `${sideLabel(input.side)}: ${input.previousValue} → ${input.currentValue}`;
}

function endpointResolved(endpoint: EndpointRow, required: boolean): boolean {
  if (!required) return true;
  return Boolean(endpoint && endpoint.resolutionLinks.length > 0);
}

function endpointsResolved(row: RelationshipRow): boolean {
  return (
    endpointResolved(row.subjectObservation, true) &&
    endpointResolved(row.objectObservation, Boolean(row.objectObservationId)) &&
    endpointResolved(row.principalObservation, Boolean(row.principalObservationId))
  );
}

function relationshipBucket(
  row: RelationshipRow
): "approved" | "rejected" | "blocked" | "ready" | "acknowledgedBlocked" {
  if (row.promotion?.decision === "APPROVED") return "approved";
  if (row.promotion?.decision === "REJECTED") return "rejected";
  const resolved = endpointsResolved(row);
  if (!resolved && row.promotion?.decision === "ACKNOWLEDGED_BLOCKED") return "acknowledgedBlocked";
  return resolved ? "ready" : "blocked";
}

function provenancePage(status: string | null, pageNumber: number | null): number | null {
  return status === "EXACT" && pageNumber ? pageNumber : null;
}

type StoredDecision = {
  documentId: string;
  subjectKey: string;
  kind: string;
  negotiationTermId: string | null;
  canonicalType: string | null;
  entityObservationId: string | null;
  relationshipObservationId: string | null;
  reviewState: "PENDING" | "ACKNOWLEDGED" | "NEEDS_FOLLOW_UP" | "LEFT_UNRESOLVED";
  note: string | null;
};

type StoredCorrection = {
  id: string;
  documentId: string;
  negotiationTermId: string;
  evidenceQuote: string;
  documentPage: { pageNumber: number } | null;
  createdAt: Date;
};

function decisionState(
  decisions: StoredDecision[],
  subjectKey: string
): "PENDING" | "ACKNOWLEDGED" | "NEEDS_FOLLOW_UP" {
  const state = decisions.find((decision) => decision.subjectKey === subjectKey)?.reviewState ?? "PENDING";
  if (state === "ACKNOWLEDGED" || state === "NEEDS_FOLLOW_UP") return state;
  return "PENDING";
}

function formalSnapshot(
  review: {
    state: FormalReviewSnapshot["state"];
    normalizedValue: string | null;
    normalizedNumeric: number | null;
    normalizedUnit: string | null;
    rawValue: string | null;
    structuredPayload: unknown;
    note: string | null;
    reviewedAt: Date;
    actor: FormalReviewSnapshot["actor"];
    reviewerUserId: string | null;
  } | null
): FormalReviewSnapshot | null {
  if (!review) return null;
  return review;
}

function activeCorrections(corrections: StoredCorrection[]): Map<string, StoredCorrection> {
  const byTerm = new Map<string, StoredCorrection>();
  for (const correction of [...corrections].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())) {
    byTerm.set(correction.negotiationTermId, correction);
  }
  return byTerm;
}

function negotiationForDocument(
  source: NegotiationWorkspaceSource,
  documentId: string,
  decisions: StoredDecision[],
  corrections: StoredCorrection[]
) {
  const full = buildNegotiationWorkspace(source);
  const documentRounds = full.rounds.filter((round) => round.documentId === documentId);
  const sourceRounds = source.negotiationRounds.filter((round) => round.documentId === documentId);
  if (documentRounds.length === 0) {
    return { summary: emptyNegotiation(), findings: [] as NegotiationFinding[], conflicts: [] as NegotiationConflictView[] };
  }
  const last = documentRounds[documentRounds.length - 1]!;
  const lastIndex = full.rounds.findIndex((round) => round.id === last.id);
  const prefixIds = new Set(full.rounds.slice(0, lastIndex + 1).map((round) => round.id));
  const prefix = buildNegotiationWorkspace({
    ...source,
    negotiationRounds: source.negotiationRounds.filter((round) => prefixIds.has(round.id)),
  });
  const mentioned = new Set(documentRounds.flatMap((round) => round.changes.map((change) => change.canonicalType)));
  const summary = emptyNegotiation();
  summary.conflictCount = prefix.terms.filter(
    (term) => term.conflict && mentioned.has(term.canonicalType)
  ).length;
  for (const round of documentRounds) {
    for (const change of round.changes) {
      if (change.kind === "CHANGED") summary.changedCount += 1;
      if (change.kind === "AGREED") summary.agreedCount += 1;
      if (change.kind === "UNCHANGED") summary.unchangedCount += 1;
      if (change.kind === "CHANGED" && !change.previousValue) summary.newCount += 1;
    }
  }
  const correctionsByTerm = activeCorrections(corrections);
  const findings: NegotiationFinding[] = [];
  for (const round of sourceRounds) {
    summary.termCount += round.terms.length;
    const view = full.rounds.find((item) => item.id === round.id);
    for (const term of round.terms) {
      const change = view?.changes.find((item) => item.canonicalType === term.canonicalType);
      const payload = parseStructuredPayload(term.structuredPayload, term.canonicalType as CanonicalTermType);
      const formatted = payload ? formatStructuredPayload(payload) : formatLegacyTerm(term);
      const correction = correctionsByTerm.get(term.id);
      const presented = presentTermSource({
        documentName: round.documentName,
        evidenceQuote: correction?.evidenceQuote ?? term.evidenceQuote,
        sourceLocation: term.sourceLocation,
        provenanceStatus: correction ? "EXACT" : term.provenanceStatus,
        pageNumber: correction?.documentPage?.pageNumber ?? term.documentPage?.pageNumber ?? null,
        originalFilename: round.document?.originalFilename,
        documentId,
      });
      const formalReview = formalSnapshot(term.formalTermReview);
      const effective = effectiveFormalTerm(
        {
          id: term.id,
          canonicalType: term.canonicalType as CanonicalTermType,
          normalizedValue: term.normalizedValue,
          normalizedNumeric: term.normalizedNumeric,
          normalizedUnit: term.normalizedUnit,
          rawValue: term.rawValue,
          status: term.status as NegotiationTermStatus,
          side: term.side as "TENANT" | "LANDLORD",
          roundNumber: term.roundNumber,
          confidence: term.confidence,
          evidenceQuote: term.evidenceQuote,
          sourceLocation: term.sourceLocation,
          structuredPayload: payload,
        },
        formalReview
      );
      const effectiveFormatted = effective
        ? (effective.structuredPayload ? formatStructuredPayload(effective.structuredPayload) : formatLegacyTerm(effective))
        : null;
      const reviewState = decisionState(decisions, `term:${term.id}`);
      if (reviewState === "ACKNOWLEDGED") summary.acknowledgedCount += 1;
      else if (reviewState === "NEEDS_FOLLOW_UP") summary.followUpCount += 1;
      else summary.pendingReviewCount += 1;
      const kind = change?.kind ?? "UNCHANGED";
      findings.push({
        termId: term.id,
        canonicalType: term.canonicalType,
        label: TERM_LABELS[term.canonicalType as CanonicalTermType] ?? term.canonicalType,
        side: term.side,
        status: term.status,
        formattedValue: formatted.summary,
        structuredDetails: payload ? formatted.details : null,
        evidenceQuote: correction?.evidenceQuote ?? term.evidenceQuote,
        provenanceStatus: presented.provenanceStatus,
        pageNumber: presented.pageNumber,
        pageLabel: correction
          ? `Page ${correction.documentPage?.pageNumber ?? "?"} · Corrected`
          : presented.pageLabel,
        originalEvidenceQuote: term.evidenceQuote,
        originalProvenanceStatus: term.provenanceStatus,
        reviewState,
        reviewNote: decisions.find((decision) => decision.subjectKey === `term:${term.id}`)?.note ?? null,
        activeCorrectionId: correction?.id ?? null,
        formalReviewState: formalReview?.state ?? "UNREVIEWED",
        formalExtractedSummary: formatted.summary,
        formalEffectiveSummary: effectiveFormatted?.summary ?? null,
        formalReviewNote: formalReview?.note ?? null,
        formalReviewedAt: formalReview?.reviewedAt.toISOString() ?? null,
        formalCorrectionMode: formalCorrectionMode(term),
        impactKind: kind,
        impactLabel: impactLabel({
          kind,
          previousValue: change?.previousValue ?? null,
          currentValue: change?.currentValue ?? formatted.summary,
          side: term.side,
        }),
        previousValue: change?.previousValue ?? null,
        currentValue: change?.currentValue ?? formatted.summary,
      });
    }
  }
  const conflicts: NegotiationConflictView[] = prefix.terms
    .filter((term) => term.conflict && mentioned.has(term.canonicalType))
    .map((term) => {
      const candidates = [term.tenantPosition, term.landlordPosition, term.agreedPosition].flatMap((position) => {
        if (!position) return [];
        if (position.kind === "CONFLICT") return position.candidates.map((candidate) => candidate.value.summary);
        return [position.value.summary];
      });
      const reviewState = decisionState(decisions, `conflict:${term.canonicalType}`);
      if (reviewState === "PENDING") summary.unreviewedConflictCount += 1;
      return {
        canonicalType: term.canonicalType,
        label: term.label,
        candidates: [...new Set(candidates)],
        reviewState,
      };
    });
  return { summary, findings, conflicts };
}

function inferredUsableText(document: DocumentRow): boolean {
  if (document.failureCode === "SCANNED_OR_EMPTY" || document.failureCode === "EXTRACTION_FAILED") return false;
  if ((document.pageCount ?? 0) <= 0) return false;
  if (document.ingestionStatus === "UPLOADED") return false;
  return true;
}

function evidenceIssueRows(
  findings: NegotiationFinding[],
  entities: EntityRow[],
  relationships: RelationshipRow[],
  decisions: StoredDecision[],
  corrections: Map<string, StoredCorrection>
) {
  const issues: Array<{
    id: string;
    kind: "TERM" | "ENTITY" | "RELATIONSHIP";
    current: ProvenanceStatus | null;
    addressed: boolean;
    followUp: boolean;
  }> = [];
  const push = (
    id: string,
    kind: "TERM" | "ENTITY" | "RELATIONSHIP",
    original: ProvenanceStatus | null,
    subjectKey: string,
    corrected: boolean
  ) => {
    if (original !== "AMBIGUOUS" && original !== "UNLOCATED") return;
    const state = decisionState(decisions, subjectKey);
    const addressed = corrected || state === "ACKNOWLEDGED";
    issues.push({
      id,
      kind,
      current: addressed ? null : original,
      addressed,
      followUp: state === "NEEDS_FOLLOW_UP",
    });
  };
  for (const finding of findings) {
    push(finding.termId, "TERM", finding.originalProvenanceStatus, `evidence:term:${finding.termId}`, corrections.has(finding.termId));
  }
  for (const row of entities) {
    push(row.id, "ENTITY", row.provenanceStatus, `evidence:entity:${row.id}`, false);
  }
  for (const row of relationships) {
    push(row.id, "RELATIONSHIP", row.provenanceStatus, `evidence:relationship:${row.id}`, false);
  }
  return issues;
}

function reviewWorkFor(input: {
  negotiation: { pendingReviewCount: number; acknowledgedCount: number; followUpCount: number; termCount: number; unreviewedConflictCount: number };
  entities: { found: number; unresolved: number };
  relationships: { found: number; approved: number; rejected: number; acknowledgedBlocked: number };
  evidenceIssues: Array<{ addressed: boolean; followUp: boolean }>;
  conflicts?: NegotiationConflictView[];
}): ReviewWork {
  const work = emptyReviewWork();
  work.negotiationTotal = input.negotiation.termCount;
  work.negotiationPending = input.negotiation.pendingReviewCount;
  work.negotiationAcknowledged = input.negotiation.acknowledgedCount;
  work.negotiationFollowUp = input.negotiation.followUpCount;
  work.conflictTotal = input.conflicts?.length ?? input.negotiation.unreviewedConflictCount;
  work.conflictPending = input.negotiation.unreviewedConflictCount;
  work.conflictFollowUp = (input.conflicts ?? []).filter((conflict) => conflict.reviewState === "NEEDS_FOLLOW_UP").length;
  work.conflictAcknowledged = (input.conflicts ?? []).filter((conflict) => conflict.reviewState === "ACKNOWLEDGED").length;
  work.entitiesTotal = input.entities.found;
  work.entitiesAddressed = input.entities.found - input.entities.unresolved;
  work.relationshipsTotal = input.relationships.found;
  work.relationshipsReviewed =
    input.relationships.approved + input.relationships.rejected + input.relationships.acknowledgedBlocked;
  work.evidenceTotal = input.evidenceIssues.length;
  work.evidenceAddressed = input.evidenceIssues.filter((issue) => issue.addressed).length;
  work.evidenceFollowUp = input.evidenceIssues.filter((issue) => issue.followUp).length;
  return work;
}

function buildItem(input: {
  document: DocumentRow;
  duplicateDocumentIds: string[];
  rounds: RoundRow[];
  entities: EntityRow[];
  relationships: RelationshipRow[];
  decisions: StoredDecision[];
  corrections: StoredCorrection[];
  sourceFileState: SourceFileState;
  hasUsableText?: boolean;
}): { item: InboxItem; findings: NegotiationFinding[]; conflicts: NegotiationConflictView[]; readiness: ReturnType<typeof deriveReadiness>; work: ReviewWork } {
  const document = input.document;
  const entities = input.entities.filter((row) => row.documentId === document.id);
  const relationships = input.relationships.filter((row) => row.documentId === document.id);
  const decisions = input.decisions.filter((row) => row.documentId === document.id);
  const corrections = input.corrections.filter((row) => row.documentId === document.id);
  const leftUnresolvedIds = new Set(
    decisions
      .filter((decision) => decision.kind === "ENTITY_CLOSURE" && decision.reviewState === "LEFT_UNRESOLVED")
      .map((decision) => decision.entityObservationId)
      .filter((id): id is string => Boolean(id))
  );
  let entitiesResolved = 0;
  let entitiesLeftUnresolved = 0;
  let entitiesUnreviewed = 0;
  for (const row of entities) {
    if (row.resolutionLinks.length > 0) entitiesResolved += 1;
    else if (row.dispositions[0]?.disposition === "REJECTED") continue;
    else if (leftUnresolvedIds.has(row.id)) entitiesLeftUnresolved += 1;
    else entitiesUnreviewed += 1;
  }
  const entityReviewSummary = {
    found: entities.length,
    resolved: entitiesResolved,
    unresolved: entitiesUnreviewed,
    leftUnresolved: entitiesLeftUnresolved,
  };
  const relationshipReviewSummary = {
    found: relationships.length,
    pending: 0,
    blocked: 0,
    ready: 0,
    approved: 0,
    rejected: 0,
    acknowledgedBlocked: 0,
  };
  for (const relationship of relationships) {
    const bucket = relationshipBucket(relationship);
    relationshipReviewSummary[bucket] += 1;
  }
  relationshipReviewSummary.pending = relationshipReviewSummary.ready + relationshipReviewSummary.blocked;

  const dealDocuments = [
    {
      id: document.id,
      originalFilename: document.originalFilename,
      documentType: document.documentType,
      documentDate: document.documentDate,
      ingestionStatus: document.ingestionStatus,
      pageCount: document.pageCount,
      createdAt: document.createdAt,
    },
  ];
  const source = {
    id: document.deal.id,
    name: document.deal.name,
    company: document.deal.company,
    property: document.deal.property,
    propertyId: document.deal.propertyId,
    stage: document.deal.stage,
    status: document.deal.status,
    estimatedValue: document.deal.estimatedValue,
    createdAt: document.deal.createdAt,
    negotiationRounds: input.rounds.filter((round) => round.dealId === document.dealId),
    documents: dealDocuments,
  } as NegotiationWorkspaceSource;
  const negotiation = negotiationForDocument(source, document.id, decisions, corrections);
  const correctionByTerm = activeCorrections(corrections);
  const evidenceSummary = { exact: 0, ambiguous: 0, unlocated: 0 };
  const evidenceIssues = evidenceIssueRows(negotiation.findings, entities, relationships, decisions, correctionByTerm);
  for (const finding of negotiation.findings) {
    if (finding.provenanceStatus === "EXACT") evidenceSummary.exact += 1;
  }
  for (const row of [...entities, ...relationships]) {
    if (row.provenanceStatus === "EXACT") evidenceSummary.exact += 1;
  }
  for (const issue of evidenceIssues) {
    if (issue.current === "AMBIGUOUS") evidenceSummary.ambiguous += 1;
    if (issue.current === "UNLOCATED") evidenceSummary.unlocated += 1;
  }
  const conflictFollowUp = negotiation.conflicts.filter((conflict) => conflict.reviewState === "NEEDS_FOLLOW_UP").length;
  const reasons = reviewReasonsFor({
    entities: entityReviewSummary,
    relationships: relationshipReviewSummary,
    negotiation: {
      ...negotiation.summary,
      followUpCount: negotiation.summary.followUpCount + conflictFollowUp,
    },
    evidence: evidenceSummary,
  });
  const usable = input.hasUsableText ?? inferredUsableText(document);
  const readiness = deriveReadiness({
    mimeType: document.mimeType,
    sourceFileState: input.sourceFileState,
    hasUsableText: usable,
    negotiationSide: document.negotiationSide,
    documentDate: document.documentDate,
    dealId: document.dealId,
    ingestionStatus: document.ingestionStatus,
    failureCode: document.failureCode,
  });
  const work = reviewWorkFor({
    negotiation: negotiation.summary,
    entities: entityReviewSummary,
    relationships: relationshipReviewSummary,
    evidenceIssues,
    conflicts: negotiation.conflicts,
  });
  const derived = deriveInboxStatus({
    ingestionStatus: document.ingestionStatus,
    graphExtractionStatus: document.graphExtractionStatus,
    failureCode: document.failureCode,
    fileReady: readiness.fileReady,
    metadataReady: readiness.metadataReady,
    analysisReady: readiness.analysisEligible,
    work,
    reviewReasons: reasons,
  });
  const reviewHref = `/documents/${document.id}/review`;
  const canRetry = canRetryDocument(document);
  const fileAvailable = input.sourceFileState === "AVAILABLE";
  const lifecycle = presentDocumentLifecycle({
    overallStatus: derived.processingStatus,
    ingestionStatus: document.ingestionStatus,
    graphExtractionStatus: document.graphExtractionStatus,
    failureCode: document.failureCode,
    requiresReview: derived.requiresReview,
    canRetry,
  });
  return {
    findings: negotiation.findings,
    conflicts: negotiation.conflicts,
    readiness,
    work,
    item: {
      document: {
        id: document.id,
        filename: document.filename,
        originalFilename: document.originalFilename,
        documentType: document.documentType,
        negotiationSide: document.negotiationSide,
        documentDate: document.documentDate?.toISOString() ?? null,
        uploadedAt: document.createdAt.toISOString(),
        pageCount: document.pageCount,
        sha256: document.sha256,
        ingestionStatus: document.ingestionStatus,
        failureCode: document.failureCode,
        failureReason: document.failureReason,
        graphExtractionStatus: document.graphExtractionStatus,
        graphFailureCode: document.graphFailureCode,
        graphFailureReason: document.graphFailureReason,
        duplicateDocumentIds: input.duplicateDocumentIds,
      },
      deal: {
        id: document.deal.id,
        name: document.deal.name,
        company: document.deal.company,
        property: document.deal.property,
        propertyId: document.deal.propertyId,
        stage: document.deal.stage,
        status: document.deal.status,
        estimatedValue: document.deal.estimatedValue,
      },
      processingStatus: derived.processingStatus,
      lifecycle,
      negotiationSummary: negotiation.summary,
      entityReviewSummary,
      relationshipReviewSummary,
      evidenceSummary,
      requiresReview: derived.requiresReview,
      reviewReasons: derived.requiresReview ? reasons : [],
      uploadedAt: document.createdAt.toISOString(),
      documentDate: document.documentDate?.toISOString() ?? null,
      canRetry,
      reviewHref,
      nextAction: nextActionFor({
        processingStatus: derived.processingStatus,
        canRetry,
        reviewHref,
      }),
      dealHref: `/deals/${document.deal.id}`,
      negotiationHref: `/deals/${document.deal.id}/negotiation`,
      activityHref: `/deals/${document.deal.id}/activity`,
      knowledgeHref: `/deals/${document.deal.id}/knowledge`,
      connectionsHref: `/deals/${document.deal.id}/connections`,
      pdfHref: fileAvailable ? `/api/documents/${document.id}/file` : null,
      sourceFileState: input.sourceFileState,
    },
  };
}

const documentInclude = {
  deal: {
    select: {
      id: true,
      name: true,
      company: true,
      property: true,
      propertyId: true,
      stage: true,
      status: true,
      estimatedValue: true,
      createdAt: true,
      workspaceId: true,
    },
  },
} as const;

async function loadObservations(prisma: PrismaClient, documentIds: string[]) {
  if (documentIds.length === 0) {
    return { entities: [] as EntityRow[], relationships: [] as RelationshipRow[] };
  }
  const [entities, relationships] = await Promise.all([
    prisma.entityObservation.findMany({
      where: { documentId: { in: documentIds } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        documentId: true,
        surfaceForm: true,
        observedType: true,
        evidenceQuote: true,
        provenanceStatus: true,
        documentPage: { select: { pageNumber: true } },
        resolutionLinks: { where: { status: "ACCEPTED" }, select: { id: true } },
        dispositions: { orderBy: { createdAt: "desc" }, take: 1, select: { disposition: true } },
      },
    }),
    prisma.relationshipObservation.findMany({
      where: { documentId: { in: documentIds } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        documentId: true,
        predicate: true,
        evidenceQuote: true,
        provenanceStatus: true,
        objectObservationId: true,
        principalObservationId: true,
        documentPage: { select: { pageNumber: true } },
        promotion: { select: { decision: true } },
        subjectObservation: {
          select: { resolutionLinks: { where: { status: "ACCEPTED" }, select: { id: true } } },
        },
        objectObservation: {
          select: { resolutionLinks: { where: { status: "ACCEPTED" }, select: { id: true } } },
        },
        principalObservation: {
          select: { resolutionLinks: { where: { status: "ACCEPTED" }, select: { id: true } } },
        },
      },
    }),
  ]);
  return { entities, relationships };
}

function duplicateMap(documents: Array<{ id: string; sha256: string }>): Map<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const document of documents) {
    const ids = byHash.get(document.sha256) ?? [];
    ids.push(document.id);
    byHash.set(document.sha256, ids);
  }
  const duplicates = new Map<string, string[]>();
  for (const document of documents) {
    const ids = byHash.get(document.sha256) ?? [];
    duplicates.set(
      document.id,
      ids.filter((id) => id !== document.id)
    );
  }
  return duplicates;
}

export async function getInbox(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    scopeDealId?: string | null;
    filter?: InboxFilter;
    dealId?: string | null;
    documentType?: string | null;
    negotiationSide?: string | null;
    q?: string | null;
    source?: "ALL" | "DOCUMENTS" | "MESSAGES";
    includeMessages?: boolean;
  }
): Promise<InboxPageModel> {
  const [documents, messages] = await Promise.all([prisma.document.findMany({
    where: {
      deal: { workspaceId: input.workspaceId },
      ...(input.scopeDealId ? { dealId: input.scopeDealId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: documentInclude,
  }), input.includeMessages === false ? Promise.resolve([]) : prisma.sourceMessage.findMany({
    where: { workspaceId: input.workspaceId, ...(input.scopeDealId ? { dealId: input.scopeDealId } : {}) },
    take: 200,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      deal: { select: { id: true, name: true, company: true, property: true, propertyId: true, stage: true, status: true, estimatedValue: true } },
      extractionRuns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      reviewDecisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      facts: {
        include: {
          activityExtractionRun: { select: { id: true, status: true, completedAt: true, createdAt: true } },
          reviews: { select: { id: true } },
        },
      },
    },
  })]);
  const dealIds = [...new Set(documents.map((document) => document.dealId))];
  const documentIds = documents.map((document) => document.id);
  const [rounds, observations, decisions, corrections, sourceStates] = await Promise.all([
    dealIds.length
      ? prisma.negotiationRound.findMany({
          where: { dealId: { in: dealIds } },
          select: roundSelect,
          orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([] as RoundRow[]),
    loadObservations(prisma, documentIds),
    loadDecisions(prisma, documentIds),
    loadCorrections(prisma, documentIds),
    sourceStatesFor(documents.map((document) => ({ id: document.id, storageKey: document.storageKey }))),
  ]);
  const duplicates = duplicateMap(documents);
  const built = documents.map((document) =>
    buildItem({
      document,
      duplicateDocumentIds: duplicates.get(document.id) ?? [],
      rounds,
      entities: observations.entities,
      relationships: observations.relationships,
      decisions,
      corrections,
      sourceFileState: sourceStates.get(document.id) ?? "MISSING",
    }).item
  );
  const counts: InboxPageModel["counts"] = {
    ALL: built.length,
    NEEDS_REVIEW: built.filter((item) => item.requiresReview).length,
    PROCESSING: built.filter((item) => matchesInboxFilter(item.processingStatus, item.requiresReview, "PROCESSING")).length,
    COMPLETE: built.filter((item) => item.processingStatus === "REVIEWED").length,
    FAILED: built.filter((item) => item.processingStatus === "FAILED").length,
  };
  const facets = {
    deals: [...new Map([
      ...built.map((item) => [item.deal.id, { id: item.deal.id, name: item.deal.name }] as const),
      ...messages.map((item) => [item.deal.id, { id: item.deal.id, name: item.deal.name }] as const),
    ]).values()],
    documentTypes: [...new Set(built.map((item) => item.document.documentType))].sort(),
    sides: [...new Set(built.map((item) => item.document.negotiationSide).filter((side): side is string => Boolean(side)))].sort(),
  };
  const needle = input.q?.trim().toLowerCase() ?? "";
  const items = built.filter((item) => {
    if (!matchesInboxFilter(item.processingStatus, item.requiresReview, input.filter ?? "ALL")) return false;
    if (input.dealId && item.deal.id !== input.dealId) return false;
    if (input.documentType && item.document.documentType !== input.documentType) return false;
    if (input.negotiationSide && item.document.negotiationSide !== input.negotiationSide) return false;
    if (!needle) return true;
    const haystack = [
      item.document.originalFilename,
      item.document.filename,
      item.deal.name,
      item.deal.company,
      item.deal.property,
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
  const messageItems = messages.map((message) => {
    const facts = factsFromLatestRun(message.facts);
    const lifecycle = deriveMessageLifecycle({
      runs: message.extractionRuns,
      decisions: message.reviewDecisions,
      currentFactIds: facts.map((fact) => fact.id),
      facts,
    });
    return {
      id: message.id,
      subject: message.subject || "Email",
      sender: message.senderName || message.senderAddress || "Unknown sender",
      occurredAt: (message.sentAt ?? message.receivedAt ?? message.createdAt).toISOString(),
      sourceType: message.sourceType,
      ...lifecycle,
      factCount: facts.length,
      failureReason: lifecycle.failureReason,
      deal: message.deal,
      href: `/messages/${message.id}`,
    };
  }).filter((message) => {
    if (input.dealId && message.deal.id !== input.dealId) return false;
    if (needle && ![message.subject, message.sender, message.deal.name, message.deal.company, message.deal.property].join("\n").toLowerCase().includes(needle)) return false;
    const filter = input.filter ?? "ALL";
    if (filter === "NEEDS_REVIEW") return !message.evidenceSettled;
    if (filter === "PROCESSING") return message.analysisState === "ANALYZING";
    if (filter === "COMPLETE") return message.evidenceSettled;
    if (filter === "FAILED") return message.analysisState === "ANALYSIS_FAILED";
    return true;
  });
  const allSources = [
    ...items.map((document) => ({ kind: "DOCUMENT" as const, occurredAt: document.documentDate ?? document.uploadedAt, document })),
    ...messageItems.map((message) => ({ kind: "MESSAGE" as const, occurredAt: message.occurredAt, message })),
  ].filter((item) => input.source === "DOCUMENTS" ? item.kind === "DOCUMENT" : input.source === "MESSAGES" ? item.kind === "MESSAGE" : true)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const allMessageStates = messages.map((message) => {
    const facts = factsFromLatestRun(message.facts);
    return deriveMessageLifecycle({
      runs: message.extractionRuns,
      decisions: message.reviewDecisions,
      currentFactIds: facts.map((fact) => fact.id),
      facts,
    });
  });
  counts.ALL += messages.length;
  counts.NEEDS_REVIEW += allMessageStates.filter((state) => !state.evidenceSettled).length;
  counts.PROCESSING += allMessageStates.filter((state) => state.analysisState === "ANALYZING").length;
  counts.COMPLETE += allMessageStates.filter((state) => state.evidenceSettled).length;
  counts.FAILED += allMessageStates.filter((state) => state.analysisState === "ANALYSIS_FAILED").length;
  const sourceCounts = { ALL: built.length + messages.length, DOCUMENTS: built.length, MESSAGES: messages.length };
  return { workspaceId: input.workspaceId, items, sourceItems: allSources, facets, counts, sourceCounts };
}

function evidenceFor(
  item: InboxItem,
  findings: NegotiationFinding[],
  entities: EntityRow[],
  relationships: RelationshipRow[],
  decisions: StoredDecision[]
) {
  const file = item.pdfHref;
  const records = [
    ...findings.map((finding) => ({
      id: finding.termId,
      kind: "TERM" as const,
      label: finding.label,
      quote: finding.evidenceQuote,
      provenanceStatus: finding.provenanceStatus,
      originalProvenanceStatus: finding.originalProvenanceStatus,
      pageNumber: finding.pageNumber,
      href: file && finding.pageNumber ? `${file}#page=${finding.pageNumber}` : null,
      reviewState: decisionState(decisions, `evidence:term:${finding.termId}`),
      activeCorrectionId: finding.activeCorrectionId,
    })),
    ...entities.map((row) => {
      const pageNumber = provenancePage(row.provenanceStatus, row.documentPage?.pageNumber ?? null);
      return {
        id: row.id,
        kind: "ENTITY" as const,
        label: row.surfaceForm,
        quote: row.evidenceQuote,
        provenanceStatus: row.provenanceStatus,
        originalProvenanceStatus: row.provenanceStatus,
        pageNumber,
        href: file && pageNumber ? `${file}#page=${pageNumber}` : null,
        reviewState: decisionState(decisions, `evidence:entity:${row.id}`),
        activeCorrectionId: null,
      };
    }),
    ...relationships.map((row) => {
      const pageNumber = provenancePage(row.provenanceStatus, row.documentPage?.pageNumber ?? null);
      return {
        id: row.id,
        kind: "RELATIONSHIP" as const,
        label: row.predicate,
        quote: row.evidenceQuote,
        provenanceStatus: row.provenanceStatus,
        originalProvenanceStatus: row.provenanceStatus,
        pageNumber,
        href: file && pageNumber ? `${file}#page=${pageNumber}` : null,
        reviewState: decisionState(decisions, `evidence:relationship:${row.id}`),
        activeCorrectionId: null,
      };
    }),
  ];
  return records;
}

async function loadDecisions(prisma: PrismaClient, documentIds: string[]): Promise<StoredDecision[]> {
  if (documentIds.length === 0) return [];
  return prisma.reviewDecision.findMany({
    where: { documentId: { in: documentIds } },
    select: {
      documentId: true,
      subjectKey: true,
      kind: true,
      negotiationTermId: true,
      canonicalType: true,
      entityObservationId: true,
      relationshipObservationId: true,
      reviewState: true,
      note: true,
    },
  });
}

async function loadCorrections(prisma: PrismaClient, documentIds: string[]): Promise<StoredCorrection[]> {
  if (documentIds.length === 0) return [];
  return prisma.evidenceCorrection.findMany({
    where: { documentId: { in: documentIds }, supersededAt: null },
    select: {
      id: true,
      documentId: true,
      negotiationTermId: true,
      evidenceQuote: true,
      createdAt: true,
      documentPage: { select: { pageNumber: true } },
    },
  });
}

async function sourceStatesFor(documents: Array<{ id: string; storageKey: string }>) {
  const storage = getDocumentStorage();
  const entries = await Promise.all(
    documents.map(async (document) => [document.id, await inspectSourceFile(storage, document.storageKey)] as const)
  );
  return new Map(entries);
}

export async function getDocumentReview(prisma: PrismaClient, workspaceId: string, documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: documentInclude,
  });
  if (!document || document.deal.workspaceId !== workspaceId) return null;
  const [rounds, observations, decisions, corrections, pages, sourceFileState, siblings, promotions] = await Promise.all([
    prisma.negotiationRound.findMany({
      where: { dealId: document.dealId },
      select: roundSelect,
      orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    loadObservations(prisma, [document.id]),
    loadDecisions(prisma, [document.id]),
    loadCorrections(prisma, [document.id]),
    prisma.documentPage.findMany({
      where: { documentId: document.id },
      orderBy: { pageNumber: "asc" },
      select: { id: true, pageNumber: true, text: true },
    }),
    inspectSourceFile(getDocumentStorage(), document.storageKey),
    prisma.document.findMany({
      where: {
        sha256: document.sha256,
        id: { not: document.id },
        deal: { workspaceId },
      },
      select: { id: true },
    }),
    prisma.attachmentDocumentPromotion.findMany({
      where: { documentId, workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        sourceMessageId: true,
        sourceMessageAttachmentId: true,
        originalFilename: true,
        sourceMessage: { select: { subject: true } },
      },
    }),
  ]);
  const built = buildItem({
    document,
    duplicateDocumentIds: siblings.map((row) => row.id),
    rounds,
    entities: observations.entities,
    relationships: observations.relationships,
    decisions,
    corrections,
    sourceFileState,
    hasUsableText: pages.some((page) => page.text.replace(/\s+/g, "").length > 0),
  });
  const metadataMissing = built.readiness.missing
    .filter((gap) => gap.code === "AUTHORING_SIDE" || gap.code === "DOCUMENT_DATE")
    .map((gap) => gap.label.replace("Authoring side", "side").replace("Document date", "date"));
  return {
    item: built.item,
    findings: built.findings,
    conflicts: built.conflicts,
    evidence: evidenceFor(built.item, built.findings, observations.entities, observations.relationships, decisions),
    pages,
    promotionSources: promotions.map((promotion) => ({
      messageId: promotion.sourceMessageId,
      messageSubject: promotion.sourceMessage.subject,
      messageHref: `/messages/${promotion.sourceMessageId}`,
      attachmentId: promotion.sourceMessageAttachmentId,
      attachmentFilename: promotion.originalFilename,
    })),
    progress: reviewProgress({
      sourceFileState,
      metadataReady: built.readiness.metadataReady,
      metadataMissing,
      ingestionStatus: document.ingestionStatus,
      work: built.work,
      overall: built.item.processingStatus,
    }),
    readiness: {
      fileReady: built.readiness.fileReady,
      metadataReady: built.readiness.metadataReady,
      analysisEligible: built.readiness.analysisEligible,
      analysisReady: built.readiness.analysisReady,
      reviewReady: built.readiness.reviewReady,
      missing: built.readiness.missing,
    },
    fileAvailable: sourceFileState === "AVAILABLE",
    completion: completionSummary({
      findings: built.findings,
      entities: observations.entities,
      relationships: observations.relationships,
      decisions,
      corrections,
      item: built.item,
    }),
  };
}

function completionSummary(input: {
  findings: NegotiationFinding[];
  entities: EntityRow[];
  relationships: RelationshipRow[];
  decisions: StoredDecision[];
  corrections: StoredCorrection[];
  item: InboxItem;
}): DocumentCompletionSummary {
  const correctedTerms = new Set(input.corrections.map((correction) => correction.negotiationTermId));
  let evidenceExact = 0;
  for (const finding of input.findings) {
    if (finding.originalProvenanceStatus === "EXACT") evidenceExact += 1;
  }
  for (const row of [...input.entities, ...input.relationships]) {
    if (row.provenanceStatus === "EXACT") evidenceExact += 1;
  }
  const ambiguityAcknowledged = input.decisions.filter((decision) => {
    if (decision.kind !== "EVIDENCE" || decision.reviewState !== "ACKNOWLEDGED") return false;
    if (decision.negotiationTermId && correctedTerms.has(decision.negotiationTermId)) return false;
    return true;
  }).length;
  return {
    findingsReviewed: input.item.negotiationSummary.acknowledgedCount,
    conflictsAcknowledged: input.decisions.filter(
      (decision) => decision.kind === "NEGOTIATION_CONFLICT" && decision.reviewState === "ACKNOWLEDGED"
    ).length,
    entitiesResolved: input.item.entityReviewSummary.resolved,
    entitiesLeftUnresolved: input.item.entityReviewSummary.leftUnresolved,
    relationshipsApproved: input.item.relationshipReviewSummary.approved,
    relationshipsRejected: input.item.relationshipReviewSummary.rejected,
    relationshipsAcknowledgedBlocked: input.item.relationshipReviewSummary.acknowledgedBlocked,
    evidenceExact,
    evidenceCorrected: input.corrections.length,
    ambiguityAcknowledged,
    result: input.item.processingStatus,
  };
}
