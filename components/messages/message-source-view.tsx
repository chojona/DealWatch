import Link from "next/link";
import { highlightSpans } from "@/lib/ai/activity/evidence";
import { ReconciliationBadge } from "@/components/deals/reconciliation-context";
import type { MessageSourceView } from "@/lib/messages/service";

function utcDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
}

export function MessageSourceView({ message }: { message: MessageSourceView }) {
  const spans = message.facts.flatMap((fact) =>
    fact.provenanceStatus === "EXACT" && fact.evidenceStartOffset != null && fact.evidenceEndOffset != null
      ? [{ start: fact.evidenceStartOffset, end: fact.evidenceEndOffset }]
      : []
  );
  const body = highlightSpans(message.bodyText, spans);
  const grouped = new Map<string, MessageSourceView["participants"]>();
  for (const participant of message.participants.filter((item) => item.role !== "FROM")) {
    const group = grouped.get(participant.role) ?? [];
    group.push(participant);
    grouped.set(participant.role, group);
  }
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Source message · {message.sourceType}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{message.subject || "Email"}</h1>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-600">
          <Link className="font-medium text-zinc-900 underline" href={message.deal.href}>{message.deal.name}</Link>
          <Link className="underline" href={message.activityHref}>Activity</Link>
          <Link className="underline" href={message.negotiationHref}>Negotiation</Link>
        </div>
      </header>
      <section className="rounded-sm border border-zinc-200 bg-white">
        <dl className="grid gap-3 border-b border-zinc-100 px-4 py-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">From</dt>
            <dd className="mt-0.5 text-zinc-800">{message.senderName || "—"}{message.senderAddress ? <span className="text-zinc-500"> · {message.senderAddress}</span> : null}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Sent</dt>
            <dd className="mt-0.5 text-zinc-800">{utcDate(message.sentAt)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Received</dt>
            <dd className="mt-0.5 text-zinc-800">{utcDate(message.receivedAt)}</dd>
          </div>
          {[...grouped.entries()].map(([role, people]) => (
            <div key={role}>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{role}</dt>
              <dd className="mt-0.5 text-zinc-800">
                {people.map((person) => person.displayName ? `${person.displayName} · ${person.address}` : person.address).join(", ")}
              </dd>
            </div>
          ))}
        </dl>
        <div className="whitespace-pre-wrap px-4 py-4 text-sm leading-6 text-zinc-800">
          {body.map((part, index) => part.highlighted
            ? <mark key={index} className="bg-amber-100 text-zinc-950">{part.text}</mark>
            : <span key={index}>{part.text}</span>)}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Activity facts</h2>
        {message.facts.length === 0 ? (
          <p className="text-sm text-zinc-600">No structured activity facts have been extracted from this message.</p>
        ) : message.facts.map((fact) => (
          <article key={fact.id} className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-950">{fact.label}</h3>
              <span className="text-xs text-zinc-500">{fact.sideLabel}</span>
              <span className="rounded-sm border border-zinc-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">{fact.assertionLabel}</span>
              {fact.reconciliation && <ReconciliationBadge links={[fact.reconciliation]} />}
            </div>
            <p className="mt-1 text-sm text-zinc-900">{fact.value}</p>
            <p className="mt-2 text-[11px] text-zinc-500">Evidence · {fact.provenanceStatus}</p>
            <p className="text-xs text-zinc-700">“{fact.evidenceQuote}”</p>
            {fact.reconciliation?.currentPosition && (
              <p className="mt-2 text-[11px] text-zinc-600">
                Current {fact.reconciliation.currentPosition.side === "LANDLORD" ? "landlord" : "tenant"} position: {fact.reconciliation.currentPosition.display}
              </p>
            )}
            <Link className="mt-2 inline-block text-[11px] font-medium text-zinc-800 underline" href={message.negotiationHref}>View negotiation</Link>
          </article>
        ))}
      </section>
    </div>
  );
}
