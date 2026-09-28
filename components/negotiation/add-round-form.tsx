"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function AddRoundForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/deals/${dealId}/negotiation/rounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "PASTED_TEXT",
          side: form.get("side"),
          documentName: form.get("documentName"),
          documentDate: form.get("documentDate"),
          documentText: form.get("documentText"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Analysis failed");
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <FilePlus2 className="h-3.5 w-3.5" /> Add negotiation round
      </Button>
    );
  }

  return (
    <div className="rounded-sm border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Add document round</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Paste one complete LOI or counter. Round number is assigned per side.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close add round form"
          onClick={() => setOpen(false)}
          className="rounded-sm p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-[11px] font-medium text-zinc-600">
            Side
            <select
              name="side"
              className="mt-1 h-8 w-full rounded-sm border border-zinc-200 bg-white px-2 text-xs"
            >
              <option value="TENANT">Tenant</option>
              <option value="LANDLORD">Landlord</option>
            </select>
          </label>
          <label className="text-[11px] font-medium text-zinc-600">
            Document name
            <input
              required
              name="documentName"
              placeholder="Tenant counter"
              className="mt-1 h-8 w-full rounded-sm border border-zinc-200 px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </label>
          <label className="text-[11px] font-medium text-zinc-600">
            Document date
            <input
              required
              name="documentDate"
              type="date"
              className="mt-1 h-8 w-full rounded-sm border border-zinc-200 px-2 text-xs outline-none focus:ring-1 focus:ring-zinc-900"
            />
          </label>
        </div>
        <label className="block text-[11px] font-medium text-zinc-600">
          Document text
          <Textarea
            required
            name="documentText"
            placeholder="Paste the full document text here…"
            className="mt-1 min-h-48 font-mono text-xs"
          />
        </label>
        {error && (
          <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-zinc-400">
            Evidence is checked against the pasted source before saving.
          </p>
          <Button disabled={loading} type="submit">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Extracting terms…" : "Analyze and add"}
          </Button>
        </div>
      </form>
    </div>
  );
}
