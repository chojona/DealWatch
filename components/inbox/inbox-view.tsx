import Link from "next/link";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import { formatDate } from "@/lib/formatters";
import { processingLabel } from "@/lib/inbox/status";
import type { InboxFilter, InboxItem, InboxPageModel } from "@/lib/inbox/types";

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
}: {
  page: InboxPageModel;
  basePath: string;
  query: URLSearchParams;
  lockedDealName?: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Deal inbox</p>
          <h1 className="mt-1 text-lg font-semibold text-zinc-900">
            {lockedDealName ? `${lockedDealName} documents` : "Documents"}
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-zinc-500">
            Uploads that need processing, review, or no further action. Pasted negotiation rounds stay on the negotiation workspace.
          </p>
        </div>
        <p className="text-xs tabular-nums text-zinc-500">{page.counts.ALL} documents</p>
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((filter) => {
          const active = (query.get("filter") ?? "ALL").toUpperCase() === filter.id;
          return (
            <Link
              key={filter.id}
              href={hrefWith(basePath, query, { filter: filter.id === "ALL" ? null : filter.id })}
              className={`rounded-sm border px-2.5 py-1 text-[11px] font-medium ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"}`}
            >
              {filter.label}
              <span className="ml-1.5 tabular-nums opacity-70">{page.counts[filter.id]}</span>
            </Link>
          );
        })}
      </div>

      <form action={basePath} className="grid gap-2 rounded-sm border border-zinc-200 bg-white p-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
        {query.get("filter") && <input type="hidden" name="filter" value={query.get("filter") ?? ""} />}
        <input
          name="q"
          defaultValue={query.get("q") ?? ""}
          placeholder="Search filename, deal, company, or property"
          className="h-8 rounded-sm border border-zinc-200 px-2 text-xs text-zinc-900 outline-none focus:border-zinc-400"
        />
        {lockedDealName ? (
          <p className="flex h-8 items-center text-xs text-zinc-600">{lockedDealName}</p>
        ) : (
          <select name="dealId" defaultValue={query.get("dealId") ?? ""} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs text-zinc-800">
            <option value="">All deals</option>
            {page.facets.deals.map((deal) => (
              <option key={deal.id} value={deal.id}>{deal.name}</option>
            ))}
          </select>
        )}
        <select name="documentType" defaultValue={query.get("documentType") ?? ""} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs text-zinc-800">
          <option value="">All document types</option>
          {page.facets.documentTypes.map((type) => (
            <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type] ?? type}</option>
          ))}
        </select>
        <select name="side" defaultValue={query.get("side") ?? ""} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs text-zinc-800">
          <option value="">All sides</option>
          {page.facets.sides.map((side) => (
            <option key={side} value={side}>{sideLabel(side)}</option>
          ))}
        </select>
        <button type="submit" className="h-8 rounded-sm border border-zinc-200 px-3 text-xs font-medium text-zinc-800">
          Apply
        </button>
      </form>

      {page.items.length === 0 ? (
        <div className="rounded-sm border border-zinc-200 bg-white px-4 py-10 text-center">
          <p className="text-sm font-medium text-zinc-800">
            {page.counts.ALL === 0 ? "No documents yet" : "No documents match these filters"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {page.counts.ALL === 0
              ? "Upload a PDF from a deal’s negotiation workspace. It will appear here when stored."
              : "Clear a filter to see the rest of the inbox."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {page.items.map((item) => (
            <InboxCard key={item.document.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
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
            {item.documentDate ? formatDate(item.documentDate) : "No document date"}
            {" · Uploaded "}
            {formatDate(item.uploadedAt)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700">
            {processingLabel(item.processingStatus)}
          </p>
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
            <p className="mt-1 text-xs text-zinc-500">No graph observations</p>
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
        <Link
          href={item.nextAction.href}
          className="inline-flex h-8 items-center rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white"
        >
          {item.nextAction.label}
        </Link>
      </div>
    </article>
  );
}
