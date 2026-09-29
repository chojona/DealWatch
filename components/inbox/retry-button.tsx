"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryAnalysisButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok && response.status !== 422) {
        throw new Error(body.error ?? "Retry failed");
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Retry failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={retry}
        disabled={pending}
        className="h-8 rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Retrying analysis" : "Retry analysis"}
      </button>
      {error && <p className="text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
