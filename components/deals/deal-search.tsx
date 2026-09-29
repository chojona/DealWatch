"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

interface DealSearchHit {
  id: string;
  name: string;
  company: string;
  property: string;
  stage: string;
  status: string;
  href: string;
}

function contextLine(hit: DealSearchHit): string {
  const place = [hit.company, hit.property].filter(Boolean).join(" · ");
  return [place || "Company and property not set", hit.stage].filter(Boolean).join(" · ");
}

type SearchSnapshot = {
  query: string;
  results: DealSearchHit[] | null;
  error: boolean;
};

export function DealSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<SearchSnapshot | null>(null);
  const trimmed = query.replace(/\s+/g, " ").trim();
  const active = trimmed.length > 0;
  const settled = snapshot?.query === trimmed ? snapshot : null;
  const loading = active && settled === null;
  const error = settled?.error ?? false;
  const results = settled?.results ?? null;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/deals/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("search");
        const body = (await response.json()) as { results: DealSearchHit[] };
        if (controller.signal.aborted) return;
        setSnapshot({ query: trimmed, results: body.results, error: false });
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        if (controller.signal.aborted) return;
        setSnapshot({ query: trimmed, results: null, error: true });
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, trimmed]);

  return (
    <div>
      <label htmlFor="deal-search" className="sr-only">Search deals</label>
      <input
        id="deal-search"
        type="search"
        value={query}
        placeholder="Search deals..."
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        className="mb-4 h-9 w-full max-w-md rounded-sm border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-500"
      />
      {active ? (
        <div aria-live="polite">
          {loading && <p className="text-xs text-zinc-500">Searching deals…</p>}
          {!loading && error && (
            <p className="rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              Deal search could not be loaded.
            </p>
          )}
          {!loading && !error && results?.length === 0 && (
            <p className="rounded-sm border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-500">
              No deals match “{trimmed}”.
            </p>
          )}
          {!loading && !error && results && results.length > 0 && (
            <ul className="flex flex-col gap-2">
              {results.map((hit) => (
                <li key={hit.id}>
                  <Link
                    href={hit.href}
                    className="block rounded-sm border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300"
                  >
                    <span className="block text-sm font-semibold text-zinc-900">{hit.name}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">
                      {contextLine(hit)}
                      <span className="text-zinc-300"> · </span>
                      {hit.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
