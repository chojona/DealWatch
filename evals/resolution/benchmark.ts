import { proposeResolution } from "@/lib/resolution/propose";
import { resolutionCases, type ResolutionCase } from "./cases";

export interface ResolutionBenchmarkReport {
  caseCount: number;
  candidateRecall: number;
  top1Accuracy: number;
  top3Accuracy: number;
  falseCandidateRate: number;
  required: number;
  requiredHits: number;
  top1Cases: number;
  top1Hits: number;
  top3Hits: number;
  forbidden: number;
  falseCandidates: number;
  failures: string[];
}

function rankedIds(entry: ResolutionCase): string[] {
  return proposeResolution(entry.observation, entry.catalog).map((proposal) => proposal.entityId);
}

export function evaluateResolutionBenchmark(
  cases: ResolutionCase[] = resolutionCases
): ResolutionBenchmarkReport {
  let required = 0;
  let requiredHits = 0;
  let top1Cases = 0;
  let top1Hits = 0;
  let top3Hits = 0;
  let forbidden = 0;
  let falseCandidates = 0;
  const failures: string[] = [];

  for (const entry of cases) {
    const proposals = proposeResolution(entry.observation, entry.catalog);
    const ids = proposals.map((proposal) => proposal.entityId);
    for (const id of entry.requiredIds) {
      required += 1;
      if (ids.includes(id)) requiredHits += 1;
      else failures.push(`${entry.id} missed ${id}`);
    }
    if (entry.topId) {
      top1Cases += 1;
      if (ids[0] === entry.topId) top1Hits += 1;
      else failures.push(`${entry.id} top1 ${ids[0] ?? "none"} expected ${entry.topId}`);
      if (ids.slice(0, 3).includes(entry.topId)) top3Hits += 1;
      else failures.push(`${entry.id} top3 missed ${entry.topId}`);
    }
    for (const id of entry.forbiddenIds) {
      forbidden += 1;
      if (ids.includes(id)) {
        falseCandidates += 1;
        failures.push(`${entry.id} false candidate ${id}`);
      }
    }
    if (entry.expect?.emailExact) {
      const top = proposals.find((proposal) => proposal.entityId === entry.topId);
      if (!top?.features.emailExact) failures.push(`${entry.id} missing emailExact`);
    }
    if (entry.expect?.differentEmail) {
      const conflict = proposals.find((proposal) => proposal.features.differentEmail);
      if (!conflict) failures.push(`${entry.id} missing different email`);
    }
    if (entry.expect?.historicalEmployer) {
      const top = proposals.find((proposal) => proposal.entityId === entry.topId);
      if (!top?.features.historicalEmployer && !top?.features.historicalEmployerMatch) {
        failures.push(`${entry.id} missing historical employer context`);
      }
      if (top?.features.incompatibleEmployers) failures.push(`${entry.id} treated history as a conflict`);
    }
    if (entry.expect?.sharedInboxIgnored) {
      if (proposals.some((proposal) => proposal.features.emailExact)) {
        failures.push(`${entry.id} treated a shared inbox as emailExact`);
      }
    }
  }

  const ratio = (hit: number, total: number) => (total === 0 ? 1 : hit / total);
  return {
    caseCount: cases.length,
    candidateRecall: ratio(requiredHits, required),
    top1Accuracy: ratio(top1Hits, top1Cases),
    top3Accuracy: ratio(top3Hits, top1Cases),
    falseCandidateRate: forbidden === 0 ? 0 : falseCandidates / forbidden,
    required,
    requiredHits,
    top1Cases,
    top1Hits,
    top3Hits,
    forbidden,
    falseCandidates,
    failures,
  };
}

export function formatResolutionBenchmark(report: ResolutionBenchmarkReport): string {
  return [
    `cases ${report.caseCount}`,
    `candidate recall ${report.candidateRecall.toFixed(3)} (${report.requiredHits}/${report.required})`,
    `top-1 accuracy ${report.top1Accuracy.toFixed(3)} (${report.top1Hits}/${report.top1Cases})`,
    `top-3 accuracy ${report.top3Accuracy.toFixed(3)} (${report.top3Hits}/${report.top1Cases})`,
    `false-candidate rate ${report.falseCandidateRate.toFixed(3)} (${report.falseCandidates}/${report.forbidden})`,
    ...report.failures.map((failure) => `FAIL ${failure}`),
  ].join("\n");
}

export { rankedIds };
