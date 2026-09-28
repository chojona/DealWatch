import type { AnalyzeThreadOutput, ObligationStatus } from "@/types";
import type { ThreadExtraction } from "./analysisSchemas";

const MIN_CONFIDENCE = {
  event: 0.55,
  commitment: 0.65,
  request: 0.55,
  conditionalFollowUp: 0.6,
  update: 0.65,
  deal: 0.6,
} as const;

const ISO_TIMESTAMP_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

interface ReconcileInput {
  threadText: string;
  analyzedAt: Date;
  extraction: ThreadExtraction;
  model: string;
  latencyMs: number;
}

interface CandidateObligation {
  id: string;
  owner: string;
  counterparty?: string;
  description: string;
  dueAt?: string;
  messageAt?: number;
  kind: ThreadExtraction["obligations"][number]["kind"];
  accountableParty: ThreadExtraction["obligations"][number]["accountableParty"];
  confidence: number;
  evidenceQuote: string;
  statusEvidenceQuote?: string;
  sourceIndex: number;
}

function isConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function exactEvidence(threadText: string, quote: string | null): string | null {
  if (!quote) return null;
  const trimmed = quote.trim();
  return trimmed.length > 0 && threadText.includes(trimmed) ? trimmed : null;
}

function canonicalTimestamp(value: string | null): string | undefined {
  if (!value || !ISO_TIMESTAMP_WITH_ZONE.test(value)) return undefined;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : undefined;
}

function textContains(threadText: string, value: string): boolean {
  return threadText.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase());
}

function obligationThreshold(
  kind: CandidateObligation["kind"]
): number {
  if (kind === "REQUEST") return MIN_CONFIDENCE.request;
  if (kind === "CONDITIONAL_FOLLOW_UP") {
    return MIN_CONFIDENCE.conditionalFollowUp;
  }
  return MIN_CONFIDENCE.commitment;
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function statusPriority(status: ObligationStatus): number {
  if (status === "COMPLETED") return 4;
  if (status === "OVERDUE") return 3;
  if (status === "WAITING") return 2;
  return 1;
}

function actionPriority(
  obligation: AnalyzeThreadOutput["obligations"][number]
): number {
  if (obligation.status === "OVERDUE") return 4;
  if (obligation.accountableParty === "OUR_SIDE") return 3;
  if (obligation.status === "WAITING") return 2;
  return 1;
}

function calculateStatus(
  obligation: CandidateObligation,
  completedIds: Set<string>,
  analyzedAt: Date
): ObligationStatus {
  if (completedIds.has(obligation.id)) return "COMPLETED";
  if (obligation.dueAt && Date.parse(obligation.dueAt) < analyzedAt.getTime()) {
    return "OVERDUE";
  }
  if (obligation.accountableParty === "COUNTERPARTY") return "WAITING";
  return "OPEN";
}

function urgencyFor(
  status: ObligationStatus,
  dueAt: string | undefined,
  analyzedAt: Date
): "LOW" | "MEDIUM" | "HIGH" {
  if (status === "OVERDUE") return "HIGH";
  if (!dueAt) return status === "WAITING" ? "MEDIUM" : "LOW";

  const remaining = Date.parse(dueAt) - analyzedAt.getTime();
  if (remaining <= 24 * 60 * 60 * 1000) return "HIGH";
  if (remaining <= 3 * 24 * 60 * 60 * 1000) return "MEDIUM";
  return "LOW";
}

function buildNextAction(
  obligations: AnalyzeThreadOutput["obligations"],
  events: AnalyzeThreadOutput["events"],
  brokerName: string | undefined,
  analyzedAt: Date
): AnalyzeThreadOutput["nextAction"] {
  const active = obligations.filter((item) => item.status !== "COMPLETED");
  active.sort((a, b) => {
    const priority = actionPriority(b) - actionPriority(a);
    if (priority !== 0) return priority;
    const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
    return aDue - bDue;
  });

  const obligation = active[0];
  if (obligation) {
    const requiresBrokerFollowUp =
      obligation.accountableParty === "COUNTERPARTY";
    return {
      description: requiresBrokerFollowUp
        ? `Follow up with ${obligation.owner}: ${obligation.description}`
        : obligation.description,
      owner: requiresBrokerFollowUp
        ? obligation.counterparty ?? brokerName ?? "Broker"
        : obligation.owner,
      urgency: urgencyFor(obligation.status, obligation.dueAt, analyzedAt),
      confidence: obligation.confidence,
      evidenceQuote: obligation.statusEvidenceQuote ?? obligation.evidenceQuote,
    };
  }

  const latestEvent = events.at(-1);
  const unansweredCounter =
    latestEvent?.type === "COUNTER_RECEIVED" ? latestEvent : undefined;
  if (unansweredCounter) {
    return {
      description: `Review and respond to the counterproposal: ${unansweredCounter.description}`,
      owner: brokerName ?? "Broker",
      urgency: "MEDIUM",
      confidence: Math.min(0.8, unansweredCounter.confidence),
      evidenceQuote: unansweredCounter.evidenceQuote,
    };
  }

  return undefined;
}

export function reconcileAnalysis({
  threadText,
  analyzedAt,
  extraction,
  model,
  latencyMs,
}: ReconcileInput): AnalyzeThreadOutput {
  let validationFailures = 0;

  const dealEvidence = exactEvidence(
    threadText,
    extraction.deal.evidenceQuote
  );
  const validDeal =
    dealEvidence !== null &&
    isConfidence(extraction.deal.confidence) &&
    extraction.deal.confidence >= MIN_CONFIDENCE.deal;

  const deal: AnalyzeThreadOutput["deal"] = {};
  if (validDeal) {
    if (
      extraction.deal.company &&
      textContains(threadText, extraction.deal.company)
    ) {
      deal.company = extraction.deal.company.trim();
    } else if (extraction.deal.company) {
      validationFailures += 1;
    }

    if (
      extraction.deal.property &&
      textContains(threadText, extraction.deal.property)
    ) {
      deal.property = extraction.deal.property.trim();
    } else if (extraction.deal.property) {
      validationFailures += 1;
    }

    if (
      extraction.deal.brokerName &&
      textContains(threadText, extraction.deal.brokerName)
    ) {
      deal.brokerName = extraction.deal.brokerName.trim();
    } else if (extraction.deal.brokerName) {
      validationFailures += 1;
    }

    if (extraction.deal.stage) deal.stage = extraction.deal.stage;
    deal.confidence = extraction.deal.confidence;
    deal.evidenceQuote = dealEvidence;
  } else if (
    extraction.deal.company ||
    extraction.deal.property ||
    extraction.deal.stage ||
    extraction.deal.brokerName ||
    extraction.deal.evidenceQuote
  ) {
    validationFailures += 1;
  }

  const events: AnalyzeThreadOutput["events"] = [];
  const eventKeys = new Set<string>();
  for (const event of extraction.events) {
    const evidenceQuote = exactEvidence(threadText, event.evidenceQuote);
    if (
      !evidenceQuote ||
      !event.description.trim() ||
      !isConfidence(event.confidence) ||
      event.confidence < MIN_CONFIDENCE.event
    ) {
      validationFailures += 1;
      continue;
    }

    const key = `${event.type}|${normalized(evidenceQuote)}`;
    if (eventKeys.has(key)) {
      validationFailures += 1;
      continue;
    }
    eventKeys.add(key);

    const occurredAt = canonicalTimestamp(event.occurredAt);
    if (event.occurredAt && !occurredAt) validationFailures += 1;
    events.push({
      type: event.type,
      description: event.description.trim(),
      ...(occurredAt ? { occurredAt } : {}),
      confidence: event.confidence,
      evidenceQuote,
    });
  }

  const candidates: CandidateObligation[] = [];
  const candidateIds = new Set<string>();
  extraction.obligations.forEach((obligation, sourceIndex) => {
    const evidenceQuote = exactEvidence(threadText, obligation.evidenceQuote);
    if (
      !obligation.id.trim() ||
      candidateIds.has(obligation.id) ||
      !obligation.owner.trim() ||
      !obligation.description.trim() ||
      !evidenceQuote ||
      !isConfidence(obligation.confidence) ||
      obligation.confidence < obligationThreshold(obligation.kind)
    ) {
      validationFailures += 1;
      return;
    }

    const dueAt = canonicalTimestamp(obligation.dueAt);
    const messageAt = canonicalTimestamp(obligation.messageAt);
    if (obligation.dueAt && !dueAt) validationFailures += 1;
    if (obligation.messageAt && !messageAt) validationFailures += 1;

    candidateIds.add(obligation.id);
    candidates.push({
      id: obligation.id,
      owner: obligation.owner.trim(),
      ...(obligation.counterparty?.trim()
        ? { counterparty: obligation.counterparty.trim() }
        : {}),
      description: obligation.description.trim(),
      ...(dueAt ? { dueAt } : {}),
      ...(messageAt ? { messageAt: Date.parse(messageAt) } : {}),
      kind: obligation.kind,
      accountableParty: obligation.accountableParty,
      confidence: obligation.confidence,
      evidenceQuote,
      sourceIndex,
    });
  });

  const candidateById = new Map(candidates.map((item) => [item.id, item]));
  const completedIds = new Set<string>();
  const supersededIds = new Set<string>();

  for (const update of extraction.obligationUpdates) {
    const evidenceQuote = exactEvidence(threadText, update.evidenceQuote);
    const target = candidateById.get(update.targetObligationId);
    const occurredAt = canonicalTimestamp(update.occurredAt);

    if (
      !evidenceQuote ||
      !target ||
      !isConfidence(update.confidence) ||
      update.confidence < MIN_CONFIDENCE.update ||
      (update.occurredAt !== null && !occurredAt) ||
      (occurredAt !== undefined &&
        target.messageAt !== undefined &&
        Date.parse(occurredAt) < target.messageAt)
    ) {
      validationFailures += 1;
      continue;
    }

    if (update.type === "COMPLETES") {
      completedIds.add(target.id);
      target.statusEvidenceQuote = evidenceQuote;
      continue;
    }

    const replacement = update.replacementObligationId
      ? candidateById.get(update.replacementObligationId)
      : undefined;
    if (
      !replacement ||
      replacement.id === target.id ||
      (replacement.messageAt !== undefined &&
        target.messageAt !== undefined &&
        replacement.messageAt < target.messageAt)
    ) {
      validationFailures += 1;
      continue;
    }
    supersededIds.add(target.id);
  }

  const reconciled = candidates
    .filter((candidate) => !supersededIds.has(candidate.id))
    .map((candidate) => ({
      candidate,
      output: {
        owner: candidate.owner,
        ...(candidate.counterparty
          ? { counterparty: candidate.counterparty }
          : {}),
        description: candidate.description,
        ...(candidate.dueAt ? { dueAt: candidate.dueAt } : {}),
        status: calculateStatus(candidate, completedIds, analyzedAt),
        kind: candidate.kind,
        accountableParty: candidate.accountableParty,
        confidence: candidate.confidence,
        evidenceQuote: candidate.evidenceQuote,
        ...(candidate.statusEvidenceQuote
          ? { statusEvidenceQuote: candidate.statusEvidenceQuote }
          : {}),
      } satisfies AnalyzeThreadOutput["obligations"][number],
    }));

  const obligationByKey = new Map<
    string,
    (typeof reconciled)[number]
  >();
  for (const item of reconciled) {
    const key = [
      normalized(item.output.owner),
      normalized(item.output.description),
      normalized(item.output.evidenceQuote),
    ].join("|");
    const existing = obligationByKey.get(key);
    if (!existing) {
      obligationByKey.set(key, item);
      continue;
    }

    validationFailures += 1;
    if (statusPriority(item.output.status) > statusPriority(existing.output.status)) {
      obligationByKey.set(key, item);
    }
  }

  const obligations = [...obligationByKey.values()]
    .sort((a, b) => a.candidate.sourceIndex - b.candidate.sourceIndex)
    .map((item) => item.output);

  const confidenceValues = [
    ...(deal.confidence !== undefined ? [deal.confidence] : []),
    ...events.map((event) => event.confidence),
    ...obligations.map((obligation) => obligation.confidence),
  ];
  const extractionConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length
      : clampConfidence(extraction.overallConfidence);
  if (!isConfidence(extraction.overallConfidence)) validationFailures += 1;

  const nextAction = buildNextAction(
    obligations,
    events,
    deal.brokerName,
    analyzedAt
  );

  return {
    deal,
    events,
    obligations,
    ...(nextAction ? { nextAction } : {}),
    metadata: {
      model,
      analyzedAt: analyzedAt.toISOString(),
      latencyMs: Math.max(0, Math.round(latencyMs)),
      extractionConfidence: clampConfidence(extractionConfidence),
      detectedEvents: events.length,
      detectedObligations: obligations.length,
      validationFailures,
    },
  };
}
