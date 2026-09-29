import { ThreadAnalyzer } from "@/components/analyze/thread-analyzer";

export default function AnalyzePage() {
  return (
    <div className="min-h-screen">

      <main className="page-frame page-reading">
        <div className="mb-6">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Legacy workflow
          </p>
          <h1 className="text-xl font-semibold text-zinc-900">
            Analyze Thread
          </h1>
          <p className="mt-1 text-xs text-zinc-400 max-w-xl">
            This older path creates legacy obligation and deal-event records from a pasted thread.
            New work starts from Create Deal. The modern workspace uses documents, messages, the brief, actions, and negotiation.
          </p>
        </div>

        <div className="mb-4 rounded-sm border border-zinc-200 bg-white px-4 py-3">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="text-xs font-medium text-zinc-700">
                Analysis Engine:{" "}
                <span className="text-zinc-400 font-normal">
                  Conservative CRE thread analysis
                </span>
              </p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Structured extraction with source-evidence validation and
                deterministic deadline tracking.
              </p>
            </div>
          </div>
        </div>

        <ThreadAnalyzer />
      </main>
    </div>
  );
}
