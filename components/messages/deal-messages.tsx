"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { DealMessageListItem } from "@/lib/messages/list";

function day(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export function DealMessages({ dealId, items }: { dealId: string; items: DealMessageListItem[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"MANUAL" | "EML">("MANUAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/deals/${dealId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed");
      event.currentTarget.reset(); router.push(result.href); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Import failed"); } finally { setBusy(false); }
  }

  async function eml(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/deals/${dealId}/messages`, { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Import failed");
      event.currentTarget.reset(); router.push(result.href); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Import failed"); } finally { setBusy(false); }
  }

  const input = "rounded-sm border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-900";
  return <div className="space-y-6">
    <section className="rounded-sm border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Import email</h2><p className="mt-1 text-xs text-zinc-500">Import preserves evidence only. Analysis is always a separate action.</p></div><div className="flex rounded-sm border border-zinc-200 p-0.5"><button onClick={() => setMode("MANUAL")} className={`px-2 py-1 text-[11px] ${mode === "MANUAL" ? "bg-zinc-900 text-white" : "text-zinc-600"}`}>Paste</button><button onClick={() => setMode("EML")} className={`px-2 py-1 text-[11px] ${mode === "EML" ? "bg-zinc-900 text-white" : "text-zinc-600"}`}>.eml file</button></div></div>
      {mode === "MANUAL" ? <form onSubmit={manual} className="mt-4 grid gap-3 sm:grid-cols-2"><input name="subject" placeholder="Subject (optional)" className={input}/><input name="senderName" placeholder="Sender name (optional)" className={input}/><input name="senderAddress" type="email" placeholder="Sender email (optional)" className={input}/><input name="recipients" placeholder="Recipients, comma separated (optional)" className={input}/><input name="sentAt" type="datetime-local" className={input}/><span/><textarea name="body" required placeholder="Paste the email body" rows={8} className={`${input} sm:col-span-2`}/><button disabled={busy} className="w-fit rounded-sm bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "Importing…" : "Import message"}</button></form> : <form onSubmit={eml} className="mt-4 flex flex-wrap items-center gap-3"><input name="file" type="file" accept=".eml,message/rfc822" required className={input}/><button disabled={busy} className="rounded-sm bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">{busy ? "Importing…" : "Import .eml"}</button></form>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
    <section><div className="mb-3"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Messages</h2><p className="mt-1 text-xs text-zinc-500">Newest communication first · bounded to 100 messages.</p></div>
      {items.length === 0 ? <div className="rounded-sm border border-zinc-200 bg-white p-8 text-center"><p className="text-sm font-medium text-zinc-800">No messages yet</p><p className="mt-1 text-xs text-zinc-500">Paste an email or import an .eml file to add communication evidence for this deal.</p></div> : <div className="space-y-2">{items.map((item) => <Link key={item.id} href={item.href} className="block rounded-sm border border-zinc-200 bg-white p-4 hover:border-zinc-300"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-zinc-950">{item.subject}</h3><p className="mt-0.5 text-xs text-zinc-500">{day(item.date)} · {item.sender} · {item.sourceType}</p></div><div className="flex gap-1.5"><span className="rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase text-zinc-600">{item.analysisState.replaceAll("_", " ")}</span><span className="rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase text-zinc-600">{item.reviewState.replaceAll("_", " ")}</span></div></div><p className="mt-2 text-xs text-zinc-700">{item.negotiationFactCount} negotiation {item.negotiationFactCount === 1 ? "fact" : "facts"} · {item.factCount} commercial facts</p>{item.reconciliationSummary.length > 0 && <p className="mt-1 text-[11px] text-zinc-500">{item.reconciliationSummary.slice(0, 3).join(" · ")}</p>}</Link>)}</div>}
    </section>
  </div>;
}
