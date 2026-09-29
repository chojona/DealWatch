import type { PrismaClient } from "@prisma/client";
import { getActivityPage } from "@/lib/activity/service";
import { getInbox } from "@/lib/inbox/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { getDealKnowledge } from "@/lib/promotion/service";
import { projectDealIntelligence } from "./project";
import type { DealIntelligence } from "./types";
import { messageRollupForDeals } from "@/lib/messages/list";

const ACTIVITY_PREVIEW_LIMIT = 8;

/**
 * Read-only projection of one deal.
 * Workspace is taken from the deal. Callers must not supply a client workspace id.
 */
export async function getDealIntelligence(
  db: PrismaClient,
  dealId: string
): Promise<DealIntelligence | null> {
  const deal = await db.deal.findUnique({
    where: { id: dealId },
    select: { id: true, workspaceId: true },
  });
  if (!deal) return null;

  const [workspace, inbox, knowledge, activity, messageRollups] = await Promise.all([
    getNegotiationWorkspace(db, deal.id),
    getInbox(db, { workspaceId: deal.workspaceId, scopeDealId: deal.id, includeMessages: false }),
    getDealKnowledge(db, deal.id),
    getActivityPage(db, { rootType: "DEAL", rootId: deal.id, limit: ACTIVITY_PREVIEW_LIMIT }),
    messageRollupForDeals(db, deal.workspaceId, [deal.id]),
  ]);
  if (!workspace || !knowledge || !activity) return null;
  return {
    ...projectDealIntelligence({
    workspace,
    documents: inbox.items,
    knowledge,
    activity: activity.events,
    }),
    messageRollup: messageRollups.get(deal.id) ?? { total: 0, needsReview: 0, failed: 0 },
  };
}

export function rejectClientWorkspace(searchParams: { has(name: string): boolean }): string | null {
  if (searchParams.has("workspaceId")) return "workspaceId is server-controlled";
  return null;
}
