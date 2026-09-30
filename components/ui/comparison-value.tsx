import { EvidenceQuote } from "@/components/ui/evidence-quote";
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
    quote?: string | null;
    citation?: React.ReactNode;
    source?: React.ReactNode;
  };
  email: {
    value: string;
    detail?: React.ReactNode;
    quote?: string | null;
    citation?: React.ReactNode;
    source?: React.ReactNode;
  };
}) {
  const valueClass = matched
    ? "mt-1 break-words text-[16px] font-medium leading-[22px] tabular-nums text-ink-secondary"
    : "mt-1 break-words text-[16px] font-semibold leading-[22px] tabular-nums text-ink";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold leading-[18px] text-ink">{label}</h3>
        {different ? <Status tone="warning">Different</Status> : null}
        {matched ? <span className="text-xs text-ink-muted">Matches</span> : null}
      </div>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium leading-[15px] text-ink-muted">{paperLabel}</p>
          <p className={valueClass}>{paper.value}</p>
          {paper.quote ? <div className="mt-1"><EvidenceQuote quote={paper.quote} citation={paper.citation} /></div> : null}
          {paper.detail ? <div className="mt-1 break-words text-xs leading-4 text-ink-secondary">{paper.detail}</div> : null}
          {paper.source ? <div className="mt-1">{paper.source}</div> : null}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium leading-[15px] text-ink-muted">{emailLabel}</p>
          <p className={valueClass}>{email.value}</p>
          {email.quote ? <div className="mt-1"><EvidenceQuote quote={email.quote} citation={email.citation} /></div> : null}
          {email.detail ? <div className="mt-1 break-words text-xs leading-4 text-ink-secondary">{email.detail}</div> : null}
          {email.source ? <div className="mt-1">{email.source}</div> : null}
        </div>
      </div>
    </div>
  );
}
