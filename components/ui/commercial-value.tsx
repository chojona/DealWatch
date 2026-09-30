export function CommercialValue({
  label,
  value,
  detail,
  status,
  source,
  layout = "stack",
}: {
  label?: string;
  value: string;
  detail?: string;
  status?: React.ReactNode;
  source?: React.ReactNode;
  /** `inline` is the dense row treatment: 16px semibold, full value, no truncation. */
  layout?: "stack" | "inline";
}) {
  if (layout === "inline") {
    return (
      <div className="min-w-0">
        {label ? <p className="text-[11px] font-medium leading-[15px] text-ink-muted">{label}</p> : null}
        <p className="break-words text-[16px] font-semibold leading-[22px] tabular-nums text-ink">{value}</p>
        {detail ? <p className="mt-0.5 break-words text-xs leading-4 text-ink-secondary">{detail}</p> : null}
        {status ? <div className="mt-1">{status}</div> : null}
        {source ? <div className="mt-1">{source}</div> : null}
      </div>
    );
  }

  return (
    <div>
      {label ? <p className="text-[13px] text-ink-secondary">{label}</p> : null}
      <p className="mt-1 break-words text-[20px] font-semibold leading-tight tabular-nums text-ink">{value}</p>
      {detail ? <p className="mt-1 text-[13px] text-ink-secondary">{detail}</p> : null}
      {status ? <div className="mt-2">{status}</div> : null}
      {source ? <div className="mt-2">{source}</div> : null}
    </div>
  );
}
