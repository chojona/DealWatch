/**
 * Edge strength is a support-richness score in [0, 1]. It is not a probability
 * and must not be shown as a percent confidence.
 *
 * strengthScore = round2(
 *     0.15 * openness
 *   + 0.28 * min(observationCount, 6) / 6
 *   + 0.24 * min(distinctEvidenceSources, 4) / 4
 *   + 0.15 * min(sharedDealCount, 3) / 3
 *   + 0.10 * recency
 *   + 0.08 * provenance
 * )
 *
 * openness
 *   1    assertion is ASSERTED and validTo is null or still in the future
 *   0.25 assertion is ASSERTED but validTo is in the past
 * Retired assertions are excluded from traversal and are not scored.
 *
 * distinctEvidenceSources
 *   distinct supporting document ids plus distinct supporting message ids
 *
 * sharedDealCount
 *   Employment and property stakes: distinct deal ids on supporting observations
 *   (dealId, otherwise contextDealId).
 *   Deal participation: the participation's deal, plus any other deal id on support.
 *   Deal property link: 1 when the deal is linked to a property.
 *
 * recency uses the newest supporting observation timestamp:
 *   1    within 365 days
 *   0.45 within 730 days
 *   0.15 older
 *   0    no supporting observation
 *
 * provenance
 *   0    no supporting observations
 *   1    assertionSource OBSERVATION and any support is EXACT
 *   0.7  assertionSource OBSERVATION
 *   0.35 assertionSource MANUAL with at least one observation
 *
 * Labels, from the score alone:
 *   Strong   >= 0.70
 *   Moderate >= 0.40
 *   Limited  otherwise
 */

export const STRENGTH_LABELS = ["Strong", "Moderate", "Limited"] as const;

export type StrengthLabel = (typeof STRENGTH_LABELS)[number];

export type RecencyBand = "recent" | "within_two_years" | "older" | "none";

export interface EdgeStrengthInput {
  observationCount: number;
  distinctDocumentCount: number;
  distinctMessageCount: number;
  sharedDealCount: number;
  /** Newest supporting observation, if any. */
  newestEvidenceAt: Date | null;
  /** True when the assertion is currently open. */
  open: boolean;
  assertionSource: "OBSERVATION" | "MANUAL";
  hasExactProvenance: boolean;
  now?: Date;
}

export interface EdgeStrength {
  strengthScore: number;
  strengthLabel: StrengthLabel;
  strengthReasons: string[];
  observationCount: number;
  distinctDocumentCount: number;
  distinctMessageCount: number;
  sharedDealCount: number;
  recency: RecencyBand;
  open: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function strengthLabelFor(score: number): StrengthLabel {
  if (score >= 0.7) return "Strong";
  if (score >= 0.4) return "Moderate";
  return "Limited";
}

export function recencyBand(newestEvidenceAt: Date | null, now: Date): RecencyBand {
  if (!newestEvidenceAt) return "none";
  const age = now.getTime() - newestEvidenceAt.getTime();
  if (age <= 365 * DAY_MS) return "recent";
  if (age <= 730 * DAY_MS) return "within_two_years";
  return "older";
}

function recencyFactor(band: RecencyBand): number {
  if (band === "recent") return 1;
  if (band === "within_two_years") return 0.45;
  if (band === "older") return 0.15;
  return 0;
}

function provenanceFactor(input: EdgeStrengthInput): number {
  if (input.observationCount <= 0) return 0;
  if (input.assertionSource === "OBSERVATION" && input.hasExactProvenance) return 1;
  if (input.assertionSource === "OBSERVATION") return 0.7;
  return 0.35;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function edgeStrengthReasons(input: EdgeStrength & { assertionSource: "OBSERVATION" | "MANUAL" }): string[] {
  const reasons: string[] = [];
  if (input.observationCount === 0) reasons.push("No supporting observations");
  else {
    reasons.push(
      `${input.observationCount} supporting ${input.observationCount === 1 ? "observation" : "observations"}`
    );
  }
  if (input.distinctDocumentCount > 0) {
    reasons.push(
      `${input.distinctDocumentCount} distinct ${input.distinctDocumentCount === 1 ? "document" : "documents"}`
    );
  }
  if (input.distinctMessageCount > 0) {
    reasons.push(
      `${input.distinctMessageCount} distinct ${input.distinctMessageCount === 1 ? "message" : "messages"}`
    );
  }
  if (input.distinctDocumentCount === 0 && input.distinctMessageCount === 0) {
    reasons.push("No distinct documents or messages");
  }
  if (input.sharedDealCount > 0) {
    reasons.push(
      input.sharedDealCount === 1 ? "Appeared on 1 deal" : `Appeared on ${input.sharedDealCount} deals`
    );
  }
  if (input.recency === "recent") reasons.push("Evidence within the last 12 months");
  else if (input.recency === "within_two_years") reasons.push("Evidence within the last 24 months");
  else if (input.recency === "older") reasons.push("Evidence is older than 24 months");
  else reasons.push("No documentary evidence date");
  reasons.push(input.open ? "Assertion is currently open" : "Assertion is closed");
  if (input.observationCount === 0) reasons.push("No documentary support is linked");
  else if (input.assertionSource === "OBSERVATION") reasons.push("Recorded from an observation");
  else reasons.push("Recorded manually");
  return reasons;
}

export function scoreEdgeStrength(input: EdgeStrengthInput): EdgeStrength {
  const now = input.now ?? new Date();
  const observationCount = Math.max(0, input.observationCount);
  const distinctDocumentCount = Math.max(0, input.distinctDocumentCount);
  const distinctMessageCount = Math.max(0, input.distinctMessageCount);
  const sharedDealCount = Math.max(0, input.sharedDealCount);
  const sources = distinctDocumentCount + distinctMessageCount;
  const band = recencyBand(input.newestEvidenceAt, now);
  const openness = input.open ? 1 : 0.25;
  const raw =
    0.15 * openness +
    0.28 * (Math.min(observationCount, 6) / 6) +
    0.24 * (Math.min(sources, 4) / 4) +
    0.15 * (Math.min(sharedDealCount, 3) / 3) +
    0.1 * recencyFactor(band) +
    0.08 * provenanceFactor({ ...input, observationCount });
  const strengthScore = round2(raw);
  const measured: EdgeStrength = {
    strengthScore,
    strengthLabel: strengthLabelFor(strengthScore),
    strengthReasons: [],
    observationCount,
    distinctDocumentCount,
    distinctMessageCount,
    sharedDealCount,
    recency: band,
    open: input.open,
  };
  measured.strengthReasons = edgeStrengthReasons({ ...measured, assertionSource: input.assertionSource });
  return measured;
}

/**
 * Path score ranks a whole path. Hop count dominates.
 *
 * pathScore = round2(
 *   hopWeight(hops) * (0.70 + 0.25 * mean(edge strengthScore) + 0.05 * mean(edge recency factor))
 * )
 *
 * hopWeight: 1 → 1.00, 2 → 0.55, 3 → 0.32, 4 → 0.18
 *
 * The minimum score at hop n is greater than the maximum score at hop n+1,
 * so a shorter path always ranks ahead of a longer one. Within one hop count,
 * higher mean edge strength ranks first, then more recent evidence.
 */
export function pathHopWeight(hops: number): number {
  if (hops <= 1) return 1;
  if (hops === 2) return 0.55;
  if (hops === 3) return 0.32;
  return 0.18;
}

export function scoreConnectionPath(edges: Array<{ strengthScore: number; recency: RecencyBand }>): number {
  if (edges.length === 0) return 0;
  const meanStrength = edges.reduce((sum, edge) => sum + edge.strengthScore, 0) / edges.length;
  const meanRecency =
    edges.reduce((sum, edge) => sum + recencyFactor(edge.recency), 0) / edges.length;
  const raw = pathHopWeight(edges.length) * (0.7 + 0.25 * meanStrength + 0.05 * meanRecency);
  return round2(raw);
}

/** Conservative summary: the weakest edge on the path. */
export function pathStrengthSummary(edges: Array<{ strengthLabel: StrengthLabel }>): StrengthLabel {
  if (edges.some((edge) => edge.strengthLabel === "Limited")) return "Limited";
  if (edges.some((edge) => edge.strengthLabel === "Moderate")) return "Moderate";
  return "Strong";
}
