"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import type { DocumentReviewModel, NegotiationConflictView, NegotiationFinding, ReviewPageText } from "@/lib/inbox/types";

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; missing?: Array<{ label: string }> };
  if (!response.ok) {
    const missing = payload.missing?.map((item) => item.label).join(", ");
    throw new Error(missing ? `${payload.error ?? "Request failed"}: ${missing}` : payload.error ?? "Request failed");
  }
  return payload;
}

export function MetadataEditor({
  documentId,
  documentType,
  negotiationSide,
  documentDate,
  originalFilename,
  locked,
}: {
  documentId: string;
  documentType: string;
  negotiationSide: string | null;
  documentDate: string | null;
  originalFilename: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState(documentType);
  const [side, setSide] = useState(negotiationSide ?? "");
  const [date, setDate] = useState(documentDate?.slice(0, 10) ?? "");
  const [filename, setFilename] = useState(originalFilename);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: type,
          originalFilename: filename,
          ...(locked ? {} : { negotiationSide: side || undefined, documentDate: date || undefined }),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Metadata could not be saved.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Metadata could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="grid gap-3 rounded-sm border border-zinc-200 bg-white px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Metadata</h2>
      <label className="grid gap-1 text-[11px] text-zinc-500">
        Display filename
        <input value={filename} onChange={(event) => setFilename(event.target.value)} className="h-8 rounded-sm border border-zinc-200 px-2 text-xs text-zinc-900" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-[11px] text-zinc-500">
          Document type
          <select value={type} onChange={(event) => setType(event.target.value)} className="h-8 rounded-sm border border-zinc-200 px-2 text-xs text-zinc-900">
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] text-zinc-500">
          Authoring side
          <select value={side} onChange={(event) => setSide(event.target.value)} disabled={locked} className="h-8 rounded-sm border border-zinc-200 px-2 text-xs text-zinc-900 disabled:bg-zinc-50">
            <option value="">Not set</option>
            <option value="TENANT">Tenant</option>
            <option value="LANDLORD">Landlord</option>
          </select>
        </label>
        <label className="grid gap-1 text-[11px] text-zinc-500">
          Document date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={locked} className="h-8 rounded-sm border border-zinc-200 px-2 text-xs text-zinc-900 disabled:bg-zinc-50" />
        </label>
      </div>
      {locked && <p className="text-[11px] text-zinc-500">Side and date stay with the analyzed round.</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="h-8 rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white disabled:opacity-50">
          {pending ? "Saving" : "Save metadata"}
        </button>
        {error && <p className="text-[11px] text-red-700">{error}</p>}
      </div>
    </form>
  );
}

export function AnalyzeDocumentButton({ documentId, ready }: { documentId: string; ready: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/documents/${documentId}`, {});
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={analyze} disabled={!ready || pending} className="h-8 rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white disabled:opacity-50">
        {pending ? "Analyzing" : "Analyze document"}
      </button>
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}

export function ReviewDecisionButtons({
  documentId,
  target,
  reviewState,
}: {
  documentId: string;
  target: Record<string, string>;
  reviewState: "PENDING" | "ACKNOWLEDGED" | "NEEDS_FOLLOW_UP";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "ACKNOWLEDGE" | "NEEDS_FOLLOW_UP" | "CLEAR") {
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/documents/${documentId}/reviews`, { action, ...target });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Review · {labelState(reviewState)}</span>
      <button type="button" disabled={pending} onClick={() => act("ACKNOWLEDGE")} className="h-7 rounded-sm border border-zinc-300 px-2 text-[11px] text-zinc-800 disabled:opacity-50">Acknowledge</button>
      <button type="button" disabled={pending} onClick={() => act("NEEDS_FOLLOW_UP")} className="h-7 rounded-sm border border-zinc-300 px-2 text-[11px] text-zinc-800 disabled:opacity-50">Needs follow-up</button>
      {reviewState !== "PENDING" && (
        <button type="button" disabled={pending} onClick={() => act("CLEAR")} className="h-7 rounded-sm px-2 text-[11px] text-zinc-500 disabled:opacity-50">Clear</button>
      )}
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}

export function FormalTermReviewControls({
  documentId,
  finding,
}: {
  documentId: string;
  finding: NegotiationFinding;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [rawValue, setRawValue] = useState("");
  const [normalizedValue, setNormalizedValue] = useState("");
  const [normalizedNumeric, setNormalizedNumeric] = useState("");
  const [normalizedUnit, setNormalizedUnit] = useState("");
  const [structuredText, setStructuredText] = useState("");
  const [note, setNote] = useState("");

  async function submit(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/documents/${documentId}/formal-review`, {
        negotiationTermId: finding.termId,
        note: note.trim() || null,
        ...body,
      });
      setOpen(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Formal review could not be saved.");
    } finally {
      setPending(false);
    }
  }

  function correct() {
    if (finding.formalCorrectionMode === "BASE_RENT_SIMPLE") {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError("Enter a positive base rent amount.");
        return;
      }
      void submit({ action: "CORRECT", amountPerRSFYear: parsed, rawValue: rawValue.trim() || null });
      return;
    }
    if (finding.formalCorrectionMode === "LEGACY") {
      const numeric = normalizedNumeric.trim() === "" ? null : Number(normalizedNumeric);
      if (numeric != null && !Number.isFinite(numeric)) {
        setError("The corrected number is not finite.");
        return;
      }
      void submit({
        action: "CORRECT",
        rawValue: rawValue.trim() || null,
        normalizedValue: normalizedValue.trim() || null,
        normalizedNumeric: numeric,
        normalizedUnit: normalizedUnit.trim() || null,
      });
      return;
    }
    let structuredPayload: unknown;
    try {
      structuredPayload = JSON.parse(structuredText);
    } catch {
      setError("The replacement structured value must be JSON.");
      return;
    }
    void submit({ action: "CORRECT", structuredPayload, rawValue: rawValue.trim() || null });
  }

  const stateLabel = finding.formalReviewState === "UNREVIEWED"
    ? "Unreviewed extraction"
    : finding.formalReviewState === "ACCEPTED"
      ? "Accepted extraction"
      : finding.formalReviewState === "CORRECTED"
        ? "Reviewed correction"
        : "Rejected extraction";

  return (
    <div className="mt-3 rounded-sm border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Formal value · {stateLabel}</p>
      <p className="mt-1 text-xs text-zinc-800">Extracted value {finding.formalExtractedSummary}</p>
      <p className="mt-1 text-[11px] text-zinc-500">Formal value decisions control negotiation truth. The finding review decision below controls whether this review item remains open.</p>
      {finding.formalReviewState === "CORRECTED" && finding.formalEffectiveSummary && (
        <p className="mt-1 text-xs text-zinc-800">
          Current formal value {finding.formalEffectiveSummary}
          <span className="text-zinc-500"> · {finding.formalExtractedSummary} → {finding.formalEffectiveSummary}</span>
        </p>
      )}
      {finding.formalReviewState === "REJECTED" && (
        <p className="mt-1 text-xs text-red-800">This extraction is excluded from the formal position.</p>
      )}
      {finding.formalReviewNote && <p className="mt-1 text-[11px] text-zinc-600">Note: {finding.formalReviewNote}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => void submit({ action: "ACCEPT" })} className="h-7 rounded-sm border border-zinc-300 bg-white px-2 text-[11px] text-zinc-800 disabled:opacity-50">Accept value</button>
        <button type="button" disabled={pending} onClick={() => setOpen((value) => !value)} className="h-7 rounded-sm border border-zinc-300 bg-white px-2 text-[11px] text-zinc-800 disabled:opacity-50">Correct value</button>
        <button type="button" disabled={pending} onClick={() => void submit({ action: "REJECT" })} className="h-7 rounded-sm border border-zinc-300 bg-white px-2 text-[11px] text-zinc-800 disabled:opacity-50">Reject extraction</button>
      </div>
      {open && (
        <div className="mt-2 grid gap-2">
          {finding.formalCorrectionMode === "BASE_RENT_SIMPLE" && (
            <label className="grid gap-1 text-[11px] text-zinc-500">
              Corrected base rent ($ / RSF / year)
              <input value={amount} onChange={(event) => setAmount(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs text-zinc-900" />
            </label>
          )}
          {finding.formalCorrectionMode === "LEGACY" && (
            <>
              <label className="grid gap-1 text-[11px] text-zinc-500">Corrected display value<input value={normalizedValue} onChange={(event) => setNormalizedValue(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-[11px] text-zinc-500">Number<input value={normalizedNumeric} onChange={(event) => setNormalizedNumeric(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs" /></label>
                <label className="grid gap-1 text-[11px] text-zinc-500">Unit<input value={normalizedUnit} onChange={(event) => setNormalizedUnit(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs" /></label>
              </div>
            </>
          )}
          {finding.formalCorrectionMode === "STRUCTURED" && (
            <label className="grid gap-1 text-[11px] text-zinc-500">
              Replacement structured value
              <textarea value={structuredText} onChange={(event) => setStructuredText(event.target.value)} className="min-h-20 rounded-sm border border-zinc-200 bg-white px-2 py-1 text-xs" />
            </label>
          )}
          <label className="grid gap-1 text-[11px] text-zinc-500">
            Reviewed text
            <input value={rawValue} onChange={(event) => setRawValue(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs" />
          </label>
          <label className="grid gap-1 text-[11px] text-zinc-500">
            Note
            <input value={note} onChange={(event) => setNote(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs" />
          </label>
          <button type="button" disabled={pending} onClick={correct} className="h-7 w-fit rounded-sm bg-zinc-900 px-2 text-[11px] text-white disabled:opacity-50">Save correction</button>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}

export function EvidenceCorrectionForm({
  documentId,
  termId,
  pages,
  onClose,
}: {
  documentId: string;
  termId: string;
  pages: ReviewPageText[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pageId, setPageId] = useState(pages[0]?.id ?? "");
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("0");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = pages.find((item) => item.id === pageId) ?? null;
  const startOffset = Number(start);
  const endOffset = Number(end);
  const preview = page && Number.isInteger(startOffset) && Number.isInteger(endOffset) && startOffset >= 0 && endOffset <= page.text.length && startOffset < endOffset
    ? page.text.slice(startOffset, endOffset)
    : "";

  async function save() {
    if (!page || !preview) return;
    setPending(true);
    setError(null);
    try {
      await postJson(`/api/documents/${documentId}/evidence`, {
        negotiationTermId: termId,
        documentPageId: page.id,
        startOffset,
        endOffset,
        evidenceQuote: preview,
      });
      onClose();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evidence could not be corrected.");
    } finally {
      setPending(false);
    }
  }

  if (pages.length === 0) return <p className="mt-2 text-[11px] text-zinc-500">This document has no extracted page text.</p>;
  return (
    <div className="mt-2 rounded-sm border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-[11px] text-zinc-600">Select a range in the extracted page text. The quote must match that range exactly.</p>
      <label className="mt-2 grid gap-1 text-[11px] text-zinc-500">
        Page
        <select value={pageId} onChange={(event) => setPageId(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs text-zinc-900">
          {pages.map((item) => (
            <option key={item.id} value={item.id}>Page {item.pageNumber}</option>
          ))}
        </select>
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px] text-zinc-500">Start offset<input value={start} onChange={(event) => setStart(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs" /></label>
        <label className="grid gap-1 text-[11px] text-zinc-500">End offset<input value={end} onChange={(event) => setEnd(event.target.value)} className="h-8 rounded-sm border border-zinc-200 bg-white px-2 text-xs" /></label>
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-white p-2 text-[11px] text-zinc-700">{page?.text}</pre>
      <p className="mt-2 text-[11px] text-zinc-800">Selected: {preview || "No valid range"}</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={pending || !preview} onClick={save} className="h-7 rounded-sm bg-zinc-900 px-2 text-[11px] text-white disabled:opacity-50">Save correction</button>
        <button type="button" onClick={onClose} className="h-7 px-2 text-[11px] text-zinc-500">Cancel</button>
        {error && <p className="text-[11px] text-red-700">{error}</p>}
      </div>
    </div>
  );
}

export function EvidenceLocateButton({
  documentId,
  termId,
  pages,
  label,
}: {
  documentId: string;
  termId: string;
  pages: ReviewPageText[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] underline">{label}</button>
      {open && <EvidenceCorrectionForm documentId={documentId} termId={termId} pages={pages} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function SourceReplacementForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/documents/${documentId}/source`, { method: "POST", body });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The source file could not be stored.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The source file could not be stored.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Development source repair</h2>
      <p className="mt-1 text-xs text-zinc-600">
        Store a real PDF on this document when the file hash matches. A different file is refused when extracted evidence is already bound to the page text.
      </p>
      <input
        type="file"
        accept="application/pdf,.pdf"
        disabled={pending}
        className="mt-2 text-xs"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
    </form>
  );
}

export function DemoResetButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!window.confirm("Remove this document and its dependent review data? Shared canonical records are kept.")) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const payload = await postJson(`/api/documents/${documentId}/demo-reset`, {});
      const report = payload as { removed?: boolean; retained?: Array<{ kind: string; reason: string }> };
      const retained = report.retained?.map((row) => `${row.kind}: ${row.reason}`).join(" ") ?? "";
      setMessage(report.removed ? `Document removed. ${retained}`.trim() : `Document was not removed. ${retained}`.trim());
      if (report.removed) router.push("/inbox");
      else router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The document could not be removed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Development demo reset</h2>
      <p className="mt-1 text-xs text-zinc-600">
        Removes this document and review data that exists only for it. Shared canonical entities and assertions are kept and reported.
      </p>
      <button
        type="button"
        className="mt-2 h-8 rounded-sm border border-zinc-300 px-3 text-xs font-medium text-zinc-800 disabled:opacity-50"
        disabled={pending}
        onClick={() => void reset()}
      >
        Remove this document
      </button>
      {message && <p className="mt-2 text-[11px] text-zinc-600">{message}</p>}
      {error && <p className="mt-2 text-[11px] text-red-700">{error}</p>}
    </section>
  );
}

export function findingReviewTarget(finding: NegotiationFinding): Record<string, string> {
  return { kind: "NEGOTIATION_TERM", negotiationTermId: finding.termId };
}

export function conflictReviewTarget(conflict: NegotiationConflictView): Record<string, string> {
  return { kind: "NEGOTIATION_CONFLICT", canonicalType: conflict.canonicalType };
}

function labelState(state: string): string {
  if (state === "ACKNOWLEDGED") return "Acknowledged";
  if (state === "NEEDS_FOLLOW_UP") return "Needs follow-up";
  return "Pending";
}

export type ReviewModel = DocumentReviewModel;
