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

export function DealSearch({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DealSearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const active = query.replace(/\s+/g, " ").trim().length > 0;

  useEffect(() => {
    if (!active) {
      setResults(null);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/deals/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("search");
        const body = (await response.json()) as { results: DealSearchHit[] };
        setResults(body.results);
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return;
        setResults(null);
        setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, query]);

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
              No deals match “{query.replace(/\s+/g, " ").trim()}”.
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
