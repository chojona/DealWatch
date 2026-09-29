"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";

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

  return (
    <form onSubmit={submit} className="space-y-5">
      <label className="field-label">
        Deal name
        <input name="name" required maxLength={200} autoFocus placeholder="Acme Acquisition" className="field mt-1" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="field-label">
          Company
          <input name="company" maxLength={200} placeholder="Optional" className="field mt-1" />
        </label>
        <label className="field-label">
          Property
          <input name="property" maxLength={200} placeholder="Optional" className="field mt-1" />
        </label>
      </div>
      <label className="field-label">
        Stage
        <select name="stage" defaultValue="Prospect" className="field mt-1">
          {STAGES.map((stage) => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </select>
      </label>
      {error ? <ErrorState title="Deal was not created" description={error} /> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create deal"}
        </Button>
      </div>
    </form>
  );
}
