export type MessageAnalysisState = "NOT_ANALYZED" | "ANALYZING" | "ANALYZED" | "ANALYSIS_FAILED";
export type MessageReviewState = "NOT_REVIEWED" | "REVIEW_REQUIRED" | "NEEDS_FOLLOW_UP" | "REVIEWED";
export type MessageLifecycleState = "IMPORTED" | "ANALYZING" | "ANALYZED" | "ANALYSIS_FAILED" | "REVIEW_REQUIRED" | "REVIEWED";

interface RunState { id: string; status: string; factCount: number; createdAt: Date; completedAt: Date | null; failureCode?: string | null; failureReason?: string | null }
interface DecisionState { decision: string; activityExtractionRunId: string | null; presentedFactIds: unknown; createdAt: Date; id: string }

function newest<T extends { createdAt: Date; id: string }>(items: T[]): T | null {
  return [...items].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))[0] ?? null;
}

export function latestMessageRun<T extends RunState>(runs: T[]): T | null {
  return [...runs].sort((left, right) => {
    const leftTime = (left.completedAt ?? left.createdAt).getTime();
    const rightTime = (right.completedAt ?? right.createdAt).getTime();
    return rightTime - leftTime || right.id.localeCompare(left.id);
  })[0] ?? null;
}

export function deriveMessageLifecycle(input: { runs: RunState[]; decisions: DecisionState[]; currentFactIds: string[] }) {
  const run = latestMessageRun(input.runs);
  const decision = newest(input.decisions);
  let analysisState: MessageAnalysisState = "NOT_ANALYZED";
  if (run?.status === "RUNNING") analysisState = "ANALYZING";
  if (run?.status === "SUCCEEDED") analysisState = "ANALYZED";
  if (run?.status === "FAILED") analysisState = "ANALYSIS_FAILED";

  let reviewState: MessageReviewState = run?.status === "SUCCEEDED" ? "REVIEW_REQUIRED" : "NOT_REVIEWED";
  if (decision?.decision === "NEEDS_FOLLOW_UP") reviewState = "NEEDS_FOLLOW_UP";
  if (run?.status === "SUCCEEDED" && decision?.decision === "ACKNOWLEDGED" && decision.activityExtractionRunId === run.id) {
    const presented = Array.isArray(decision.presentedFactIds) ? decision.presentedFactIds.filter((value): value is string => typeof value === "string").sort() : [];
    const current = [...input.currentFactIds].sort();
    if (presented.length === current.length && presented.every((value, index) => value === current[index])) reviewState = "REVIEWED";
  }
  const lifecycleState: MessageLifecycleState = analysisState === "NOT_ANALYZED" ? "IMPORTED"
    : analysisState === "ANALYZING" ? "ANALYZING"
      : analysisState === "ANALYSIS_FAILED" ? "ANALYSIS_FAILED"
        : reviewState === "REVIEWED" ? "REVIEWED"
          : reviewState === "REVIEW_REQUIRED" || reviewState === "NEEDS_FOLLOW_UP" ? "REVIEW_REQUIRED"
            : "ANALYZED";
  return {
    analysisState,
    reviewState,
    lifecycleState,
    failureCode: run?.status === "FAILED" ? run.failureCode ?? null : null,
    failureReason: run?.status === "FAILED" ? run.failureReason ?? null : null,
    latestRunId: run?.id ?? null,
  };
}
