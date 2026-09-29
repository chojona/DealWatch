export interface RunIdentity {
  id: string;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
}

export function latestSuccessfulRunId<T extends { activityExtractionRun: RunIdentity | null }>(facts: T[]): string | null {
  const succeeded = facts.filter((fact) => fact.activityExtractionRun?.status === "SUCCEEDED");
  const latest = succeeded.reduce<T | null>((best, fact) => {
    if (!best) return fact;
    const left = fact.activityExtractionRun!;
    const right = best.activityExtractionRun!;
    const leftTime = (left.completedAt ?? left.createdAt).getTime();
    const rightTime = (right.completedAt ?? right.createdAt).getTime();
    if (leftTime !== rightTime) return leftTime > rightTime ? fact : best;
    return left.id > right.id ? fact : best;
  }, null);
  return latest?.activityExtractionRun?.id ?? null;
}

export function factsFromLatestRun<T extends { activityExtractionRun: RunIdentity | null }>(facts: T[]): T[] {
  const runId = latestSuccessfulRunId(facts);
  if (!runId) return facts.filter((fact) => fact.activityExtractionRun == null);
  return facts.filter((fact) => fact.activityExtractionRun?.id === runId);
}
