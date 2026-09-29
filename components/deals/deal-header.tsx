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

function displayStatus(status: string): string {
  if (/^[A-Z][A-Z\s]+$/.test(status) && status.length > 3) {
    return status.charAt(0) + status.slice(1).toLowerCase();
  }
  return status;
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
  const breadcrumb = company.trim();
  const breadcrumbIsProperty = Boolean(propertyHref && property && property === breadcrumb);
  const showProperty = Boolean(property && property !== breadcrumb && property !== name);

  return (
    <div className="border-b border-line bg-surface">
      <div className="page-gutter py-5 sm:py-6">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
          <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <li>
              <Link href="/deals" className="hover:text-ink">
                Deals
              </Link>
            </li>
            {breadcrumb ? (
              <>
                <li aria-hidden="true">/</li>
                <li className="min-w-0 text-ink-secondary">
                  {breadcrumbIsProperty ? (
                    <Link href={propertyHref!} className="break-words underline decoration-line underline-offset-2 hover:text-ink">
                      {breadcrumb}
                    </Link>
                  ) : (
                    <span className="break-words">{breadcrumb}</span>
                  )}
                </li>
              </>
            ) : null}
          </ol>
        </nav>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <h1 className="page-title max-w-3xl text-balance break-words">{name}</h1>
          <div className="flex max-w-xl flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-secondary">
            {showProperty ? (
              propertyHref ? (
                <Link href={propertyHref} className="break-words underline decoration-line underline-offset-2 hover:text-ink">
                  {property}
                </Link>
              ) : (
                <span className="break-words">{property}</span>
              )
            ) : null}
            <Status tone={stage === "Closed" ? "success" : "neutral"}>{stage}</Status>
            {intelligenceStatus ? <Status tone="neutral">{intelligenceStatus}</Status> : null}
            <Status tone="neutral">{intelligenceStatus ? `Record ${displayStatus(status)}` : displayStatus(status)}</Status>
            {estimatedValue ? (
              <span className="tabular-nums text-ink">{formatCurrency(estimatedValue)}</span>
            ) : null}
            <span className="text-ink-muted">Since {formatDate(createdAt)}</span>
          </div>
        </div>
        {dealId ? (
          <nav aria-label="Deal" className="mt-5 flex gap-5 overflow-x-auto">
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
