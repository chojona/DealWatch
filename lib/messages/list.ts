import type { PrismaClient } from "@prisma/client";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
import { factsFromLatestRun } from "./latestRun";
import { deriveMessageLifecycle } from "./state";

export interface DealMessageListItem {
  id: string;
  subject: string;
  sender: string;
  date: string;
  sourceType: string;
  analysisState: string;
  reviewState: string;
  actionReviewState: string;
  evidenceSettled: boolean;
  lifecycleState: string;
  factCount: number;
  negotiationFactCount: number;
  reconciliationSummary: string[];
  href: string;
}

export async function listDealMessages(db: PrismaClient, dealId: string, limit = 100) {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { id: true, name: true, company: true, property: true, propertyId: true, stage: true, status: true, estimatedValue: true, createdAt: true, workspaceId: true },
  });
  if (!deal) return null;
  const messages = await db.sourceMessage.findMany({
    where: { workspaceId: deal.workspaceId, dealId: deal.id },
    take: Math.max(1, Math.min(limit, 200)),
    orderBy: [{ sentAt: "desc" }, { receivedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    include: {
      extractionRuns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      reviewDecisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      facts: {
        include: {
          activityExtractionRun: { select: { id: true, status: true, completedAt: true, createdAt: true } },
          reviews: { select: { id: true } },
        },
      },
    },
  });
  const reconciliation = await getDealReconciliation(db, deal.id);
  const items: DealMessageListItem[] = messages.map((message) => {
    const facts = factsFromLatestRun(message.facts);
    const lifecycle = deriveMessageLifecycle({
      runs: message.extractionRuns,
      decisions: message.reviewDecisions,
      currentFactIds: facts.map((fact) => fact.id),
      facts,
    });
    const links = reconciliation?.links.filter((link) => link.activityEventId === `source-message:${message.id}`) ?? [];
    return {
      id: message.id,
      subject: message.subject || "Email",
      sender: message.senderName || message.senderAddress || "Unknown sender",
      date: (message.sentAt ?? message.receivedAt ?? message.createdAt).toISOString(),
      sourceType: message.sourceType,
      ...lifecycle,
      factCount: facts.length,
      negotiationFactCount: facts.filter((fact) => fact.factType === "NEGOTIATION_VALUE").length,
      reconciliationSummary: [...new Set(links.map((link) => `${link.canonicalType?.replaceAll("_", " ") ?? "Activity"} — ${link.relationship.replaceAll("_", " ")}`))],
      href: `/messages/${message.id}`,
    };
  });
  return { deal, items };
}

export async function messageRollupForDeals(db: PrismaClient, workspaceId: string, dealIds: string[]) {
  if (dealIds.length === 0) return new Map<string, { total: number; needsReview: number; failed: number }>();
  const messages = await db.sourceMessage.findMany({
    where: { workspaceId, dealId: { in: dealIds } },
    select: {
      id: true, dealId: true,
      extractionRuns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      reviewDecisions: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      facts: {
        select: {
          id: true,
          structuredPayload: true,
          activityExtractionRun: { select: { id: true, status: true, completedAt: true, createdAt: true } },
          reviews: { select: { id: true } },
        },
      },
    },
  });
  const result = new Map<string, { total: number; needsReview: number; failed: number }>();
  for (const message of messages) {
    const current = result.get(message.dealId) ?? { total: 0, needsReview: 0, failed: 0 };
    const facts = factsFromLatestRun(message.facts);
    const state = deriveMessageLifecycle({
      runs: message.extractionRuns,
      decisions: message.reviewDecisions,
      currentFactIds: facts.map((fact) => fact.id),
      facts,
    });
    current.total += 1;
    if (state.analysisState === "ANALYSIS_FAILED") current.failed += 1;
    if (!state.evidenceSettled) current.needsReview += 1;
    result.set(message.dealId, current);
  }
  return result;
}
