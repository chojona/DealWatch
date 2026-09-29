export function CommercialValue({
  label,
  value,
  detail,
  status,
  source,
}: {
  label: string;
  value: string;
  detail?: string;
  status?: React.ReactNode;
  source?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[13px] text-ink-secondary">{label}</p>
      <p className="mt-1 break-words text-[20px] font-semibold leading-tight tabular-nums text-ink">{value}</p>
      {detail ? <p className="mt-1 text-[13px] text-ink-secondary">{detail}</p> : null}
      {status ? <div className="mt-2">{status}</div> : null}
      {source ? <div className="mt-2">{source}</div> : null}
    </div>
  );
}
