import type { PrismaClient } from "@prisma/client";
import { getDealBrief } from "@/lib/deals/brief/service";
import type { DealBrief } from "@/lib/deals/brief/types";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export interface DashboardActionItem {
  id: string;
  description: string;
  timingLabel: string;
  responsibleSide: string;
  href: string;
}

export interface DashboardBriefSnapshot {
  outstandingActions: DashboardActionItem[];
  needsYou: DashboardActionItem[];
  passedDeadlineCount: number;
  termCount: number;
  openCount: number;
  agreedCount: number;
  conflictCount: number;
  communicationCount: number;
  hasDocumentOrFormal: boolean;
}

export interface DashboardDealInput {
  id: string;
  name: string;
  company: string;
  property: string;
  stage: string;
  status: string;
  updatedAt: Date;
}

export interface DashboardDealCard {
  id: string;
  name: string;
  company: string;
  property: string;
  stage: string;
  status: string;
  href: string;
  updatedAt: string;
  summary: string;
  openActionCount: number;
  needsYouCount: number;
  counterpartyActionCount: number;
  passedDeadlineCount: number;
  negotiation: {
    termCount: number;
    openCount: number;
    agreedCount: number;
    conflictCount: number;
  } | null;
  topActions: DashboardActionItem[];
  hasSources: boolean;
  derived: boolean;
}

export interface ModernDashboard {
  workspaceId: string | null;
  deals: DashboardDealCard[];
  metrics: {
    activeDeals: number;
    openActions: number;
    needsYou: number;
    waitingOnCounterparty: number;
  };
}

function actionItem(action: {
  id: string;
  description: string;
  timingLabel: string;
  responsibleSide: string;
  source: { href: string };
}): DashboardActionItem {
  return {
    id: action.id,
    description: action.description,
    timingLabel: action.timingLabel,
    responsibleSide: action.responsibleSide,
    href: action.source.href,
  };
}

export function snapshotFromBrief(brief: DealBrief): DashboardBriefSnapshot {
  return {
    outstandingActions: brief.actions.outstandingActions.map(actionItem),
    needsYou: brief.actions.needsYou.map(actionItem),
    passedDeadlineCount: brief.actions.deadlines.filter((deadline) => deadline.passed).length,
    termCount: brief.negotiation.summary.termCount,
    openCount: brief.negotiation.summary.openCount,
    agreedCount: brief.negotiation.summary.agreedCount,
    conflictCount: brief.negotiation.summary.conflictCount,
    communicationCount: brief.communications.length,
    hasDocumentOrFormal: brief.timeline.some(
      (item) => item.type === "DOCUMENT" || item.type === "FORMAL_NEGOTIATION" || item.type === "COMMUNICATION"
    ),
  };
}

export function briefHasTrackedEvidence(snapshot: DashboardBriefSnapshot): boolean {
  return snapshot.communicationCount > 0
    || snapshot.termCount > 0
    || snapshot.hasDocumentOrFormal;
}

export function projectDealCard(
  deal: DashboardDealInput,
  snapshot: DashboardBriefSnapshot | null
): DashboardDealCard {
  const outstanding = snapshot?.outstandingActions ?? [];
  const needsYou = snapshot?.needsYou ?? [];
  const counterparty = outstanding.filter((action) => action.responsibleSide === "COUNTERPARTY");
  const seen = new Set<string>();
  const topActions = [...needsYou, ...outstanding].filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  }).slice(0, 3);
  const hasSources = snapshot ? briefHasTrackedEvidence(snapshot) : false;
  let summary = "No derived brief yet.";
  if (snapshot && !hasSources) {
    summary = "No sources yet. Upload a document or add messages.";
  } else if (snapshot && topActions.length > 0) {
    summary = topActions[0]?.description ?? "Open actions are on this deal.";
  } else if (snapshot && snapshot.termCount > 0) {
    summary = `${snapshot.openCount} open terms · ${snapshot.agreedCount} agreed · ${snapshot.conflictCount} conflicts`;
  } else if (snapshot && hasSources) {
    summary = "Sources are on the deal. Brief and actions update as evidence is reviewed.";
  }
  return {
    id: deal.id,
    name: deal.name,
    company: deal.company,
    property: deal.property,
    stage: deal.stage,
    status: deal.status,
    href: `/deals/${deal.id}`,
    updatedAt: deal.updatedAt.toISOString(),
    summary,
    openActionCount: outstanding.length,
    needsYouCount: needsYou.length,
    counterpartyActionCount: counterparty.length,
    passedDeadlineCount: snapshot?.passedDeadlineCount ?? 0,
    negotiation: snapshot
      ? {
          termCount: snapshot.termCount,
          openCount: snapshot.openCount,
          agreedCount: snapshot.agreedCount,
          conflictCount: snapshot.conflictCount,
        }
      : null,
    topActions,
    hasSources,
    derived: snapshot !== null,
  };
}

function summarize(deals: DashboardDealCard[]): ModernDashboard["metrics"] {
  return {
    activeDeals: deals.filter((deal) => deal.status === "ACTIVE").length,
    openActions: deals.reduce((total, deal) => total + deal.openActionCount, 0),
    needsYou: deals.reduce((total, deal) => total + deal.needsYouCount, 0),
    waitingOnCounterparty: deals.reduce((total, deal) => total + deal.counterpartyActionCount, 0),
  };
}

export function emptyDashboard(): ModernDashboard {
  return {
    workspaceId: null,
    deals: [],
    metrics: { activeDeals: 0, openActions: 0, needsYou: 0, waitingOnCounterparty: 0 },
  };
}

/**
 * Read model over modern Deals and DealBrief. It does not read Obligation or DealEvent.
 */
export async function getModernDashboard(
  db: PrismaClient,
  options: { workspaceId?: string | null; now?: Date } = {}
): Promise<ModernDashboard> {
  const workspaceId = options.workspaceId === undefined
    ? await messageRequestWorkspaceId(db)
    : options.workspaceId;
  if (!workspaceId) return emptyDashboard();
  const deals = await db.deal.findMany({
    where: { workspaceId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      company: true,
      property: true,
      stage: true,
      status: true,
      updatedAt: true,
    },
  });
  const cards = await Promise.all(deals.map(async (deal) => {
    const brief = await getDealBrief(db, deal.id, {
      expectedWorkspaceId: workspaceId,
      now: options.now,
    });
    return projectDealCard(deal, brief ? snapshotFromBrief(brief) : null);
  }));
  return {
    workspaceId,
    deals: cards,
    metrics: summarize(cards),
  };
}
