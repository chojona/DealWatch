"use client";

import Link from "next/link";
import { useState } from "react";
import { EvidencePanel } from "@/components/knowledge/evidence-panel";
import type { ActivityEvent, ActivityFilter, ActivityPage, ActivityRootType } from "@/lib/activity/types";

const filters: Array<{ value: ActivityFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "NEGOTIATION", label: "Negotiation" },
  { value: "DOCUMENTS", label: "Documents" },
  { value: "RELATIONSHIPS", label: "Relationships" },
];

const eventLabels: Record<ActivityEvent["eventType"], string> = {
  DOCUMENT: "Document",
  DEAL_ACTIVITY: "Deal activity",
  NEGOTIATION_PROPOSAL: "Negotiation proposal",
  NEGOTIATION_COUNTER: "Negotiation counter",
  NEGOTIATION_AGREEMENT: "Negotiation agreement",
  NEGOTIATION_CHANGE: "Negotiation change",
  ENTITY_EVIDENCE: "Entity evidence",
  RELATIONSHIP_EVIDENCE: "Relationship evidence",
  DEAL_PARTICIPATION: "Deal participation",
  EMPLOYMENT_EVIDENCE: "Employment evidence",
  PROPERTY_RELATIONSHIP_EVIDENCE: "Property relationship",
  DOCUMENT_REVIEW: "Document review",
};

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
}

function groupEvents(events: ActivityEvent[]) {
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const key = event.occurredAt ? dateLabel(event.occurredAt) : "Date unknown";
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

function statusClass(status: string): string {
  if (status === "AGREED") return "bg-green-50 text-green-700";
  if (status === "REJECTED") return "bg-red-50 text-red-700";
  if (status === "WITHDRAWN") return "bg-zinc-100 text-zinc-600";
  return "bg-blue-50 text-blue-700";
}

function EventCard({ event }: { event: ActivityEvent }) {
  return (
    <article className="relative border-l border-zinc-200 pb-5 pl-5 last:pb-1">
      <span className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-zinc-400 ring-4 ring-white" />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{eventLabels[event.eventType]}</span>
            {event.resolutionState === "PENDING" && <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">Pending / unresolved</span>}
          </div>
          <h4 className="mt-0.5 text-sm font-semibold text-zinc-900">{event.title}</h4>
          {event.description && <p className="mt-0.5 text-xs leading-5 text-zinc-600">{event.description}</p>}
        </div>
        {event.documentId && (
          <a href={`/api/documents/${event.documentId}/file${event.documentPageId ? "" : ""}`} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-medium text-zinc-600 underline">
            Open document
          </a>
        )}
        {event.negotiationHref && (
          <Link href={event.negotiationHref} className="shrink-0 text-[11px] font-medium text-zinc-700 underline">
            Open negotiation round
          </Link>
        )}
      </div>
      {event.details && event.details.length > 0 && (
        <div className="mt-3 divide-y divide-zinc-100 rounded-sm border border-zinc-200 bg-zinc-50/60">
          {event.details.map((detail, index) => (
            <div key={`${detail.canonicalType}:${detail.status}:${index}`} className="px-3 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                <span className="font-medium text-zinc-700">{detail.label}</span>
                <div className="text-right">
                  <span className="text-zinc-900">{detail.previousValue ? <><span className="text-zinc-400 line-through">{detail.previousValue}</span><span className="mx-1.5 text-zinc-400">→</span></> : null}{detail.value}</span>
                  <span className={`ml-2 rounded-sm px-1.5 py-0.5 text-[9px] font-semibold ${statusClass(detail.status)}`}>{detail.status}</span>
                </div>
              </div>
              {detail.structured && (
                <dl className="mt-2 grid gap-1 border-l-2 border-zinc-200 pl-2 sm:grid-cols-2">
                  {detail.structured.rows.map((row, rowIndex) => (
                    <div key={`${row.label}:${rowIndex}`} className="flex gap-2 text-[11px]"><dt className="text-zinc-400">{row.label}</dt><dd className="text-zinc-700">{row.value}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      )}
      {event.entityRefs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          {event.entityRefs.map((ref) => <Link key={`${ref.type}:${ref.id}`} href={ref.href} className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">{ref.name}</Link>)}
        </div>
      )}
      {event.evidence && <EvidencePanel evidence={event.evidence} />}
    </article>
  );
}

export function ActivityTimeline({
  initialPage,
  rootType,
  title = "Activity / History",
}: {
  initialPage: ActivityPage;
  rootType: ActivityRootType;
  title?: string;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("ALL");
  const [events, setEvents] = useState(initialPage.events);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(selectedFilter: ActivityFilter, cursor: string | null, append: boolean) {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ rootType, rootId: initialPage.root.id, filter: selectedFilter, limit: "25" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/activity?${query.toString()}`);
      if (!response.ok) throw new Error("Activity could not be loaded");
      const page = await response.json() as ActivityPage;
      setEvents((current) => append ? [...current, ...page.events] : page.events);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Activity could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  function selectFilter(next: ActivityFilter) {
    if (next === filter) return;
    setFilter(next);
    if (next === "ALL") {
      setEvents(initialPage.events);
      setNextCursor(initialPage.nextCursor);
      setError(null);
      return;
    }
    void load(next, null, false);
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">Business dates are shown when stored; unknown dates stay unknown.</p>
        </div>
        <div className="flex rounded-sm border border-zinc-200 bg-white p-0.5" aria-label="Activity filters">
          {filters.map((item) => (
            <button key={item.value} type="button" onClick={() => selectFilter(item.value)} className={`rounded-sm px-2.5 py-1 text-[11px] font-medium ${filter === item.value ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"}`}>{item.label}</button>
          ))}
        </div>
      </div>
      <div className="rounded-sm border border-zinc-200 bg-white p-4">
        {events.length === 0 && !loading ? <p className="py-6 text-center text-xs text-zinc-500">No evidence-backed activity is available for this view.</p> : (
          <div className="space-y-5">
            {groupEvents(events).map(([date, group]) => (
              <div key={date}>
                <h3 className={`mb-3 text-[11px] font-semibold uppercase tracking-wider ${date === "Date unknown" ? "text-amber-700" : "text-zinc-400"}`}>{date}</h3>
                <div>{group.map((event) => <EventCard key={event.id} event={event} />)}</div>
              </div>
            ))}
          </div>
        )}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        {nextCursor && (
          <button type="button" disabled={loading} onClick={() => void load(filter, nextCursor, true)} className="mt-4 w-full rounded-sm border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            {loading ? "Loading…" : "Load older activity"}
          </button>
        )}
      </div>
    </section>
  );
}
