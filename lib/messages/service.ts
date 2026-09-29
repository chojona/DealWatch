import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActionSpeakerSide } from "@/lib/ai/activity/actionDirectives";
import {
  deterministicExtractorIdentity,
  extractActivityFacts,
  extractActivityFactsWithModel,
  payloadFromFact,
  type ActivityExtractorIdentity,
  type ExtractedActivityFact,
} from "@/lib/ai/activity/extractActivityFacts";
import { fulfillmentTargetFromPayload, type FulfillmentTarget } from "@/lib/ai/activity/fulfillment";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
import { activitySideLabel, canonicalLabel, storedFactValue } from "./facts";
import { factsFromLatestRun } from "./latestRun";
import {
  ingestSourceMessage as ingestSourceMessageBoundary,
  type NormalizedParticipantInput,
  type NormalizedSourceMessageInput,
} from "./ingest/service";
import { recordedSpeakerSide, type AnalyzeSpeakerChoice } from "./speakerSide";
import { deriveMessageLifecycle, latestMessageRun, storedActionDirective } from "./state";
import { effectiveActivityFact } from "./effective";
import { reviewedReconciliationForFact } from "./reviewedReconciliation";

export type SourceParticipantInput = NormalizedParticipantInput;
export type IngestSourceMessageInput = NormalizedSourceMessageInput;

export interface AnalyzeSourceMessageOptions {
  extractor?: ActivityExtractorIdentity;
  complete?: (prompt: string) => Promise<string>;
  expectedWorkspaceId?: string;
  /** Explicit opt-in. Sender address alone never selects a side. */
  allowParticipationSideLookup?: boolean;
  /**
   * Explicit opt-in for whose side is speaking. Sender address, latest sender,
   * and negotiation state never select this value.
   */
  speakerSide?: ActionSpeakerSide | null;
  /** Explicit product choice, including UNKNOWN. Internal callers may omit it. */
  recordSpeakerSide?: AnalyzeSpeakerChoice | null;
}

const factInclude = {
  activityExtractionRun: {
    select: { id: true, status: true, completedAt: true, createdAt: true },
  },
} as const;

function assertOneSource(sourceMessageId: string | null, dealEventId: string | null) {
  if ((sourceMessageId == null) === (dealEventId == null)) {
    throw new Error("ActivityFact requires exactly one source");
  }
}

async function participationSide(
  db: PrismaClient,
  workspaceId: string,
  dealId: string,
  senderAddress: string | null
): Promise<"TENANT" | "LANDLORD" | null> {
  const email = senderAddress?.trim().toLowerCase();
  if (!email) return null;
  const identifier = await db.personIdentifier.findFirst({
    where: { workspaceId, kind: "EMAIL", normalizedValue: email },
    select: { personId: true },
  });
  if (!identifier) return null;
  const participations = await db.dealParticipation.findMany({
    where: {
      workspaceId,
      dealId,
      personId: identifier.personId,
      status: "ASSERTED",
      role: { in: ["TENANT", "LANDLORD"] },
    },
    select: { role: true },
  });
  const roles = [...new Set(participations.map((row) => row.role))];
  if (roles.length !== 1) return null;
  return roles[0] === "TENANT" || roles[0] === "LANDLORD" ? roles[0] : null;
}

export const ingestSourceMessage = ingestSourceMessageBoundary;

function messageTimestamp(message: { sentAt: Date | null; receivedAt: Date | null; createdAt: Date }): string {
  return (message.sentAt ?? message.receivedAt ?? message.createdAt).toISOString();
}

async function earlierFulfillmentTargets(
  db: PrismaClient,
  message: { id: string; workspaceId: string; dealId: string }
): Promise<FulfillmentTarget[]> {
  const rows = await db.sourceMessage.findMany({
    where: { workspaceId: message.workspaceId, dealId: message.dealId, NOT: { id: message.id } },
    select: {
      id: true,
      workspaceId: true,
      dealId: true,
      sentAt: true,
      receivedAt: true,
      createdAt: true,
      facts: {
        select: {
          id: true,
          assertionStatus: true,
          evidenceQuote: true,
          provenanceStatus: true,
          structuredPayload: true,
          activityExtractionRun: { select: { id: true, status: true, completedAt: true, createdAt: true } },
          reviews: {
            select: {
              id: true,
              state: true,
              createdAt: true,
              correction: { select: { id: true, structuredPayload: true, note: true, createdAt: true } },
            },
          },
        },
      },
    },
  });
  const targets: FulfillmentTarget[] = [];
  for (const row of rows) {
    const timestamp = messageTimestamp(row);
    for (const fact of factsFromLatestRun(row.facts)) {
      const effective = effectiveActivityFact(fact);
      const reviewed = effective.review?.state === "CONFIRMED"
        || (effective.review?.state === "INCORRECT" && Boolean(effective.correction));
      targets.push(fulfillmentTargetFromPayload({
        id: fact.id,
        workspaceId: row.workspaceId,
        dealId: row.dealId,
        timestamp,
        assertionStatus: fact.assertionStatus,
        evidenceQuote: fact.evidenceQuote,
        provenanceStatus: fact.provenanceStatus,
        reviewed,
        payload: effective.presentationPayload,
      }));
    }
  }
  return targets;
}

async function extractFacts(
  message: {
    id: string;
    bodyText: string;
    subject: string | null;
    senderAddress: string | null;
    workspaceId: string;
    dealId: string;
    sentAt: Date | null;
    receivedAt: Date | null;
    createdAt: Date;
  },
  db: PrismaClient,
  options: AnalyzeSourceMessageOptions
): Promise<{ identity: ActivityExtractorIdentity; facts: ExtractedActivityFact[] }> {
  const bounded = { ...message, bodyText: message.bodyText.slice(0, 100_000) };
  if (options.complete) {
    const identity: ActivityExtractorIdentity = {
      ...(options.extractor ?? deterministicExtractorIdentity("activity-model")),
      extractionMethod: "MODEL",
    };
    const facts = await extractActivityFactsWithModel(
      { bodyText: bounded.bodyText, subject: bounded.subject },
      options.complete
    );
    return { identity, facts };
  }
  const identity = options.extractor ?? deterministicExtractorIdentity();
  const side = options.allowParticipationSideLookup
    ? await participationSide(db, message.workspaceId, message.dealId, message.senderAddress)
    : null;
  const targets = await earlierFulfillmentTargets(db, message);
  return {
    identity,
    facts: extractActivityFacts({
      bodyText: bounded.bodyText,
      subject: bounded.subject,
      participationSide: side,
      speakerSide: options.speakerSide ?? null,
      fulfillment: {
        workspaceId: message.workspaceId,
        dealId: message.dealId,
        timestamp: messageTimestamp(message),
        targets,
      },
    }),
  };
}

export async function analyzeSourceMessage(
  db: PrismaClient,
  sourceMessageId: string,
  options: AnalyzeSourceMessageOptions = {}
) {
  const message = await db.sourceMessage.findUnique({
    where: { id: sourceMessageId },
    select: {
      id: true,
      workspaceId: true,
      dealId: true,
      bodyText: true,
      subject: true,
      senderAddress: true,
      sentAt: true,
      receivedAt: true,
      createdAt: true,
      deal: { select: { workspaceId: true } },
    },
  });
  if (!message || message.deal.workspaceId !== message.workspaceId) {
    throw new Error("Message not found");
  }
  if (options.expectedWorkspaceId && options.expectedWorkspaceId !== message.workspaceId) {
    throw new Error("Message not found");
  }
  const selectedIdentity: ActivityExtractorIdentity = options.complete
    ? { ...(options.extractor ?? deterministicExtractorIdentity("activity-model")), extractionMethod: "MODEL" }
    : (options.extractor ?? deterministicExtractorIdentity());
  const identity = {
    sourceMessageId: message.id,
    extractor: selectedIdentity.extractor,
    extractorVersion: selectedIdentity.extractorVersion,
    contractVersion: selectedIdentity.contractVersion,
    model: selectedIdentity.model,
  };
  const prior = await db.activityExtractionRun.findUnique({
    where: { sourceMessageId_extractor_extractorVersion_contractVersion_model: identity },
  });
  if (prior?.status === "SUCCEEDED") {
    return { runId: prior.id, idempotent: true, factCount: prior.factCount };
  }
  if (prior?.status === "RUNNING") {
    return { runId: prior.id, idempotent: true, factCount: prior.factCount };
  }
  const speakerSide = recordedSpeakerSide(options);
  let run;
  try {
    run = await db.$transaction(async (tx) => {
      const started = prior
        ? await tx.activityExtractionRun.update({ where: { id: prior.id }, data: { status: "RUNNING", failureCode: null, failureReason: null, completedAt: null, speakerSide } })
        : await tx.activityExtractionRun.create({ data: { ...identity, workspaceId: message.workspaceId, status: "RUNNING", speakerSide } });
      await tx.messageReviewEvent.create({
        data: { workspaceId: message.workspaceId, sourceMessageId: message.id, eventType: "ANALYSIS_STARTED", actor: "SYSTEM", detail: { runId: started.id } },
      });
      return started;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racing = await db.activityExtractionRun.findUnique({ where: { sourceMessageId_extractor_extractorVersion_contractVersion_model: identity } });
      if (racing) return { runId: racing.id, idempotent: true, factCount: racing.factCount };
    }
    throw error;
  }
  let extracted: Awaited<ReturnType<typeof extractFacts>>;
  try {
    extracted = await extractFacts(message, db, { ...options, extractor: selectedIdentity });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Activity extraction failed").slice(0, 1000);
    await db.$transaction([
      db.activityExtractionRun.update({ where: { id: run.id }, data: { status: "FAILED", failureCode: "EXTRACTION_FAILED", failureReason: reason, factCount: 0, completedAt: new Date() } }),
      db.messageReviewEvent.create({ data: { workspaceId: message.workspaceId, sourceMessageId: message.id, eventType: "ANALYSIS_FAILED", actor: "SYSTEM", detail: { runId: run.id, reason } } }),
    ]);
    throw error;
  }

  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.activityExtractionRun.findUniqueOrThrow({ where: { id: run.id } });
      if (current.status === "SUCCEEDED") return { runId: current.id, idempotent: true, factCount: current.factCount };
      for (const fact of extracted.facts) {
        assertOneSource(message.id, null);
        await tx.activityFact.create({ data: {
          workspaceId: message.workspaceId,
          dealId: message.dealId,
          sourceMessageId: message.id,
          dealEventId: null,
          activityExtractionRunId: current.id,
          factType: fact.factType,
          canonicalType: fact.canonicalType,
          side: fact.side,
          assertionStatus: fact.assertionStatus,
          structuredPayload: payloadFromFact(fact) as Prisma.InputJsonValue,
          evidenceQuote: fact.evidenceQuote,
          evidenceStartOffset: fact.evidenceStartOffset,
          evidenceEndOffset: fact.evidenceEndOffset,
          provenanceStatus: fact.provenanceStatus,
          extractionMethod: selectedIdentity.extractionMethod,
          extractorVersion: identity.extractorVersion,
          model: identity.model,
        } });
      }
      await tx.activityExtractionRun.update({ where: { id: current.id }, data: { status: "SUCCEEDED", failureCode: null, failureReason: null, factCount: extracted.facts.length, completedAt: new Date() } });
      await tx.messageReviewEvent.create({ data: { workspaceId: message.workspaceId, sourceMessageId: message.id, eventType: "ANALYSIS_SUCCEEDED", actor: "SYSTEM", detail: { runId: current.id, factCount: extracted.facts.length } } });
      return { runId: current.id, idempotent: false, factCount: extracted.facts.length };
    });
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "Activity facts could not be stored").slice(0, 1000);
    await db.$transaction([
      db.activityExtractionRun.update({ where: { id: run.id }, data: { status: "FAILED", failureCode: "PERSISTENCE_FAILED", failureReason: reason, factCount: 0, completedAt: new Date() } }),
      db.messageReviewEvent.create({ data: { workspaceId: message.workspaceId, sourceMessageId: message.id, eventType: "ANALYSIS_FAILED", actor: "SYSTEM", detail: { runId: run.id, reason } } }),
    ]).catch(() => undefined);
    throw error;
  }
}

export interface MessageFactView {
  id: string;
  factType: string;
  canonicalType: string | null;
  label: string;
  side: string;
  sideLabel: string;
  value: string;
  rawNumeric: number | null;
  rawUnit: string | null;
  assertionStatus: string;
  assertionLabel: string;
  evidenceQuote: string;
  provenanceStatus: string;
  evidenceStartOffset: number | null;
  evidenceEndOffset: number | null;
  reconciliation: ReconciliationLink | null;
  reviewedValue: string | null;
  reviewState: string | null;
  reviewedReconciliation: ReconciliationLink | null;
  hasAction: boolean;
}

export interface MessageSourceView {
  id: string;
  subject: string | null;
  senderName: string | null;
  senderAddress: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  sourceType: string;
  importedAt: string;
  bodyText: string;
  analysisState: string;
  reviewState: string;
  actionReviewState: string;
  evidenceSettled: boolean;
  lifecycleState: string;
  speakerSide: "OUR_SIDE" | "COUNTERPARTY" | "UNKNOWN" | null;
  failureCode: string | null;
  failureReason: string | null;
  originalSourceHref: string | null;
  originalFilename: string | null;
  factSummary: { total: number; negotiation: number; other: number };
  deal: { id: string; name: string; href: string };
  activityHref: string;
  negotiationHref: string;
  participants: Array<{ role: string; displayName: string | null; address: string }>;
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
    contentId: string | null;
    disposition: string | null;
    sha256: string | null;
    analysisState: "NOT_ANALYZED" | "PROMOTED";
    promotion: {
      documentId: string;
      href: string;
      ingestionStatus: string;
    } | null;
  }>;
  reviewHistory: Array<{ id: string; type: string; actor: string; createdAt: string; activityFactId: string | null; detail: unknown }>;
  facts: MessageFactView[];
}

export async function getMessageSource(db: PrismaClient, sourceMessageId: string, options: { expectedWorkspaceId?: string } = {}): Promise<MessageSourceView | null> {
  const message = await db.sourceMessage.findUnique({
    where: { id: sourceMessageId },
    include: {
      deal: { select: { id: true, name: true, workspaceId: true } },
      participants: { orderBy: [{ role: "asc" }, { address: "asc" }] },
      attachments: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          promotion: {
            select: { document: { select: { id: true, ingestionStatus: true } } },
          },
        },
      },
      extractionRuns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      reviewDecisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      reviewEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      facts: {
        include: {
          ...factInclude,
          reviews: { include: { correction: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!message || message.deal.workspaceId !== message.workspaceId || (options.expectedWorkspaceId && options.expectedWorkspaceId !== message.workspaceId)) return null;
  const reconciliation = await getDealReconciliation(db, message.dealId);
  const links = reconciliation?.links.filter((link) => link.activityEventId === `source-message:${message.id}`) ?? [];
  const facts = factsFromLatestRun(message.facts);
  const lifecycle = deriveMessageLifecycle({
    runs: message.extractionRuns,
    decisions: message.reviewDecisions,
    currentFactIds: facts.map((fact) => fact.id),
    facts,
  });
  const run = latestMessageRun(message.extractionRuns);
  const speakerSide = run?.speakerSide === "OUR_SIDE" || run?.speakerSide === "COUNTERPARTY" || run?.speakerSide === "UNKNOWN"
    ? run.speakerSide
    : null;
  return {
    id: message.id,
    subject: message.subject,
    senderName: message.senderName,
    senderAddress: message.senderAddress,
    sentAt: message.sentAt?.toISOString() ?? null,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    sourceType: message.sourceType,
    importedAt: message.createdAt.toISOString(),
    bodyText: message.bodyText,
    ...lifecycle,
    speakerSide,
    originalSourceHref: message.sourceStorageKey ? `/api/messages/${message.id}/source` : null,
    originalFilename: message.originalFilename,
    factSummary: {
      total: facts.length,
      negotiation: facts.filter((fact) => fact.factType === "NEGOTIATION_VALUE").length,
      other: facts.filter((fact) => fact.factType !== "NEGOTIATION_VALUE").length,
    },
    deal: { id: message.deal.id, name: message.deal.name, href: `/deals/${message.deal.id}` },
    activityHref: `/deals/${message.deal.id}/activity`,
    negotiationHref: `/deals/${message.deal.id}/negotiation`,
    participants: message.participants.map((item) => ({
      role: item.role,
      displayName: item.displayName,
      address: item.address,
    })),
    attachments: message.attachments.map((item) => ({
      id: item.id,
      filename: item.filename,
      contentType: item.contentType,
      size: item.size,
      contentId: item.contentId,
      disposition: item.disposition,
      sha256: item.sha256,
      analysisState: item.promotion ? "PROMOTED" as const : "NOT_ANALYZED" as const,
      promotion: item.promotion
        ? {
            documentId: item.promotion.document.id,
            href: `/documents/${item.promotion.document.id}/review`,
            ingestionStatus: item.promotion.document.ingestionStatus,
          }
        : null,
    })),
    reviewHistory: message.reviewEvents.map((item) => ({
      id: item.id,
      type: item.eventType,
      actor: item.actor,
      createdAt: item.createdAt.toISOString(),
      activityFactId: item.activityFactId,
      detail: item.detail,
    })),
    facts: facts.map((fact) => {
      const value = storedFactValue(fact.structuredPayload);
      const numeric = value.numeric;
      const reconciliationLink = links.find((link) =>
        link.canonicalType === fact.canonicalType
        && link.eventSide === fact.side
        && (numeric == null || link.eventValue?.numeric === numeric)
      ) ?? null;
      const effective = effectiveActivityFact(fact);
      const reviewedReconciliation = effective.correction
        ? reviewedReconciliationForFact(reconciliationLink, effective.correction.payload)
        : null;
      return {
        id: fact.id,
        factType: fact.factType,
        canonicalType: fact.canonicalType,
        label: fact.canonicalType ? canonicalLabel(fact.canonicalType) : canonicalLabel(fact.factType),
        side: fact.side,
        sideLabel: activitySideLabel(fact.side),
        value: value.display ?? fact.evidenceQuote,
        rawNumeric: value.numeric,
        rawUnit: value.unit,
        assertionStatus: fact.assertionStatus,
        assertionLabel: canonicalLabel(fact.assertionStatus),
        evidenceQuote: fact.evidenceQuote,
        provenanceStatus: fact.provenanceStatus,
        evidenceStartOffset: fact.evidenceStartOffset,
        evidenceEndOffset: fact.evidenceEndOffset,
        reconciliation: reconciliationLink,
        reviewedValue: effective.correction?.value.display ?? null,
        reviewState: effective.review?.state ?? null,
        reviewedReconciliation,
        hasAction: Boolean(storedActionDirective(fact.structuredPayload)),
      };
    }),
  };
}
