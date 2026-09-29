"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const STAGES = [
  "Prospect",
  "Market Survey",
  "Tour",
  "LOI",
  "Negotiation",
  "Lease Execution",
  "Closed",
];

export function CreateDealForm() {
  const router = useRouter();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) {
      setError("Deal name is required");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          company: String(data.get("company") ?? ""),
          property: String(data.get("property") ?? ""),
          stage: String(data.get("stage") ?? "Prospect"),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.href !== "string") {
        throw new Error(typeof result.error === "string" ? result.error : "Deal could not be created");
      }
      router.push(result.href);
      router.refresh();
    } catch (cause) {
      submitting.current = false;
      setBusy(false);
      setError(cause instanceof Error ? cause.message : "Deal could not be created");
    }
  }

  const field = "mt-1 h-8 w-full rounded-sm border border-zinc-200 bg-white px-2 text-xs text-zinc-900 outline-none focus:border-zinc-400";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-sm border border-zinc-200 bg-white p-4">
      <label className="block text-[11px] font-medium text-zinc-600">
        Deal name
        <input name="name" required maxLength={200} autoFocus placeholder="Acme Acquisition" className={field} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[11px] font-medium text-zinc-600">
          Company
          <input name="company" maxLength={200} placeholder="Optional" className={field} />
        </label>
        <label className="block text-[11px] font-medium text-zinc-600">
          Property
          <input name="property" maxLength={200} placeholder="Optional" className={field} />
        </label>
      </div>
      <label className="block text-[11px] font-medium text-zinc-600">
        Stage
        <select name="stage" defaultValue="Prospect" className={field}>
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </select>
      </label>
      {error ? (
        <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create deal"}
        </Button>
      </div>
    </form>
  );
}
