import { Status } from "@/components/ui/status";

export function ComparisonValue({
  label,
  different = false,
  paper,
  email,
}: {
  label: string;
  different?: boolean;
  paper: {
    value: string;
    detail?: string;
    source?: React.ReactNode;
  };
  email: {
    value: string;
    detail?: string;
    source?: React.ReactNode;
  };
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold text-ink">{label}</h3>
        {different ? <Status tone="warning">Different</Status> : null}
      </div>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-ink-muted">On the paper</p>
          <p className="mt-1 text-[20px] font-semibold leading-tight tabular-nums text-ink">{paper.value}</p>
          {paper.detail ? <p className="mt-1 text-[13px] text-ink-secondary">{paper.detail}</p> : null}
          {paper.source ? <div className="mt-2">{paper.source}</div> : null}
        </div>
        <div>
          <p className="text-xs font-medium text-ink-muted">In email</p>
          <p className="mt-1 text-[20px] font-semibold leading-tight tabular-nums text-ink">{email.value}</p>
          {email.detail ? <p className="mt-1 text-[13px] text-ink-secondary">{email.detail}</p> : null}
          {email.source ? <div className="mt-2">{email.source}</div> : null}
        </div>
      </div>
    </div>
  );
}
