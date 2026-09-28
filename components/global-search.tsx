"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CanonicalSearchHit } from "@/lib/graph/path-types";
import { canonicalEntityHref } from "@/lib/intelligence/routes";

const labels = { PERSON: "People", COMPANY: "Companies", PROPERTY: "Properties", DEAL: "Deals" } as const;

export function GlobalSearch() {
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

  return (
    <div ref={root} className="relative w-72">
      <label htmlFor="global-search" className="sr-only">Search DealWatch people, companies, properties, and deals</label>
      <input
        id="global-search" type="search" role="combobox" aria-expanded={open} aria-controls="global-search-results" aria-activedescendant={selected ? `global-result-${selected.nodeId}` : undefined}
        value={query} placeholder="Search DealWatch"
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
        className="h-8 w-full rounded-sm border border-zinc-300 bg-zinc-50 px-2.5 text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:bg-white"
      />
      {open && query.trim().length >= 2 && (
        <div id="global-search-results" role="listbox" className="absolute right-0 top-9 z-50 max-h-[70vh] w-96 overflow-y-auto rounded-sm border border-zinc-300 bg-white py-1 shadow-lg">
          {loading && <p className="px-3 py-2 text-xs text-zinc-500">Searching confirmed canonical records…</p>}
          {!loading && !results.length && <p className="px-3 py-4 text-center text-xs text-zinc-500">No confirmed canonical results.</p>}
          {!loading && grouped.map((group) => (
            <section key={group.type} aria-label={group.label}>
              <h2 className="border-t border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 first:border-t-0">{group.label}</h2>
              {group.rows.map((hit) => {
                const index = results.findIndex((row) => row.nodeId === hit.nodeId);
                return (
                  <button key={hit.nodeId} id={`global-result-${hit.nodeId}`} type="button" role="option" aria-selected={index === active} onMouseEnter={() => setActive(index)} onClick={() => choose(hit)} className={`block w-full px-3 py-2 text-left ${index === active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}>
                    <span className="block text-sm font-medium text-zinc-950">{hit.label}</span>
                    {hit.subtitle && <span className="block text-[11px] text-zinc-500">{hit.subtitle}</span>}
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
