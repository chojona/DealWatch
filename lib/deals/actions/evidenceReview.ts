import type { Prisma, PrismaClient } from "@prisma/client";
import {
  matchingFulfillmentTargets,
  readExplicitFulfillment,
  fulfillmentTargetFromPayload,
  type FulfillmentTarget,
} from "@/lib/ai/activity/fulfillment";
import {
  ActivityStructuredPayloadSchema,
  STRUCTURED_ACTION_KINDS,
  STRUCTURED_RESPONSIBLE_SIDES,
  StructuredActionDirectiveSchema,
  type ActivityStructuredPayload,
  type StructuredActionDirective,
} from "@/lib/ai/activity/schema";
import { effectiveActivityFact } from "@/lib/messages/effective";
import { factsFromLatestRun } from "@/lib/messages/latestRun";
import { reviewActivityFact } from "@/lib/messages/review";
import {
  actionKindLabel,
  presentActionEvidence,
  type ActionEvidenceChoice,
  type ActionEvidenceReviewItem,
} from "./evidenceReviewView";

export interface ActionEvidenceReviewQueue {
  items: ActionEvidenceReviewItem[];
}

export interface ActionEvidenceCorrection {
  kind?: StructuredActionDirective["kind"];
  responsibleSide?: StructuredActionDirective["responsibleSide"];
  discardNormalizedInstant?: boolean;
  fulfillsFactId?: string | null;
}

export interface ReviewActionEvidenceInput {
  dealId: string;
  sourceMessageId: string;
  activityFactId: string;
  decision: "confirm" | "reject" | "correct";
  expectedWorkspaceId: string;
  correction?: ActionEvidenceCorrection;
}

export class ActionEvidenceReviewError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409) {
    super(message);
    this.name = "ActionEvidenceReviewError";
    this.status = status;
  }
}

const factSelect = {
  id: true,
  assertionStatus: true,
  evidenceQuote: true,
  provenanceStatus: true,
  structuredPayload: true,
  activityExtractionRun: {
    select: { id: true, status: true, completedAt: true, createdAt: true },
  },
  reviews: {
    select: {
      id: true,
      state: true,
      createdAt: true,
      correction: {
        select: { id: true, structuredPayload: true, note: true, createdAt: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.ActivityFactSelect;

const messageSelect = {
  id: true,
  workspaceId: true,
  dealId: true,
  sentAt: true,
  receivedAt: true,
  createdAt: true,
  participants: {
    select: { role: true, displayName: true, address: true },
    orderBy: [{ role: "asc" }, { address: "asc" }],
  },
  facts: {
    select: factSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} as const satisfies Prisma.SourceMessageSelect;

type ReviewMessage = Prisma.SourceMessageGetPayload<{ select: typeof messageSelect }>;
type ReviewFact = ReviewMessage["facts"][number];

interface CatalogEntry {
  fact: ReviewFact;
  message: ReviewMessage;
  timestamp: string;
  reviewed: boolean;
  payload: unknown;
}

function iso(message: { sentAt: Date | null; receivedAt: Date | null; createdAt: Date }): string {
  return (message.sentAt ?? message.receivedAt ?? message.createdAt).toISOString();
}

function senderLabel(message: ReviewMessage): string | null {
  const from = message.participants.find((participant) => participant.role === "FROM");
  if (!from) return null;
  const name = from.displayName?.trim();
  return name || from.address;
}

function isReviewed(fact: ReviewFact): boolean {
  const effective = effectiveActivityFact(fact);
  return effective.review?.state === "CONFIRMED"
    || (effective.review?.state === "INCORRECT" && Boolean(effective.correction));
}

function readDirective(payload: unknown): StructuredActionDirective | null {
  if (!payload || typeof payload !== "object" || !("action" in payload)) return null;
  const parsed = StructuredActionDirectiveSchema.safeParse((payload as { action?: unknown }).action);
  return parsed.success ? parsed.data : null;
}

function choice(entry: CatalogEntry): ActionEvidenceChoice {
  return {
    factId: entry.fact.id,
    evidenceQuote: entry.fact.evidenceQuote,
    href: `/messages/${entry.message.id}`,
    whenLabel: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(entry.timestamp)),
    senderLabel: senderLabel(entry.message),
  };
}

function toTarget(entry: CatalogEntry): FulfillmentTarget {
  return fulfillmentTargetFromPayload({
    id: entry.fact.id,
    workspaceId: entry.message.workspaceId,
    dealId: entry.message.dealId,
    timestamp: entry.timestamp,
    assertionStatus: entry.fact.assertionStatus,
    evidenceQuote: entry.fact.evidenceQuote,
    provenanceStatus: entry.fact.provenanceStatus,
    reviewed: entry.reviewed,
    payload: entry.payload,
  });
}

function catalogFor(messages: ReviewMessage[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const message of messages) {
    const timestamp = iso(message);
    for (const fact of factsFromLatestRun(message.facts)) {
      const effective = effectiveActivityFact(fact);
      entries.push({
        fact,
        message,
        timestamp,
        reviewed: isReviewed(fact),
        payload: effective.presentationPayload,
      });
    }
  }
  return entries;
}

function eligibleChoices(entry: CatalogEntry, catalog: CatalogEntry[]): ActionEvidenceChoice[] {
  const explicit = readExplicitFulfillment(entry.fact.evidenceQuote);
  if (!explicit) return [];
  const matched = matchingFulfillmentTargets(
    explicit,
    catalog.filter((candidate) => candidate.message.id !== entry.message.id).map(toTarget),
    {
      workspaceId: entry.message.workspaceId,
      dealId: entry.message.dealId,
      timestamp: entry.timestamp,
    },
  );
  const byId = new Map(catalog.map((candidate) => [candidate.fact.id, candidate]));
  return matched.flatMap((target) => {
    const candidate = byId.get(target.id);
    return candidate ? [choice(candidate)] : [];
  });
}

/**
 * Pending action evidence for one authorized deal.
 * This read does not review facts, derive court, or call a model.
 */
export async function getActionEvidenceReview(
  db: PrismaClient,
  dealId: string,
  options: { expectedWorkspaceId?: string } = {},
): Promise<ActionEvidenceReviewQueue | null> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { id: true, workspaceId: true },
  });
  if (!deal || (options.expectedWorkspaceId && deal.workspaceId !== options.expectedWorkspaceId)) return null;

  const messages = await db.sourceMessage.findMany({
    where: { workspaceId: deal.workspaceId, dealId: deal.id },
    select: messageSelect,
  });
  const catalog = catalogFor(messages);
  const items = catalog
    .filter((entry) => entry.fact.reviews.length === 0)
    .flatMap((entry) => {
      const directive = readDirective(entry.fact.structuredPayload);
      if (!directive) return [];
      return [{ entry, directive }];
    })
    .sort((left, right) => left.entry.timestamp.localeCompare(right.entry.timestamp) || left.entry.fact.id.localeCompare(right.entry.fact.id))
    .map(({ entry, directive }) => {
      const choices = directive.kind === "FULFILLMENT" ? eligibleChoices(entry, catalog) : [];
      const linked = directive.fulfillsFactId
        ? catalog.find((candidate) => candidate.fact.id === directive.fulfillsFactId && candidate.message.workspaceId === entry.message.workspaceId && candidate.message.dealId === entry.message.dealId) ?? null
        : null;
      return presentActionEvidence({
        directive,
        factId: entry.fact.id,
        messageId: entry.message.id,
        evidenceQuote: entry.fact.evidenceQuote,
        timestamp: entry.timestamp,
        senderLabel: senderLabel(entry.message),
        linkedRequest: linked ? choice(linked) : null,
        choices,
      });
    });

  return { items };
}

function assertPending(fact: ReviewFact) {
  if (fact.reviews.length > 0) {
    throw new ActionEvidenceReviewError("This evidence was already reviewed", 409);
  }
}

function sameDealEntry(catalog: CatalogEntry[], factId: string, message: ReviewMessage): CatalogEntry | null {
  return catalog.find((entry) => entry.fact.id === factId && entry.message.id === message.id) ?? null;
}

async function loadScope(db: PrismaClient, input: ReviewActionEvidenceInput) {
  const deal = await db.deal.findUnique({
    where: { id: input.dealId },
    select: { id: true, workspaceId: true },
  });
  if (!deal || deal.workspaceId !== input.expectedWorkspaceId) {
    throw new ActionEvidenceReviewError("Deal not found", 404);
  }
  const message = await db.sourceMessage.findFirst({
    where: { id: input.sourceMessageId, dealId: deal.id, workspaceId: deal.workspaceId },
    select: messageSelect,
  });
  if (!message) throw new ActionEvidenceReviewError("Message not found", 404);
  const messages = await db.sourceMessage.findMany({
    where: { workspaceId: deal.workspaceId, dealId: deal.id },
    select: messageSelect,
  });
  const catalog = catalogFor(messages);
  const entry = sameDealEntry(catalog, input.activityFactId, message);
  if (!entry) throw new ActionEvidenceReviewError("Activity fact not found", 404);
  const directive = readDirective(entry.fact.structuredPayload);
  if (!directive) throw new ActionEvidenceReviewError("This evidence is not an action", 400);
  assertPending(entry.fact);
  return { message, entry, directive, catalog };
}

function assertEligibleTarget(entry: CatalogEntry, catalog: CatalogEntry[], factId: string) {
  const explicit = readExplicitFulfillment(entry.fact.evidenceQuote);
  const matched = explicit
    ? matchingFulfillmentTargets(
      explicit,
      catalog.filter((candidate) => candidate.message.id !== entry.message.id).map(toTarget),
      {
        workspaceId: entry.message.workspaceId,
        dealId: entry.message.dealId,
        timestamp: entry.timestamp,
      },
    )
    : [];
  if (!matched.some((target) => target.id === factId)) {
    throw new ActionEvidenceReviewError("Fulfillment target is not eligible", 400);
  }
}

function correctedPayload(
  fact: ReviewFact,
  directive: StructuredActionDirective,
  entry: CatalogEntry,
  catalog: CatalogEntry[],
  correction: ActionEvidenceCorrection,
): ActivityStructuredPayload {
  const parsed = ActivityStructuredPayloadSchema.safeParse(fact.structuredPayload);
  if (!parsed.success || !parsed.data.action) {
    throw new ActionEvidenceReviewError("Corrected structured value is invalid", 400);
  }
  const next: StructuredActionDirective = { ...directive };
  const fulfillment = directive.kind === "FULFILLMENT";
  if (fulfillment && (correction.kind || correction.responsibleSide || correction.discardNormalizedInstant)) {
    throw new ActionEvidenceReviewError("Fulfillment evidence can only be corrected by choosing an eligible request", 400);
  }
  if (!fulfillment && correction.fulfillsFactId !== undefined) {
    throw new ActionEvidenceReviewError("Only fulfillment evidence can name a request", 400);
  }
  if (correction.kind) {
    if (!STRUCTURED_ACTION_KINDS.includes(correction.kind) || correction.kind === "FULFILLMENT" || correction.kind === "SCHEDULED") {
      throw new ActionEvidenceReviewError("That action type cannot be saved", 400);
    }
    next.kind = correction.kind;
  }
  if (correction.responsibleSide) {
    if (!STRUCTURED_RESPONSIBLE_SIDES.includes(correction.responsibleSide)) {
      throw new ActionEvidenceReviewError("That responsible side cannot be saved", 400);
    }
    next.responsibleSide = correction.responsibleSide;
  }
  if (correction.discardNormalizedInstant) {
    next.dueAt = null;
    next.occursAt = null;
  }
  if (correction.fulfillsFactId !== undefined) {
    if (correction.fulfillsFactId === null) {
      next.fulfillsFactId = null;
    } else {
      const targetId = correction.fulfillsFactId.trim();
      if (!targetId) throw new ActionEvidenceReviewError("Fulfillment target is not eligible", 400);
      assertEligibleTarget(entry, catalog, targetId);
      next.fulfillsFactId = targetId;
    }
  }
  const display = correction.kind ? actionKindLabel(next.kind) : parsed.data.display;
  const rebuilt = ActivityStructuredPayloadSchema.safeParse({
    ...parsed.data,
    display,
    action: next,
  });
  if (!rebuilt.success) throw new ActionEvidenceReviewError("Corrected structured value is invalid", 400);
  return rebuilt.data;
}

/**
 * Confirm, reject, or correct one pending action fact through ActivityFact review.
 * A selected fulfillment target is checked again here. The client id is not trusted.
 */
export async function reviewActionEvidence(db: PrismaClient, input: ReviewActionEvidenceInput) {
  const { message, entry, directive, catalog } = await loadScope(db, input);
  if (input.decision === "reject") {
    return reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: entry.fact.id,
      state: "INCORRECT",
      expectedWorkspaceId: message.workspaceId,
    });
  }
  if (input.decision === "confirm") {
    const choices = directive.kind === "FULFILLMENT" ? eligibleChoices(entry, catalog) : [];
    if (directive.kind === "FULFILLMENT" && !directive.fulfillsFactId && choices.length > 1) {
      throw new ActionEvidenceReviewError("Select the request this fulfills, or none", 400);
    }
    if (input.correction) {
      throw new ActionEvidenceReviewError("Confirmation cannot change the proposed evidence", 400);
    }
    return reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: entry.fact.id,
      state: "CONFIRMED",
      expectedWorkspaceId: message.workspaceId,
    });
  }
  const correction = input.correction;
  const hasChange = Boolean(
    correction
    && (correction.kind || correction.responsibleSide || correction.discardNormalizedInstant || correction.fulfillsFactId !== undefined),
  );
  if (!hasChange || !correction) throw new ActionEvidenceReviewError("Nothing to correct", 400);
  const payload = correctedPayload(entry.fact, directive, entry, catalog, correction);
  return reviewActivityFact(db, {
    sourceMessageId: message.id,
    activityFactId: entry.fact.id,
    state: "INCORRECT",
    correctedPayload: payload,
    expectedWorkspaceId: message.workspaceId,
    note: "Action evidence correction",
  });
}
