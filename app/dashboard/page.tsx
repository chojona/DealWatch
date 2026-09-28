import { prisma } from "@/lib/db";
import { Nav } from "@/components/nav";
import { MetricsBar } from "@/components/dashboard/metrics-bar";
import { AttentionCard } from "@/components/dashboard/attention-card";
import {
  WaitingSection,
  UpcomingSection,
  RecentActivitySection,
} from "@/components/dashboard/deal-section";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  const now = new Date();

  const [deals, obligations, events] = await Promise.all([
    prisma.deal.findMany({
      where: { status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.obligation.findMany({
      where: { deal: { status: "ACTIVE" } },
      include: { deal: true, message: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dealEvent.findMany({
      where: { deal: { status: "ACTIVE" } },
      include: { deal: true },
      orderBy: { occurredAt: "desc" },
      take: 20,
    }),
  ]);

  // Metrics
  const overdueObligations = obligations.filter(
    (o) => o.status === "OVERDUE"
  );
  const waitingObligations = obligations.filter(
    (o) => o.status === "WAITING"
  );
  const openObligations = obligations.filter((o) => o.status === "OPEN");

  // Needs attention: OVERDUE + obligations with no response that have been waiting > 3 days
  const needsAttention = overdueObligations.filter(
    (o) => o.status === "OVERDUE"
  );

  // Build attention cards — one per deal with the highest severity obligation
  const dealsWithAttention = new Map<
    string,
    {
      obligation: (typeof needsAttention)[0];
      severity: "HIGH" | "MEDIUM" | "LOW";
    }
  >();

  for (const obl of needsAttention) {
    const existing = dealsWithAttention.get(obl.dealId);
    const waitMs = obl.dueAt
      ? now.getTime() - obl.dueAt.getTime()
      : 0;
    const waitDays = waitMs / (1000 * 60 * 60 * 24);
    const severity: "HIGH" | "MEDIUM" | "LOW" =
      waitDays > 3 ? "HIGH" : waitDays > 1 ? "MEDIUM" : "LOW";

    if (
      !existing ||
      (severity === "HIGH" && existing.severity !== "HIGH") ||
      (severity === "MEDIUM" && existing.severity === "LOW")
    ) {
      dealsWithAttention.set(obl.dealId, { obligation: obl, severity });
    }
  }

  const attentionCards = Array.from(dealsWithAttention.entries()).map(
    ([, { obligation, severity }]) => {
      const deal = obligation.deal;
      const waitMs = obligation.dueAt
        ? now.getTime() - obligation.dueAt.getTime()
        : 0;
      const waitDays = Math.round(waitMs / (1000 * 60 * 60 * 24));

      let summary = obligation.description;
      // Augment summary with timing context
      if (obligation.dueAt && obligation.status === "OVERDUE") {
        const days = Math.floor(
          (now.getTime() - obligation.dueAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        summary =
          days > 0
            ? `This was due ${days} day${days > 1 ? "s" : ""} ago and remains unresolved.`
            : summary;
      }

      return {
        dealId: deal.id,
        severity,
        property: deal.property,
        company: deal.company,
        stage: deal.stage,
        summary,
        nextAction: obligation.description,
        nextActionOwner: obligation.owner,
        waitingSince: obligation.dueAt,
        estimatedValue: deal.estimatedValue,
        evidenceQuote: obligation.evidenceQuote,
        confidence: obligation.confidence,
        waitDays,
      };
    }
  );

  // Sort by severity then waitDays
  const severityOrder: Record<"HIGH" | "MEDIUM" | "LOW", number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  };
  attentionCards.sort((a, b) => {
    const diff = severityOrder[a.severity] - severityOrder[b.severity];
    if (diff !== 0) return diff;
    return b.waitDays - a.waitDays;
  });

  // Waiting on them
  const waitingDeals = waitingObligations.map((o) => ({
    dealId: o.deal.id,
    property: o.deal.property,
    company: o.deal.company,
    stage: o.deal.stage,
    estimatedValue: o.deal.estimatedValue,
    obligationDescription: o.description,
    counterparty: o.counterparty ?? "Counterparty",
    waitingSince: o.createdAt,
    evidenceQuote: o.evidenceQuote,
  }));

  // Upcoming commitments (OPEN with a due date in the future)
  const upcomingCommitments = openObligations
    .filter((o) => o.dueAt && o.dueAt > now)
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
    .slice(0, 5)
    .map((o) => ({
      dealId: o.deal.id,
      property: o.deal.property,
      company: o.deal.company,
      description: o.description,
      owner: o.owner,
      dueAt: o.dueAt!,
      evidenceQuote: o.evidenceQuote,
    }));

  // Recent events
  const recentEvents = events.slice(0, 10).map((e) => ({
    dealId: e.deal.id,
    property: e.deal.property,
    company: e.deal.company,
    type: e.type,
    description: e.description,
    occurredAt: e.occurredAt,
    confidence: e.confidence,
  }));

  return {
    metrics: {
      actionsRequired: attentionCards.length,
      overdueCommitments: overdueObligations.length,
      waitingOnCounterparty: waitingObligations.length,
      activeDeals: deals.length,
    },
    attentionCards,
    waitingDeals,
    upcomingCommitments,
    recentEvents,
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen">
      <Nav active="/dashboard" />

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Page header */}
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">
              {greeting}
            </h1>
            <p className="mt-0.5 text-xs text-zinc-400">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        </div>

        {/* Metrics */}
        <div className="mb-6">
          <MetricsBar {...data.metrics} />
        </div>

        <div className="flex flex-col gap-8">
          {/* Needs attention */}
          {data.attentionCards.length > 0 && (
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Needs Attention
              </h2>
              <div className="flex flex-col gap-2">
                {data.attentionCards.map((card) => (
                  <AttentionCard key={card.dealId} {...card} />
                ))}
              </div>
            </div>
          )}

          {data.attentionCards.length === 0 && (
            <div className="rounded-sm border border-zinc-200 bg-white px-6 py-8 text-center">
              <p className="text-sm font-medium text-zinc-500">
                No items requiring attention
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                All tracked commitments are current.
              </p>
            </div>
          )}

          <WaitingSection deals={data.waitingDeals} />
          <UpcomingSection commitments={data.upcomingCommitments} />
          <RecentActivitySection events={data.recentEvents} />
        </div>
      </main>
    </div>
  );
}
