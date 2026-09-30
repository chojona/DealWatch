"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";

type Phase =
  | "Uploading PDF"
  | "Extracting text"
  | "Analyzing document"
  | "Analysis complete"
  | "Analysis failed"
  | "Preparation failed"
  | "Processing failed";

interface DocumentResponse {
  document?: {
    id: string;
    originalFilename: string;
    documentType: string;
    documentDate: string | null;
    pageCount: number | null;
    termCount: number;
    ingestionStatus: string;
    failureReason: string | null;
  };
  error?: string;
}

export function UploadNegotiationDocument({
  dealId,
  surface = "negotiation",
}: {
  dealId: string;
  surface?: "negotiation" | "documents";
}) {
  const router = useRouter();
  const submitting = useRef(false);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<DocumentResponse["document"] | null>(
    null
  );
  const busy = phase === "Uploading PDF" || phase === "Extracting text" || phase === "Analyzing document";
  const documentsSurface = surface === "documents";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || busy) return;
    submitting.current = true;
    setError(null);
    setSummary(null);
    const form = event.currentTarget;
    const body = new FormData(form);
    body.set("phase", "extract");
    setPhase("Uploading PDF");
    await new Promise((resolve) => setTimeout(resolve, 40));
    setPhase("Extracting text");

    try {
      const upload = await fetch(`/api/deals/${dealId}/documents`, {
        method: "POST",
        body,
      });
      const uploaded = (await upload.json().catch(() => ({}))) as DocumentResponse;
      if (!uploaded.document) {
        throw new Error(uploaded.error ?? "Upload failed");
      }
      if (uploaded.document.ingestionStatus === "FAILED") {
        setPhase("Preparation failed");
        setError(uploaded.document.failureReason ?? uploaded.error ?? "Extraction failed");
        setSummary(uploaded.document);
        router.refresh();
        return;
      }

      setPhase("Analyzing document");
      const analysis = await fetch(`/api/documents/${uploaded.document.id}`, {
        method: "POST",
      });
      const analyzed = (await analysis.json().catch(() => ({}))) as DocumentResponse;
      const document = analyzed.document ?? uploaded.document;
      if (document.ingestionStatus === "FAILED") {
        setPhase("Analysis failed");
        setError(document.failureReason ?? analyzed.error ?? "Analysis failed");
      } else if (!analysis.ok) {
        setPhase("Analysis failed");
        setError(analyzed.error ?? "Analysis failed");
      } else {
        setPhase("Analysis complete");
      }
      setSummary(document);
      router.refresh();
    } catch (cause) {
      setPhase("Processing failed");
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <div className={documentsSurface ? "rounded-sm border border-zinc-200 bg-white p-4" : "rounded-md border border-line bg-surface px-4 py-3"}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={documentsSurface ? "text-xs font-semibold uppercase tracking-wider text-zinc-400" : "text-[13px] font-semibold leading-[18px] text-ink"}>
            {documentsSurface ? "Upload PDF" : "Upload a negotiation PDF"}
          </h2>
          <p className={documentsSurface ? "mt-1 text-xs text-zinc-500" : "mt-0.5 text-xs leading-4 text-ink-secondary"}>
            {documentsSurface
              ? "Add a source PDF to this deal. Upload, extraction, and analysis use the existing document pipeline."
              : "Upload one text-based negotiation PDF. The deal is the one open on this page."}
          </p>
        </div>
        {!open && (
          <Button type="button" onClick={() => setOpen(true)}>
            <FileUp className="h-3.5 w-3.5" /> {documentsSurface ? "Upload PDF" : "Upload negotiation document"}
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-[11px] font-medium text-zinc-600 sm:col-span-2">
              PDF
              <input
                required
                name="file"
                type="file"
                accept="application/pdf,.pdf"
                className="mt-1 block w-full text-xs"
              />
            </label>
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
              Document date
              <input
                required
                name="documentDate"
                type="date"
                className="mt-1 h-8 w-full rounded-sm border border-zinc-200 px-2 text-xs"
              />
            </label>
          </div>
          <label className="block text-[11px] font-medium text-zinc-600">
            Document type
            <select
              name="documentType"
              className="mt-1 h-8 w-full max-w-xs rounded-sm border border-zinc-200 bg-white px-2 text-xs"
            >
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {phase && (
            <p className="text-xs font-medium text-zinc-700">
              {busy ? (
                <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
              ) : null}
              {phase}
            </p>
          )}
          {error && (
            <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
          {summary && phase === "Analysis complete" && (
            <p className="text-xs text-zinc-600">
              {documentsSurface ? "Source added. " : null}
              {summary.originalFilename}
              {" · "}
              {DOCUMENT_TYPE_LABELS[summary.documentType] ?? summary.documentType}
              {" · "}
              {summary.documentDate
                ? new Date(summary.documentDate).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })
                : "No date"}
              {" · "}
              {summary.pageCount ?? 0} pages
              {" · "}
              {summary.termCount} extracted terms
              {" · "}
              <a href={documentsSurface ? `/documents/${summary.id}/review` : "#term-history"} className="underline">
                {documentsSurface ? "Review document" : "Current positions"}
              </a>
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Close
            </Button>
            <Button
              disabled={busy}
              type="submit"
            >
              {busy
                ? phase
                : "Upload and analyze"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
