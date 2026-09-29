import Link from "next/link";
import { Status } from "@/components/ui/status";
import { formatCurrency, formatDate } from "@/lib/formatters";

interface DealHeaderProps {
  dealId?: string;
  activeSection?: "overview" | "negotiation" | "activity" | "knowledge" | "connections" | "documents" | "messages" | "actions";
  name: string;
  company: string;
  property: string;
  propertyHref?: string | null;
  stage: string;
  status: string;
  intelligenceStatus?: string | null;
  estimatedValue: number | null;
  createdAt: Date;
}

export function DealHeader({
  dealId,
  activeSection = "overview",
  name,
  company,
  property,
  propertyHref,
  stage,
  status,
  intelligenceStatus,
  estimatedValue,
  createdAt,
}: DealHeaderProps) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="page-gutter py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
              <Link href="/deals" className="hover:text-ink">
                Deals
              </Link>
              <span aria-hidden="true">/</span>
              <span className="truncate text-ink-secondary">{company || "Deal"}</span>
            </div>
            <h1 className="page-title mt-2">{name}</h1>
            {company ? <p className="mt-1 text-sm text-ink-secondary">{company}</p> : null}
            {property ? (
              <div className="mt-1">
                {propertyHref ? (
                  <Link href={propertyHref} className="text-sm text-ink-secondary underline decoration-line underline-offset-2 hover:text-ink">
                    {property}
                  </Link>
                ) : (
                  <span className="text-sm text-ink-secondary">{property}</span>
                )}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Status tone={stage === "Closed" ? "success" : "neutral"}>{stage}</Status>
              {intelligenceStatus ? <Status tone="neutral">{intelligenceStatus}</Status> : null}
              <Status tone="neutral">{intelligenceStatus ? `Record ${status}` : status}</Status>
            </div>
            {estimatedValue ? (
              <span className="text-lg font-semibold tabular-nums text-ink">
                {formatCurrency(estimatedValue)}
              </span>
            ) : null}
            <span className="text-xs font-medium text-ink-muted">Since {formatDate(createdAt)}</span>
          </div>
        </div>
        {dealId ? (
          <nav aria-label="Deal" className="-mb-6 mt-6 flex gap-5 overflow-x-auto">
            {(
              [
                ["overview", "Overview", `/deals/${dealId}`],
                ["documents", "Documents", `/deals/${dealId}/documents`],
                ["messages", "Messages", `/deals/${dealId}/messages`],
                ["actions", "Actions", `/deals/${dealId}#actions`],
                ["negotiation", "Negotiation", `/deals/${dealId}/negotiation`],
                ["knowledge", "Knowledge", `/deals/${dealId}/knowledge`],
                ["connections", "Connections", `/deals/${dealId}/connections`],
                ["activity", "Activity", `/deals/${dealId}/activity`],
              ] as const
            ).map(([id, label, href]) => (
              <Link
                key={id}
                href={href}
                aria-current={activeSection === id ? "page" : undefined}
                className={`shrink-0 border-b-2 pb-3 text-sm font-medium ${
                  activeSection === id
                    ? "border-brand text-ink"
                    : "border-transparent text-ink-secondary hover:text-ink"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
