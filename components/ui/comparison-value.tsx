import { Status } from "@/components/ui/status";

export function ComparisonValue({
  label,
  different = false,
  matched = false,
  paperLabel = "On the paper",
  emailLabel = "In email",
  paper,
  email,
}: {
  label: string;
  different?: boolean;
  matched?: boolean;
  paperLabel?: string;
  emailLabel?: string;
  paper: {
    value: string;
    detail?: React.ReactNode;
    source?: React.ReactNode;
  };
  email: {
    value: string;
    detail?: React.ReactNode;
    source?: React.ReactNode;
  };
}) {
  const valueClass = matched
    ? "mt-1 break-words text-sm font-medium leading-tight tabular-nums text-ink-secondary"
    : "type-money mt-1 break-words";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="type-section">{label}</h3>
        {different ? <Status tone="warning">Different</Status> : null}
        {matched ? <span className="type-meta">Matches</span> : null}
      </div>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="type-label font-normal text-ink-secondary">{paperLabel}</p>
          <p className={valueClass}>{paper.value}</p>
          {paper.detail ? <div className="mt-1 text-[13px] leading-5 text-ink-secondary">{paper.detail}</div> : null}
          {paper.source ? <div className="mt-2">{paper.source}</div> : null}
        </div>
        <div className="min-w-0">
          <p className="type-label font-normal text-ink-secondary">{emailLabel}</p>
          <p className={valueClass}>{email.value}</p>
          {email.detail ? <div className="mt-1 text-[13px] leading-5 text-ink-secondary">{email.detail}</div> : null}
          {email.source ? <div className="mt-2">{email.source}</div> : null}
        </div>
      </div>
    </div>
  );
}
