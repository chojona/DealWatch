import { Prisma, type PrismaClient } from "@prisma/client";
import {
  deterministicExtractorIdentity,
  extractActivityFacts,
  extractActivityFactsWithModel,
  payloadFromFact,
  type ActivityExtractorIdentity,
  type ExtractedActivityFact,
} from "@/lib/ai/activity/extractActivityFacts";
import type { ReconciliationLink } from "@/lib/deals/reconciliation/types";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
import { activitySideLabel, canonicalLabel, storedFactValue } from "./facts";
import { factsFromLatestRun } from "./latestRun";

export interface SourceParticipantInput {
  role: "FROM" | "TO" | "CC" | "BCC";
  displayName?: string | null;
  address: string;
}

export interface IngestSourceMessageInput {
  dealId: string;
  externalMessageId?: string | null;
  threadExternalId?: string | null;
  subject?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  sentAt?: Date | null;
  receivedAt?: Date | null;
  bodyText: string;
  sourceType: "MANUAL" | "FIXTURE" | "IMPORTED";
  legacyDealEventId?: string | null;
  participants?: SourceParticipantInput[];
}

export interface AnalyzeSourceMessageOptions {
  extractor?: ActivityExtractorIdentity;
  complete?: (prompt: string) => Promise<string>;
  /** Explicit opt-in. Sender address alone never selects a side. */
  allowParticipationSideLookup?: boolean;
}

const factInclude = {
  activityExtractionRun: {
    select: { id: true, status: true, completedAt: true, createdAt: true },
  },
} as const;

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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

export async function ingestSourceMessage(db: PrismaClient, input: IngestSourceMessageInput) {
  const deal = await db.deal.findUnique({
    where: { id: input.dealId },
    select: { id: true, workspaceId: true },
  });
  if (!deal) throw new Error("Deal not found");
  if (input.legacyDealEventId) {
    const event = await db.dealEvent.findFirst({
      where: { id: input.legacyDealEventId, dealId: deal.id, deal: { workspaceId: deal.workspaceId } },
      select: { id: true },
    });
    if (!event) throw new Error("Legacy deal event is not on this deal");
  }
  const participants = [...(input.participants ?? [])];
  const sender = input.senderAddress?.trim();
  if (sender && !participants.some((item) => item.role === "FROM" && item.address.trim().toLowerCase() === sender.toLowerCase())) {
    participants.unshift({ role: "FROM", displayName: input.senderName ?? null, address: sender });
  }
  return db.sourceMessage.create({
    data: {
      workspaceId: deal.workspaceId,
      dealId: deal.id,
      externalMessageId: input.externalMessageId ?? null,
      threadExternalId: input.threadExternalId ?? null,
      subject: input.subject ?? null,
      senderName: input.senderName ?? null,
      senderAddress: sender ?? null,
      sentAt: input.sentAt ?? null,
      receivedAt: input.receivedAt ?? null,
      bodyText: input.bodyText,
      sourceType: input.sourceType,
      legacyDealEventId: input.legacyDealEventId ?? null,
      participants: {
        create: participants.map((item) => ({
          role: item.role,
          displayName: item.displayName ?? null,
          address: item.address.trim(),
        })),
      },
    },
    include: { participants: { orderBy: { createdAt: "asc" } } },
  });
}

async function extractFacts(
  message: { bodyText: string; subject: string | null; senderAddress: string | null; workspaceId: string; dealId: string },
  db: PrismaClient,
  options: AnalyzeSourceMessageOptions
): Promise<{ identity: ActivityExtractorIdentity; facts: ExtractedActivityFact[] }> {
  if (options.complete) {
    const identity: ActivityExtractorIdentity = {
      ...(options.extractor ?? deterministicExtractorIdentity("activity-model")),
      extractionMethod: "MODEL",
    };
    const facts = await extractActivityFactsWithModel(
      { bodyText: message.bodyText, subject: message.subject },
      options.complete
    );
    return { identity, facts };
  }
  const identity = options.extractor ?? deterministicExtractorIdentity();
  const side = options.allowParticipationSideLookup
    ? await participationSide(db, message.workspaceId, message.dealId, message.senderAddress)
    : null;
  return {
    identity,
    facts: extractActivityFacts({
      bodyText: message.bodyText,
      subject: message.subject,
      participationSide: side,
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
      deal: { select: { workspaceId: true } },
    },
  });
  if (!message || message.deal.workspaceId !== message.workspaceId) {
    throw new Error("Message not found");
  }
  const extracted = await extractFacts(message, db, options);
  const identity = {
    sourceMessageId: message.id,
    extractor: extracted.identity.extractor,
    extractorVersion: extracted.identity.extractorVersion,
    contractVersion: extracted.identity.contractVersion,
    model: extracted.identity.model,
  };

  const persist = async () => db.$transaction(async (tx) => {
    const existing = await tx.activityExtractionRun.findUnique({
      where: { sourceMessageId_extractor_extractorVersion_contractVersion_model: identity },
    });
    if (existing?.status === "SUCCEEDED") {
      return { runId: existing.id, idempotent: true, factCount: existing.factCount };
    }
    const run = existing
      ? await tx.activityExtractionRun.update({
          where: { id: existing.id },
          data: {
            status: "SUCCEEDED",
            failureCode: null,
            failureReason: null,
            factCount: extracted.facts.length,
            completedAt: new Date(),
          },
        })
      : await tx.activityExtractionRun.create({
          data: {
            ...identity,
            workspaceId: message.workspaceId,
            status: "SUCCEEDED",
            factCount: extracted.facts.length,
            completedAt: new Date(),
          },
        });
    for (const fact of extracted.facts) {
      assertOneSource(message.id, null);
      await tx.activityFact.create({
        data: {
          workspaceId: message.workspaceId,
          dealId: message.dealId,
          sourceMessageId: message.id,
          dealEventId: null,
          activityExtractionRunId: run.id,
          factType: fact.factType,
          canonicalType: fact.canonicalType,
          side: fact.side,
          assertionStatus: fact.assertionStatus,
          structuredPayload: payloadFromFact(fact) as Prisma.InputJsonValue,
          evidenceQuote: fact.evidenceQuote,
          evidenceStartOffset: fact.evidenceStartOffset,
          evidenceEndOffset: fact.evidenceEndOffset,
          provenanceStatus: fact.provenanceStatus,
          extractionMethod: extracted.identity.extractionMethod,
          extractorVersion: identity.extractorVersion,
          model: identity.model,
        },
      });
    }
    return { runId: run.id, idempotent: false, factCount: extracted.facts.length };
  });

  try {
    return await persist();
  } catch (error) {
    if (!isUnique(error)) throw error;
    const existing = await db.activityExtractionRun.findUnique({
      where: { sourceMessageId_extractor_extractorVersion_contractVersion_model: identity },
    });
    if (existing?.status === "SUCCEEDED") {
      return { runId: existing.id, idempotent: true, factCount: existing.factCount };
    }
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
  assertionStatus: string;
  assertionLabel: string;
  evidenceQuote: string;
  provenanceStatus: string;
  evidenceStartOffset: number | null;
  evidenceEndOffset: number | null;
  reconciliation: ReconciliationLink | null;
}

export interface MessageSourceView {
  id: string;
  subject: string | null;
  senderName: string | null;
  senderAddress: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  sourceType: string;
  bodyText: string;
  deal: { id: string; name: string; href: string };
  activityHref: string;
  negotiationHref: string;
  participants: Array<{ role: string; displayName: string | null; address: string }>;
  facts: MessageFactView[];
}

export async function getMessageSource(db: PrismaClient, sourceMessageId: string): Promise<MessageSourceView | null> {
  const message = await db.sourceMessage.findUnique({
    where: { id: sourceMessageId },
    include: {
      deal: { select: { id: true, name: true, workspaceId: true } },
      participants: { orderBy: [{ role: "asc" }, { address: "asc" }] },
      facts: { include: factInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!message || message.deal.workspaceId !== message.workspaceId) return null;
  const reconciliation = await getDealReconciliation(db, message.dealId);
  const links = reconciliation?.links.filter((link) => link.activityEventId === `source-message:${message.id}`) ?? [];
  const facts = factsFromLatestRun(message.facts);
  return {
    id: message.id,
    subject: message.subject,
    senderName: message.senderName,
    senderAddress: message.senderAddress,
    sentAt: message.sentAt?.toISOString() ?? null,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    sourceType: message.sourceType,
    bodyText: message.bodyText,
    deal: { id: message.deal.id, name: message.deal.name, href: `/deals/${message.deal.id}` },
    activityHref: `/deals/${message.deal.id}/activity`,
    negotiationHref: `/deals/${message.deal.id}/negotiation`,
    participants: message.participants.map((item) => ({
      role: item.role,
      displayName: item.displayName,
      address: item.address,
    })),
    facts: facts.map((fact) => {
      const value = storedFactValue(fact.structuredPayload);
      const numeric = value.numeric;
      const reconciliationLink = links.find((link) =>
        link.canonicalType === fact.canonicalType
        && link.eventSide === fact.side
        && (numeric == null || link.eventValue?.numeric === numeric)
      ) ?? null;
      return {
        id: fact.id,
        factType: fact.factType,
        canonicalType: fact.canonicalType,
        label: fact.canonicalType ? canonicalLabel(fact.canonicalType) : canonicalLabel(fact.factType),
        side: fact.side,
        sideLabel: activitySideLabel(fact.side),
        value: value.display ?? fact.evidenceQuote,
        assertionStatus: fact.assertionStatus,
        assertionLabel: canonicalLabel(fact.assertionStatus),
        evidenceQuote: fact.evidenceQuote,
        provenanceStatus: fact.provenanceStatus,
        evidenceStartOffset: fact.evidenceStartOffset,
        evidenceEndOffset: fact.evidenceEndOffset,
        reconciliation: reconciliationLink,
      };
    }),
  };
}
