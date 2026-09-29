"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { highlightSpans } from "@/lib/ai/activity/evidence";
import { ActionEvidenceReview } from "@/components/deals/action-evidence-review";
import type { ActionEvidenceReviewItem } from "@/lib/deals/actions/evidenceReviewView";
import { ReconciliationBadge } from "@/components/deals/reconciliation-context";
import { isPromotablePdfAttachment } from "@/lib/messages/promotionEligibility";
import { actionEvidenceReviewLabel, extractionSourceLabel, messageReviewLabel, speakerSideLabel } from "@/lib/messages/reviewLabels";
import type { MessageFactView, MessageSourceView as MessageSourceDto } from "@/lib/messages/service";

function utcDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

function actionFactStatus(fact: MessageFactView): string {
  if (fact.reviewState === "CONFIRMED") return "Action evidence confirmed";
  if (fact.reviewState === "INCORRECT" && fact.reviewedValue) return "Action evidence corrected";
  if (fact.reviewState === "INCORRECT") return "Action evidence rejected";
  return fact.reviewState ?? "Action evidence";
}

function StatePill({ children }: { children: string }) {
  return <span className="rounded-sm border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-700">{children.replaceAll("_", " ")}</span>;
}

function FactActions({ messageId, fact }: { messageId: string; fact: MessageFactView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState(fact.reviewedValue ?? fact.value);
  const [numeric, setNumeric] = useState(fact.rawNumeric?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(state: "CONFIRMED" | "INCORRECT" | "SUPERSEDED") {
    setBusy(true);
    setError(null);
    try {
      const correctedNumeric = numeric.trim() ? Number(numeric) : null;
      const response = await fetch(`/api/messages/${messageId}/facts/${fact.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          correctedPayload: state === "INCORRECT" && display.trim() ? {
            display: display.trim(),
            numeric: correctedNumeric != null && Number.isFinite(correctedNumeric) ? correctedNumeric : null,
            unit: fact.rawUnit,
            negotiation: null,
          } : undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Fact review could not be saved");
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fact review could not be saved");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-3 border-t border-zinc-100 pt-3">
    <div className="flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => void submit("CONFIRMED")} className="rounded-sm border border-zinc-200 px-2 py-1 text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-50">Confirm</button>
      <button disabled={busy} onClick={() => setOpen((value) => !value)} className="rounded-sm border border-zinc-200 px-2 py-1 text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-50">Mark incorrect</button>
      <button disabled={busy} onClick={() => void submit("SUPERSEDED")} className="rounded-sm border border-zinc-200 px-2 py-1 text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-50">Supersede</button>
      {fact.reviewState && <StatePill>{fact.reviewState}</StatePill>}
    </div>
    {open && <div className="mt-3 grid gap-2 rounded-sm border border-amber-200 bg-amber-50 p-3 sm:grid-cols-[1fr_160px_auto]">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Corrected display<input value={display} onChange={(event) => setDisplay(event.target.value)} className="mt-1 w-full rounded-sm border border-amber-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900" /></label>
      <label className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Numeric value<input value={numeric} onChange={(event) => setNumeric(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-sm border border-amber-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900" /></label>
      <button disabled={busy || !display.trim()} onClick={() => void submit("INCORRECT")} className="self-end rounded-sm bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Save correction</button>
    </div>}
    {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
  </div>;
}

function AttachmentRow({ messageId, attachment }: { messageId: string; attachment: MessageSourceDto["attachments"][number] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promotable = !attachment.promotion && isPromotablePdfAttachment(attachment);

  async function promote() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/messages/${messageId}/attachments/${attachment.id}/promote`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Attachment could not be promoted");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Attachment could not be promoted");
    } finally {
      setBusy(false);
    }
  }

  return <li className="flex items-center justify-between gap-3 px-4 py-3 text-xs">
    <div>
      <p className="font-medium text-zinc-900">{attachment.filename}</p>
      <p className="text-zinc-500">{attachment.contentType} · {attachment.size.toLocaleString()} bytes</p>
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {attachment.promotion ? <>
        <StatePill>Promoted to document</StatePill>
        <span className="text-zinc-500">{attachment.promotion.ingestionStatus.replaceAll("_", " ")}</span>
        <Link className="font-medium underline" href={attachment.promotion.href}>Open document</Link>
      </> : <>
        <StatePill>Not analyzed</StatePill>
        {promotable && <button disabled={busy} onClick={() => void promote()} className="rounded-sm border border-zinc-300 px-2 py-1 text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-50">Promote to document</button>}
      </>}
    </div>
  </li>;
}

export function MessageSourceView({
  message,
  actionEvidence = [],
}: {
  message: MessageSourceDto;
  actionEvidence?: ActionEvidenceReviewItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakerSide, setSpeakerSide] = useState<"OUR_SIDE" | "COUNTERPARTY" | "UNKNOWN" | "">("");
  const canAnalyze = message.analysisState === "NOT_ANALYZED" || message.analysisState === "ANALYSIS_FAILED";
  const commercialFacts = message.facts.filter((fact) => !fact.hasAction);
  const reviewedActions = message.facts.filter((fact) => fact.hasAction && fact.reviewState);
  const actionPending = message.actionReviewState === "PENDING";
  const spans = message.facts.flatMap((fact) => fact.provenanceStatus === "EXACT" && fact.evidenceStartOffset != null && fact.evidenceEndOffset != null ? [{ start: fact.evidenceStartOffset, end: fact.evidenceEndOffset }] : []);
  const body = highlightSpans(message.bodyText, spans);
  const grouped = new Map<string, MessageSourceDto["participants"]>();
  for (const participant of message.participants.filter((item) => item.role !== "FROM")) grouped.set(participant.role, [...(grouped.get(participant.role) ?? []), participant]);

  async function action(url: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { method: "POST", headers: payload ? { "Content-Type": "application/json" } : undefined, body: payload ? JSON.stringify(payload) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Action failed");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-6">
    <header className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Source message · {message.sourceType}</p>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{message.subject || "Email"}</h1>
      <div className="flex flex-wrap items-center gap-2"><StatePill>{message.analysisState}</StatePill><StatePill>{messageReviewLabel(message.reviewState)}</StatePill>{message.actionReviewState !== "NOT_APPLICABLE" && <StatePill>{actionEvidenceReviewLabel(message.actionReviewState)}</StatePill>}<Link className="ml-2 text-xs font-medium text-zinc-900 underline" href={message.deal.href}>{message.deal.name}</Link><Link className="text-xs underline" href={message.activityHref}>Activity</Link><Link className="text-xs underline" href={message.negotiationHref}>Negotiation</Link></div>
      {canAnalyze && <fieldset className="rounded-sm border border-zinc-200 bg-white px-3 py-3">
        <legend className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Who is speaking?</legend>
        <p className="text-xs text-zinc-600">Choose Our side, Counterparty, or Unknown. DealWatch does not guess this from the sender address.</p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-800">
          {(["OUR_SIDE", "COUNTERPARTY", "UNKNOWN"] as const).map((choice) => <label key={choice} className="flex items-center gap-1.5"><input type="radio" name="speaker-side" value={choice} checked={speakerSide === choice} onChange={() => setSpeakerSide(choice)} />{speakerSideLabel(choice)}</label>)}
        </div>
      </fieldset>}
      {!canAnalyze && message.analysisState === "ANALYZED" && <p className="text-xs text-zinc-600">Speaker recorded at analysis: {speakerSideLabel(message.speakerSide)}. A later responsibility change is an action-evidence correction and leaves the extracted fact unchanged.</p>}
      <div className="flex flex-wrap gap-2">
        {canAnalyze && <button disabled={busy || speakerSide === ""} onClick={() => void action(`/api/messages/${message.id}/analyze`, { speakerSide })} className="rounded-sm bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{message.analysisState === "ANALYSIS_FAILED" ? "Retry analysis" : "Analyze"}</button>}
        {message.analysisState === "ANALYZED" && <><button disabled={busy} onClick={() => void action(`/api/messages/${message.id}/review`, { decision: "ACKNOWLEDGED" })} className="rounded-sm border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50">Acknowledge message</button><button disabled={busy} onClick={() => void action(`/api/messages/${message.id}/review`, { decision: "NEEDS_FOLLOW_UP" })} className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 disabled:opacity-50">Needs follow-up</button></>}
      </div>
      {message.analysisState === "ANALYZED" && <p className="text-xs text-zinc-600">Acknowledging the message records that the extraction was reviewed. It does not confirm action evidence.</p>}
      {message.reviewState === "REVIEWED" && actionPending && <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">Message reviewed. Action evidence is still pending, so follow-up is not resolved.</p>}
      {message.failureReason && <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">Analysis failed: {message.failureReason}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </header>

    <section className="rounded-sm border border-zinc-200 bg-white"><div className="border-b border-zinc-100 px-4 py-2.5"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Overview</h2></div><dl className="grid gap-3 px-4 py-4 text-xs sm:grid-cols-2">
      <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">From</dt><dd className="mt-0.5 text-zinc-800">{message.senderName || "—"}{message.senderAddress ? <span className="text-zinc-500"> · {message.senderAddress}</span> : null}</dd></div>
      <div><dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Sent</dt><dd className="mt-0.5 text-zinc-800">{utcDate(message.sentAt)}</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Received</dt><dd className="mt-0.5 text-zinc-800">{utcDate(message.receivedAt)}</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Imported</dt><dd className="mt-0.5 text-zinc-800">{utcDate(message.importedAt)}</dd></div>
      {[...grouped.entries()].map(([role, people]) => <div key={role}><dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{role}</dt><dd className="mt-0.5 text-zinc-800">{people.map((person) => person.displayName ? `${person.displayName} · ${person.address}` : person.address).join(", ")}</dd></div>)}
    </dl></section>

    <section className="rounded-sm border border-zinc-200 bg-white"><div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Message</h2>{message.originalSourceHref && <a href={message.originalSourceHref} className="text-[11px] font-medium underline">Download original .eml</a>}</div><div className="whitespace-pre-wrap px-4 py-4 text-sm leading-6 text-zinc-800">{body.map((part, index) => part.highlighted ? <mark key={index} className="bg-amber-100 text-zinc-950">{part.text}</mark> : <span key={index}>{part.text}</span>)}</div></section>

    <section className="space-y-3"><div><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Commercial facts</h2><p className="mt-1 text-xs text-zinc-600">Commercial facts found: {message.factSummary.total} · Negotiation facts: {message.factSummary.negotiation} · Other activity facts: {message.factSummary.other}</p><p className="mt-1 text-xs text-zinc-500">Action directives use the same decision as deal action-evidence review.</p></div>
      {message.analysisState === "NOT_ANALYZED" ? <p className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">Not analyzed. Import preserves the source but does not run extraction.</p> : commercialFacts.length === 0 ? <p className="text-sm text-zinc-600">No commercial facts were found.</p> : commercialFacts.map((fact) => <article key={fact.id} className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-zinc-950">{fact.label}</h3><span className="text-xs text-zinc-500">{fact.sideLabel}</span><StatePill>{fact.assertionLabel}</StatePill>{fact.reconciliation && <ReconciliationBadge links={[fact.reconciliation]} />}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{extractionSourceLabel(fact.extractionMethod)}</p><p className="text-sm text-zinc-900">{fact.value}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Reviewed value</p><p className="text-sm text-zinc-900">{fact.reviewedValue ?? "—"}</p></div><div><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Formal negotiation</p><p className="text-sm text-zinc-900">{fact.reconciliation?.currentPosition?.display ?? "No current position"}</p></div></div>
        <p className="mt-2 text-[11px] text-zinc-500">Evidence · {fact.provenanceStatus}</p><p className="text-xs text-zinc-700">“{fact.evidenceQuote}”</p>{fact.reviewedReconciliation && <p className="mt-2 text-[11px] text-zinc-600">Reviewed reconciliation: {fact.reviewedReconciliation.relationship.replaceAll("_", " ").toLowerCase()}</p>}<FactActions messageId={message.id} fact={fact} />
      </article>)}
    </section>

    {(actionEvidence.length > 0 || reviewedActions.length > 0) && <section className="space-y-3">
      <div><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Action evidence</h2><p className="mt-1 text-xs text-zinc-600">This is the same review used on the deal. Confirming, rejecting, or correcting here does not change the extracted fact.</p></div>
      {actionEvidence.length > 0 && <ActionEvidenceReview dealId={message.deal.id} items={actionEvidence} />}
      {reviewedActions.map((fact) => <article key={fact.id} className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-zinc-950">{fact.label}</h3>{fact.reviewState && <StatePill>{actionFactStatus(fact)}</StatePill>}</div>
        <p className="mt-2 text-xs text-zinc-700">“{fact.evidenceQuote}”</p>
        {fact.reviewedValue && <p className="mt-1 text-xs text-zinc-600">Reviewed presentation: {fact.reviewedValue}</p>}
      </article>)}
    </section>}

    <section className="rounded-sm border border-zinc-200 bg-white"><div className="border-b border-zinc-100 px-4 py-2.5"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Attachments</h2></div>{message.attachments.length === 0 ? <p className="px-4 py-4 text-sm text-zinc-500">No attachments.</p> : <ul className="divide-y divide-zinc-100">{message.attachments.map((attachment) => <AttachmentRow key={attachment.id} messageId={message.id} attachment={attachment} />)}</ul>}</section>
    <section className="rounded-sm border border-zinc-200 bg-white"><div className="border-b border-zinc-100 px-4 py-2.5"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Review history</h2></div>{message.reviewHistory.length === 0 ? <p className="px-4 py-4 text-sm text-zinc-500">No analysis or review actions yet.</p> : <ol className="divide-y divide-zinc-100">{message.reviewHistory.map((event) => <li key={event.id} className="flex items-center justify-between px-4 py-3 text-xs"><span className="font-medium text-zinc-800">{event.type.replaceAll("_", " ")}</span><span className="text-zinc-400">{event.actor.replaceAll("_", " ")} · {utcDate(event.createdAt)}</span></li>)}</ol>}</section>
  </div>;
}
