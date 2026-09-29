import Link from "next/link";
import type { DashboardDealCard, ModernDashboard } from "@/lib/deals/dashboard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

function Metric({ label, value, urgent = false }: { label: string; value: number; urgent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[22px] font-semibold tabular-nums ${urgent ? "text-warning" : "text-ink"}`}>
        {value}
      </span>
      <span className="text-[13px] text-ink-secondary">{label}</span>
    </div>
  );
}

export function EmptyDeals({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <EmptyState
        title="No deals yet"
        description="Create a deal, then add a document or an email. DealWatch will show what needs you, what the paper says, and what changed."
        actions={<Button asChild><Link href="/deals/new">New deal</Link></Button>}
      />
      {compact ? null : <p className="text-[13px] text-ink-muted">No seed data is required.</p>}
    </div>
  );
}

function DealCard({ deal }: { deal: DashboardDealCard }) {
  return (
    <article className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={deal.href} className="text-sm font-semibold text-zinc-900 hover:underline">
            {deal.name}
          </Link>
          <p className="mt-0.5 text-xs text-zinc-500">
            {[deal.company, deal.property].filter(Boolean).join(" · ") || "Company and property not set"}
            <span className="text-zinc-300"> · </span>
            {deal.stage}
          </p>
        </div>
        <span className="rounded-sm border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          {deal.status}
        </span>
      </div>
      <p className="mt-2 text-xs text-zinc-700">{deal.summary}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500">
        <span>{deal.openActionCount} open {deal.openActionCount === 1 ? "action" : "actions"}</span>
        {deal.negotiation ? (
          <span>{deal.negotiation.openCount} open terms</span>
        ) : (
          <span>Brief unavailable</span>
        )}
        <Link href={`${deal.href}/documents`} className="font-medium text-zinc-800 underline">Documents</Link>
        <Link href={deal.href} className="font-medium text-zinc-800 underline">Open deal</Link>
      </div>
      {deal.topActions.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-zinc-100 pt-2">
          {deal.topActions.map((action) => (
            <li key={action.id} className="text-[11px] text-zinc-600">
              <span className="font-medium text-zinc-800">{action.timingLabel}</span>
              {" · "}
              {action.description}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function ModernHome({
  dashboard,
  heading,
  subheading,
  showHeader = true,
}: {
  dashboard: ModernDashboard;
  heading: string;
  subheading?: string;
  showHeader?: boolean;
}) {
  const needsAttention = dashboard.deals.filter((deal) => deal.needsYouCount > 0 || deal.passedDeadlineCount > 0 || deal.negotiation?.conflictCount);
  const rest = dashboard.deals.filter((deal) => !needsAttention.some((item) => item.id === deal.id));

  return (
    <div>
      {showHeader ? (
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="page-title">{heading}</h1>
            {subheading ? <p className="mt-1 text-sm text-ink-secondary">{subheading}</p> : null}
          </div>
          <Button asChild>
            <Link href="/deals/new">New deal</Link>
          </Button>
        </div>
      ) : null}

      {dashboard.deals.length === 0 ? (
        <EmptyDeals />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-6 border-b border-line pb-6 sm:grid-cols-4">
            <Metric label="Active deals" value={dashboard.metrics.activeDeals} />
            <Metric label="Needs you" value={dashboard.metrics.needsYou} urgent={dashboard.metrics.needsYou > 0} />
            <Metric label="Open requests" value={dashboard.metrics.openActions} />
            <Metric label="Waiting on them" value={dashboard.metrics.waitingOnCounterparty} />
          </div>
          {needsAttention.length > 0 ? (
            <section className="mb-8">
              <h2 className="section-title mb-4">Needs your attention</h2>
              <div className="flex flex-col gap-2">
                {needsAttention.map((deal) => <DealCard key={deal.id} deal={deal} />)}
              </div>
            </section>
          ) : (
            <p className="mb-8 text-sm text-success">
              Nothing across the portfolio is waiting on you right now.
            </p>
          )}
          {rest.length > 0 ? (
            <section>
              <h2 className="section-title mb-4">Other active deals</h2>
              <div className="flex flex-col gap-2">
                {rest.map((deal) => <DealCard key={deal.id} deal={deal} />)}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
