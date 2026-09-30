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
      <p className="type-label font-normal text-ink-secondary">{label}</p>
      <p className="type-money mt-1 break-words">{value}</p>
      {detail ? <p className="type-label mt-1 font-normal text-ink-secondary">{detail}</p> : null}
      {status ? <div className="mt-2">{status}</div> : null}
      {source ? <div className="mt-2">{source}</div> : null}
    </div>
  );
}
