import { Nav } from "@/components/nav";
import { ThreadAnalyzer } from "@/components/analyze/thread-analyzer";

export default function AnalyzePage() {
  return (
    <div className="min-h-screen">
      <Nav active="/analyze" />

      <main className="mx-auto max-w-4xl px-6 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-zinc-900">
            Analyze Thread
          </h1>
          <p className="mt-1 text-xs text-zinc-400 max-w-xl">
            Paste a full email thread to extract commitments, obligations,
            deadlines, and deal intelligence. Review the output before saving to
            your records.
          </p>
        </div>

        <div className="mb-4 rounded-sm border border-zinc-200 bg-white px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="text-xs font-medium text-zinc-700">
                Analysis Engine:{" "}
                <span className="text-zinc-400 font-normal">
                  Rule-based stub (LLM integration pending)
                </span>
              </p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Connect an LLM provider in{" "}
                <code className="bg-zinc-100 px-1 py-0.5 rounded text-[10px]">
                  lib/ai/analyzeThread.ts
                </code>{" "}
                to enable full AI analysis.
              </p>
            </div>
          </div>
        </div>

        <ThreadAnalyzer />
      </main>
    </div>
  );
}
