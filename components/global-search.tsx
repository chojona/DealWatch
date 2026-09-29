"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CanonicalSearchHit } from "@/lib/graph/path-types";
import { canonicalEntityHref } from "@/lib/intelligence/routes";

const labels = { PERSON: "People", COMPANY: "Companies", PROPERTY: "Properties", DEAL: "Deals" } as const;

export function GlobalSearch({ variant = "default", id = "global-search" }: { variant?: "default" | "sidebar"; id?: string }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CanonicalSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/graph/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        if (!response.ok) throw new Error("search");
        const body = (await response.json()) as { results: CanonicalSearchHit[] };
        setResults(body.results);
        setActive(0);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const grouped = useMemo(() => Object.entries(labels).map(([type, label]) => ({ type, label, rows: results.filter((row) => row.entityType === type) })).filter((group) => group.rows.length), [results]);
  const selected = results[active];
  const choose = (hit: CanonicalSearchHit) => { setOpen(false); setQuery(""); router.push(canonicalEntityHref(hit.entityType, hit.entityId)); };

  const sidebar = variant === "sidebar";
  return (
    <div ref={root} className={sidebar ? "relative w-full" : "relative w-full max-w-xs"}>
      <label htmlFor={id} className="sr-only">Search DealWatch people, companies, properties, and deals</label>
      <input
        id={id} type="search" role="combobox" aria-expanded={open} aria-controls={`${id}-results`} aria-activedescendant={selected ? `${id}-result-${selected.nodeId}` : undefined}
        value={query} placeholder="Search"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          setOpen(true);
          if (value.trim().length < 2) {
            setResults([]);
            setLoading(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); }
          if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setOpen(true); setActive((value) => (value + 1) % results.length); }
          if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActive((value) => (value - 1 + results.length) % results.length); }
          if (event.key === "Enter" && selected) { event.preventDefault(); choose(selected); }
        }}
        className={sidebar
          ? "h-9 w-full rounded-lg border border-white/15 bg-white/10 px-3 text-sm text-sidebar-text outline-none placeholder:text-sidebar-muted focus:border-white/40"
          : "field"}
      />
      {open && query.trim().length >= 2 && (
        <div id={`${id}-results`} role="listbox" className="absolute left-0 top-10 z-50 max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-surface py-1 text-ink">
          {loading && <p className="px-3 py-2 text-[13px] text-ink-secondary">Searching deals, people, companies, and properties…</p>}
          {!loading && !results.length && <p className="px-3 py-4 text-center text-[13px] text-ink-secondary">No matching deals, people, companies, or properties.</p>}
          {!loading && grouped.map((group) => (
            <section key={group.type} aria-label={group.label}>
              <h2 className="border-t border-line bg-surface-subtle px-3 py-1.5 text-xs font-medium text-ink-muted first:border-t-0">{group.label}</h2>
              {group.rows.map((hit) => {
                const index = results.findIndex((row) => row.nodeId === hit.nodeId);
                return (
                  <button key={hit.nodeId} id={`${id}-result-${hit.nodeId}`} type="button" role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => choose(hit)} className={`block w-full px-3 py-2 text-left ${index === active ? "bg-brand-subtle" : "hover:bg-surface-subtle"}`}>
                    <span className="block text-sm font-medium text-ink">{hit.label}</span>
                    {hit.subtitle && <span className="block text-[13px] text-ink-secondary">{hit.subtitle}</span>}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
