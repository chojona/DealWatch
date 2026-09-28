interface MetricProps {
  label: string;
  value: number;
  highlight?: boolean;
  urgent?: boolean;
}

function Metric({ label, value, highlight, urgent }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={
          urgent
            ? "text-2xl font-semibold tabular-nums text-red-600"
            : highlight
              ? "text-2xl font-semibold tabular-nums text-zinc-900"
              : "text-2xl font-semibold tabular-nums text-zinc-900"
        }
      >
        {value}
      </span>
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
  );
}

interface MetricsBarProps {
  actionsRequired: number;
  overdueCommitments: number;
  waitingOnCounterparty: number;
  activeDeals: number;
}

export function MetricsBar({
  actionsRequired,
  overdueCommitments,
  waitingOnCounterparty,
  activeDeals,
}: MetricsBarProps) {
  return (
    <div className="flex items-center gap-8 rounded-sm border border-zinc-200 bg-white px-6 py-4">
      <Metric
        label="Actions requiring attention"
        value={actionsRequired}
        urgent={actionsRequired > 0}
      />
      <div className="h-10 w-px bg-zinc-100" />
      <Metric
        label="Overdue commitments"
        value={overdueCommitments}
        urgent={overdueCommitments > 0}
      />
      <div className="h-10 w-px bg-zinc-100" />
      <Metric
        label="Waiting on counterparties"
        value={waitingOnCounterparty}
      />
      <div className="h-10 w-px bg-zinc-100" />
      <Metric label="Active deals" value={activeDeals} />
    </div>
  );
}
