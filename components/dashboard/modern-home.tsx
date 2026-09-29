import Link from "next/link";
import type { DashboardDealCard, ModernDashboard } from "@/lib/deals/dashboard";

function Metric({ label, value, urgent = false }: { label: string; value: number; urgent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-2xl font-semibold tabular-nums ${urgent ? "text-red-600" : "text-zinc-900"}`}>
        {value}
      </span>
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
  );
}

export function EmptyDeals({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-sm border border-zinc-200 bg-white px-6 py-10 text-center">
      <h2 className="text-sm font-semibold text-zinc-900">No deals yet</h2>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-500">
        Create a deal, then add a document or an email. DealWatch will show what needs you, what the paper says, and what changed.
      </p>
      <Link
        href="/deals/new"
        className="mt-4 inline-flex h-8 items-center rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white"
      >
        New deal
      </Link>
      {compact ? null : (
        <p className="mt-3 text-[11px] text-zinc-400">No seed data is required.</p>
      )}
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
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">{heading}</h1>
            {subheading ? <p className="mt-0.5 text-sm text-zinc-500">{subheading}</p> : null}
          </div>
          <Link
            href="/deals/new"
            className="inline-flex h-8 items-center rounded-md bg-[#16323a] px-3 text-xs font-medium text-white"
          >
            New deal
          </Link>
        </div>
      ) : null}

      {dashboard.deals.length === 0 ? (
        <EmptyDeals />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-[#d7e0e4] bg-white px-4 py-4 sm:grid-cols-4 sm:gap-6 sm:px-6">
            <Metric label="Active deals" value={dashboard.metrics.activeDeals} />
            <Metric label="Needs you" value={dashboard.metrics.needsYou} urgent={dashboard.metrics.needsYou > 0} />
            <Metric label="Open requests" value={dashboard.metrics.openActions} urgent={dashboard.metrics.openActions > 0} />
            <Metric label="Waiting on them" value={dashboard.metrics.waitingOnCounterparty} />
          </div>
          {needsAttention.length > 0 ? (
            <section className="mb-8">
              <h2 className="mb-3 text-sm font-semibold text-zinc-900">Needs your attention</h2>
              <div className="flex flex-col gap-2">
                {needsAttention.map((deal) => <DealCard key={deal.id} deal={deal} />)}
              </div>
            </section>
          ) : (
            <p className="mb-8 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Nothing across the portfolio is waiting on you right now.
            </p>
          )}
          {rest.length > 0 ? (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-zinc-900">Other active deals</h2>
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
