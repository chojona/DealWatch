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
    <div className="w-full basis-full rounded-md border border-line bg-surface px-4 py-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold leading-[18px] text-ink">Add document round</h2>
          <p className="mt-0.5 text-xs leading-4 text-ink-secondary">
            Paste one complete LOI or counter. Round number is assigned per side.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close add round form"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-ink-muted hover:bg-surface-subtle hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="field-label">
            Side
            <select name="side" className="field mt-1">
              <option value="TENANT">Tenant</option>
              <option value="LANDLORD">Landlord</option>
            </select>
          </label>
          <label className="field-label">
            Document name
            <input
              required
              name="documentName"
              placeholder="Tenant counter"
              className="field mt-1"
            />
          </label>
          <label className="field-label">
            Document date
            <input required name="documentDate" type="date" className="field mt-1" />
          </label>
        </div>
        <label className="field-label">
          Document text
          <Textarea
            required
            name="documentText"
            placeholder="Paste the full document text here…"
            className="mt-1 min-h-48"
          />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs leading-4 text-ink-muted">
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
