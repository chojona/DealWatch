import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import { formatCalendarDate, formatDate } from "@/lib/formatters";
import type { InboxFilter, InboxItem, InboxMessageItem, InboxPageModel } from "@/lib/inbox/types";

const FILTERS: Array<{ id: InboxFilter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "NEEDS_REVIEW", label: "Needs review" },
  { id: "PROCESSING", label: "Processing" },
  { id: "COMPLETE", label: "Reviewed" },
  { id: "FAILED", label: "Failed" },
];

function sideLabel(side: string | null): string {
  if (side === "LANDLORD") return "Landlord";
  if (side === "TENANT") return "Tenant";
  return "Side not set";
}

function hrefWith(basePath: string, current: URLSearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function InboxView({
  page,
  basePath,
  query,
  lockedDealName,
  documentsOnly = false,
}: {
  page: InboxPageModel;
  basePath: string;
  query: URLSearchParams;
  lockedDealName?: string | null;
  documentsOnly?: boolean;
}) {
  const visibleCount = documentsOnly ? page.items.length : page.sourceItems.length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {lockedDealName ? (
            <h2 className="section-title">Documents</h2>
          ) : (
            <h1 className="page-title">Inbox</h1>
          )}
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            Documents and emails that still need preparation, analysis, or review. This is source work, not the portfolio dashboard.
          </p>
        </div>
        <p className="text-xs tabular-nums text-zinc-500">{documentsOnly ? page.items.length : page.sourceCounts.ALL} sources</p>
      </div>

      {!documentsOnly && <div className="flex flex-wrap gap-1">
        {(["ALL", "DOCUMENTS", "MESSAGES"] as const).map((source) => {
          const active = (query.get("source") ?? "ALL").toUpperCase() === source;
          return (
            <Link key={source} href={hrefWith(basePath, query, { source: source === "ALL" ? null : source })} aria-current={active ? "page" : undefined} className={`border-b-2 px-1 pb-2 text-sm ${active ? "border-brand font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink"}`}>
              {source === "ALL" ? "All" : source === "DOCUMENTS" ? "Documents" : "Messages"}
              <span className="ml-1.5 tabular-nums text-ink-muted">{page.sourceCounts[source]}</span>
            </Link>
          );
        })}
      </div>}

      {!documentsOnly && page.messageWindow.truncated ? (
        <p className="text-xs text-zinc-500">
          Showing the most recent {page.messageWindow.limit} messages. Older messages stay outside this work queue.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((filter) => {
          const active = (query.get("filter") ?? "ALL").toUpperCase() === filter.id;
          return (
            <Link
              key={filter.id}
              href={hrefWith(basePath, query, { filter: filter.id === "ALL" ? null : filter.id })}
              aria-current={active ? "page" : undefined}
              className={`border-b-2 px-1 pb-2 text-sm ${active ? "border-brand font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink"}`}
            >
              {filter.label}
              <span className="ml-1.5 tabular-nums opacity-70">{page.counts[filter.id]}</span>
            </Link>
          );
        })}
      </div>

      <form action={basePath} className="grid items-end gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
        {query.get("filter") && <input type="hidden" name="filter" value={query.get("filter") ?? ""} />}
        {query.get("source") && <input type="hidden" name="source" value={query.get("source") ?? ""} />}
        <label className="field-label">
          Search
          <input
            name="q"
            defaultValue={query.get("q") ?? ""}
            placeholder="Filename, deal, company, or property"
            className="field mt-1"
          />
        </label>
        {lockedDealName ? (
          <p className="flex h-9 items-center text-sm text-ink-secondary">{lockedDealName}</p>
        ) : (
          <label className="field-label">
            Deal
            <select name="dealId" defaultValue={query.get("dealId") ?? ""} className="field mt-1">
              <option value="">All deals</option>
              {page.facets.deals.map((deal) => (
                <option key={deal.id} value={deal.id}>{deal.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field-label">
          Document type
          <select name="documentType" defaultValue={query.get("documentType") ?? ""} className="field mt-1">
            <option value="">All document types</option>
            {page.facets.documentTypes.map((type) => (
              <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type] ?? type}</option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Side
          <select name="side" defaultValue={query.get("side") ?? ""} className="field mt-1">
            <option value="">All sides</option>
            {page.facets.sides.map((side) => (
              <option key={side} value={side}>{sideLabel(side)}</option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">Apply</Button>
      </form>

      {visibleCount === 0 ? (
        <EmptyState
          title={(documentsOnly ? page.items.length : page.sourceCounts.ALL) === 0 ? "No sources yet" : "No sources match these filters"}
          description={(documentsOnly ? page.items.length : page.sourceCounts.ALL) === 0
            ? documentsOnly
              ? "Upload a PDF above to add the first source for this deal."
              : "Import an email or upload a PDF from a deal workspace."
            : "Clear a filter to see the rest of the inbox."}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {documentsOnly ? page.items.map((item) => <InboxCard key={item.document.id} item={item} />) : page.sourceItems.map((source) => source.kind === "DOCUMENT" ? <InboxCard key={`document:${source.document.document.id}`} item={source.document} /> : <MessageInboxCard key={`message:${source.message.id}`} item={source.message} />)}
        </div>
      )}
    </div>
  );
}

function MessageInboxCard({ item }: { item: InboxMessageItem }) {
  const actionLabel = item.actionReviewState === "PENDING"
    ? "Action evidence pending"
    : item.actionReviewState === "REVIEWED"
      ? "Action evidence reviewed"
      : null;
  return <article className="rounded-sm border border-zinc-200 bg-white px-4 py-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Message · {item.sourceType}</p><h2 className="mt-1 text-sm font-semibold text-zinc-900">{item.subject}</h2><p className="mt-0.5 text-xs text-zinc-600"><Link href={`/deals/${item.deal.id}`} className="underline">{item.deal.name}</Link><span className="text-zinc-400"> · {item.sender} · {formatDate(item.occurredAt)}</span></p></div><div className="text-right"><p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700">{item.analysisLabel}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{item.reviewLabel}</p>{actionLabel && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-amber-800">{actionLabel}</p>}</div></div><p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-700">{item.factCount} commercial {item.factCount === 1 ? "fact" : "facts"}</p>{item.failureReason && <p className="mt-2 text-xs text-red-700">{item.failureReason}</p>}<Button asChild className="mt-3"><Link href={item.nextAction.href}>{item.nextAction.label}</Link></Button></article>;
}

function InboxCard({ item }: { item: InboxItem }) {
  const negotiation = item.negotiationSummary;
  const entities = item.entityReviewSummary;
  const relationships = item.relationshipReviewSummary;
  return (
    <article className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-zinc-900">{item.document.originalFilename}</h2>
          <p className="mt-0.5 text-xs text-zinc-600">
            <Link href={item.dealHref} className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">
              {item.deal.name}
            </Link>
            <span className="text-zinc-400"> · {item.deal.property}</span>
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            {DOCUMENT_TYPE_LABELS[item.document.documentType] ?? item.document.documentType}
            {" · "}
            {sideLabel(item.document.negotiationSide)}
            {" · "}
            {item.documentDate ? formatCalendarDate(item.documentDate) : "No document date"}
            {" · Uploaded "}
            {formatDate(item.uploadedAt)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700">
            {item.lifecycle.primaryLabel}
          </p>
          <p className="mt-0.5 text-[10px] text-zinc-500">Analysis · {item.lifecycle.analysis.label}</p>
          <p className="text-[10px] text-zinc-500">Review · {item.lifecycle.review.label}</p>
          {item.requiresReview && item.processingStatus === "FAILED" && (
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">Review required</p>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Negotiation</p>
          {negotiation.termCount === 0 ? (
            <p className="mt-1 text-xs text-zinc-500">No stored terms</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-700">
              {negotiation.changedCount} {negotiation.changedCount === 1 ? "term" : "terms"} changed
              <span className="text-zinc-400"> · </span>
              {negotiation.agreedCount} agreed
              {negotiation.conflictCount > 0 && (
                <span className="text-amber-800"> · {negotiation.conflictCount} conflicts</span>
              )}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Knowledge</p>
          {entities.found === 0 && relationships.found === 0 ? (
            <p className="mt-1 text-xs text-zinc-500">No people or companies noted</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-700">
              {entities.found} {entities.found === 1 ? "entity" : "entities"} found
              {relationships.blocked + relationships.ready > 0 && (
                <span>
                  <span className="text-zinc-400"> · </span>
                  {relationships.blocked + relationships.ready} {relationships.blocked + relationships.ready === 1 ? "relationship needs" : "relationships need"} review
                </span>
              )}
              {relationships.blocked > 0 && (
                <span className="text-amber-800"> · {relationships.blocked} blocked</span>
              )}
            </p>
          )}
        </div>
      </div>

      {item.processingStatus === "FAILED" && (item.document.failureReason || item.document.graphFailureReason) && (
        <p className="mt-3 text-xs text-red-800">
          {item.document.failureReason ?? item.document.graphFailureReason}
        </p>
      )}

      <div className="mt-3">
        <Button asChild>
          <Link href={item.nextAction.href}>{item.nextAction.label}</Link>
        </Button>
      </div>
    </article>
  );
}
