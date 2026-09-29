"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionEvidenceReviewItem } from "@/lib/deals/actions/evidenceReviewView";

export interface ActionEvidenceSubmission {
  sourceMessageId: string;
  activityFactId: string;
  decision: "confirm" | "reject" | "correct";
  correction?: {
    kind?: ActionEvidenceReviewItem["kindValue"];
    responsibleSide?: ActionEvidenceReviewItem["responsibleSideValue"];
    discardNormalizedInstant?: boolean;
    fulfillsFactId?: string | null;
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="text-zinc-800">{children}</dd>
    </div>
  );
}

function EvidenceCard({
  item,
  pending,
  onSubmit,
}: {
  item: ActionEvidenceReviewItem;
  pending: boolean;
  onSubmit: (submission: ActionEvidenceSubmission) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string>("");
  const [kind, setKind] = useState(item.kindValue);
  const [side, setSide] = useState(item.responsibleSideValue);
  const [discardInstant, setDiscardInstant] = useState(false);
  const [correctTarget, setCorrectTarget] = useState(false);
  const fulfillment = item.kindValue === "FULFILLMENT";

  async function send(submission: ActionEvidenceSubmission) {
    if (pending) return;
    setError(null);
    setStatus(null);
    try {
      await onSubmit(submission);
      setStatus("Saved. Follow-up will refresh from reviewed evidence.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review could not be saved");
    }
  }

  function confirm() {
    if (item.requiresTargetChoice) {
      if (!targetId) {
        setError("Select the request this fulfills, or none.");
        return;
      }
      void send({
        sourceMessageId: item.messageId,
        activityFactId: item.factId,
        decision: "correct",
        correction: { fulfillsFactId: targetId === "none" ? null : targetId },
      });
      return;
    }
    void send({
      sourceMessageId: item.messageId,
      activityFactId: item.factId,
      decision: "confirm",
    });
  }

  function saveCorrection() {
    const correction: ActionEvidenceSubmission["correction"] = {};
    if (!fulfillment) {
      if (kind !== item.kindValue) correction.kind = kind;
      if (side !== item.responsibleSideValue) correction.responsibleSide = side;
      if (discardInstant) correction.discardNormalizedInstant = true;
    }
    if (fulfillment && correctTarget) {
      if (!targetId) {
        setError("Select the request this fulfills, or none.");
        return;
      }
      correction.fulfillsFactId = targetId === "none" ? null : targetId;
    }
    if (!correction.kind && !correction.responsibleSide && !correction.discardNormalizedInstant && correction.fulfillsFactId === undefined) {
      setError("Change a supported field before saving a correction.");
      return;
    }
    void send({
      sourceMessageId: item.messageId,
      activityFactId: item.factId,
      decision: "correct",
      correction,
    });
  }

  const dueValue = item.dueAtLabel ?? item.occursAtLabel ?? item.dueText;
  const dueLabel = item.occursAtLabel && !item.dueAtLabel ? "When" : "Due";

  return (
    <article className="border-t border-zinc-100 py-4 first:border-t-0 first:pt-0" aria-busy={pending}>
      <p className="text-[13px] text-ink-muted">{item.headline}</p>
      <h3 className="mt-1 text-sm font-semibold text-zinc-900">{item.title}</h3>
      <p className="mt-1 text-[11px] leading-4 text-zinc-500">
        DealWatch read this from a message and is asking you to review it before it affects follow-up.
      </p>
      <dl className="mt-3 space-y-1.5">
        <Field label="Type">{item.kindLabel}</Field>
        {!fulfillment ? <Field label="Responsible">{item.responsibleSideLabel}</Field> : null}
        {dueValue ? (
          <Field label={dueLabel}>
            <span>{item.dueAtLabel ?? item.occursAtLabel ?? item.dueText}</span>
            {(item.dueAtLabel || item.occursAtLabel) && item.dueText ? (
              <span className="mt-0.5 block text-[11px] text-zinc-500">Source wording: {item.dueText}</span>
            ) : null}
          </Field>
        ) : null}
        <Field label="Source">
          <blockquote className="border-l-2 border-zinc-200 pl-2 text-zinc-800">“{item.evidenceQuote}”</blockquote>
          <p className="mt-1 text-[11px] text-zinc-500">
            {item.sourceTimestampLabel}
            {item.senderLabel ? ` · ${item.senderLabel}` : ""}
          </p>
        </Field>
      </dl>
      {fulfillment ? (
        <div className="mt-3 rounded-sm border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700">
          <p className="font-medium text-zinc-900">Later message</p>
          <blockquote className="mt-1 border-l-2 border-zinc-200 pl-2">“{item.evidenceQuote}”</blockquote>
          {item.sentLabel ? <p className="mt-1 text-[11px] text-zinc-500">Sent {item.sentLabel}</p> : null}
          {item.linkedRequest ? (
            <div className="mt-3">
              <p className="font-medium text-zinc-900">Appears to fulfill</p>
              <blockquote className="mt-1 border-l-2 border-zinc-200 pl-2">“{item.linkedRequest.evidenceQuote}”</blockquote>
              <p className="mt-1 text-[11px] text-zinc-500">
                Requested {item.linkedRequest.whenLabel}
                {item.linkedRequest.senderLabel ? ` · ${item.linkedRequest.senderLabel}` : ""}
              </p>
              <a className="mt-1 inline-block text-[11px] font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2" href={item.linkedRequest.href}>View request</a>
              <p className="mt-2 text-[11px] leading-4 text-zinc-500">Confirming records that this later message fulfills that earlier request.</p>
            </div>
          ) : (
            <p className="mt-3 text-[11px] leading-4 text-zinc-600">DealWatch could not safely determine which request this fulfills.</p>
          )}
        </div>
      ) : null}
      {item.requiresTargetChoice ? (
        <fieldset className="mt-3 space-y-2" disabled={pending}>
          <legend className="text-xs font-medium text-zinc-900">Which request does this fulfill?</legend>
          {item.choices.map((choice) => (
            <label key={choice.factId} className="flex items-start gap-2 text-xs text-zinc-800">
              <input
                type="radio"
                name={`fulfillment-${item.factId}`}
                value={choice.factId}
                checked={targetId === choice.factId}
                onChange={() => setTargetId(choice.factId)}
              />
              <span>
                <span className="block">“{choice.evidenceQuote}”</span>
                <span className="text-[11px] text-zinc-500">
                  {choice.whenLabel}
                  {choice.senderLabel ? ` · ${choice.senderLabel}` : ""}
                </span>
              </span>
            </label>
          ))}
          <label className="flex items-start gap-2 text-xs text-zinc-800">
            <input
              type="radio"
              name={`fulfillment-${item.factId}`}
              value="none"
              checked={targetId === "none"}
              onChange={() => setTargetId("none")}
            />
            <span>None / cannot determine</span>
          </label>
        </fieldset>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a className="text-[11px] font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2" href={item.href}>View message</a>
        {fulfillment && item.linkedRequest ? <a className="text-[11px] font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2" href={item.linkedRequest.href}>View request</a> : null}
      </div>
      {item.canCorrectInterpretation ? (
        <details className="mt-3 rounded-sm border border-zinc-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-zinc-800">Correct interpretation</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Type
              <select
                value={item.kindOptions.find((option) => option.value === kind)?.label ?? item.kindLabel}
                disabled={pending}
                onChange={(event) => {
                  const selected = item.kindOptions.find((option) => option.label === event.target.value);
                  if (selected) setKind(selected.value);
                }}
                className="mt-1 w-full rounded-sm border border-zinc-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900"
              >
                {item.kindOptions.map((option) => (
                  <option key={option.label} value={option.label}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Responsible
              <select
                value={item.sideOptions.find((option) => option.value === side)?.label ?? item.responsibleSideLabel}
                disabled={pending}
                onChange={(event) => {
                  const selected = item.sideOptions.find((option) => option.label === event.target.value);
                  if (selected) setSide(selected.value);
                }}
                className="mt-1 w-full rounded-sm border border-zinc-200 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900"
              >
                {item.sideOptions.map((option) => (
                  <option key={option.label} value={option.label}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {item.canDiscardNormalizedInstant ? (
            <label className="mt-3 flex items-start gap-2 text-xs text-zinc-700">
              <input type="checkbox" checked={discardInstant} disabled={pending} onChange={(event) => setDiscardInstant(event.target.checked)} />
              <span>The calendar time is not reliable. Keep only the original wording.</span>
            </label>
          ) : (
            <p className="mt-3 text-[11px] leading-4 text-zinc-500">Unresolved timing stays as written. DealWatch will not invent a date.</p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={saveCorrection}
            className="mt-3 rounded-sm border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            Save correction
          </button>
        </details>
      ) : null}
      {fulfillment && item.linkedRequest && item.choices.length > 0 ? (
        <details className="mt-3 rounded-sm border border-zinc-200 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-zinc-800">Choose a different request</summary>
          <fieldset className="mt-3 space-y-2" disabled={pending}>
            <legend className="sr-only">Eligible requests</legend>
            {item.choices.map((choice) => (
              <label key={choice.factId} className="flex items-start gap-2 text-xs text-zinc-800">
                <input
                  type="radio"
                  name={`retarget-${item.factId}`}
                  value={choice.factId}
                  checked={correctTarget && targetId === choice.factId}
                  onChange={() => {
                    setCorrectTarget(true);
                    setTargetId(choice.factId);
                  }}
                />
                <span>“{choice.evidenceQuote}”</span>
              </label>
            ))}
            <label className="flex items-start gap-2 text-xs text-zinc-800">
              <input
                type="radio"
                name={`retarget-${item.factId}`}
                value="none"
                checked={correctTarget && targetId === "none"}
                onChange={() => {
                  setCorrectTarget(true);
                  setTargetId("none");
                }}
              />
              <span>None / cannot determine</span>
            </label>
          </fieldset>
          <button
            type="button"
            disabled={pending}
            onClick={saveCorrection}
            className="mt-3 rounded-sm border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          >
            Save correction
          </button>
        </details>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => void send({ sourceMessageId: item.messageId, activityFactId: item.factId, decision: "reject" })}
          className="rounded-sm border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={pending || (item.requiresTargetChoice && targetId === "")}
          onClick={confirm}
          className="rounded-sm bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Confirm"}
        </button>
      </div>
      {status ? <p role="status" className="mt-2 text-xs text-emerald-800">{status}</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </article>
  );
}

export function ActionEvidenceReviewList({
  items,
  submit,
  headingLevel = "h2",
}: {
  items: ActionEvidenceReviewItem[];
  submit: (submission: ActionEvidenceSubmission) => Promise<void>;
  headingLevel?: "h2" | "h3";
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const lock = useRef(false);

  async function onSubmit(submission: ActionEvidenceSubmission) {
    if (lock.current) throw new Error("This review is already being saved");
    lock.current = true;
    setPendingId(submission.activityFactId);
    try {
      await submit(submission);
    } finally {
      lock.current = false;
      setPendingId(null);
    }
  }

  return (
    <section aria-labelledby="action-evidence-review-heading">
      <header className="mb-3">
        {headingLevel === "h3" ? (
          <h3 id="action-evidence-review-heading" className="text-[15px] font-semibold text-ink">Action evidence</h3>
        ) : (
          <h2 id="action-evidence-review-heading" className="text-[15px] font-semibold text-ink">Action evidence</h2>
        )}
        <p className="mt-1 text-[13px] leading-5 text-ink-secondary">Review a message before it affects follow-up.</p>
      </header>
      <div>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-600">No action evidence needs review.</p>
        ) : (
          <div>
            {items.map((item) => (
              <EvidenceCard key={item.factId} item={item} pending={pendingId === item.factId} onSubmit={onSubmit} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function ActionEvidenceReview({
  dealId,
  items,
  headingLevel = "h2",
}: {
  dealId: string;
  items: ActionEvidenceReviewItem[];
  headingLevel?: "h2" | "h3";
}) {
  const router = useRouter();

  return (
    <ActionEvidenceReviewList
      items={items}
      headingLevel={headingLevel}
      submit={async (submission) => {
        const response = await fetch(`/api/deals/${dealId}/actions/evidence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof result.error === "string" ? result.error : "Review could not be saved");
        }
        router.refresh();
      }}
    />
  );
}
