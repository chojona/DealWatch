import { parseStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType, NegotiationSide } from "@/lib/ai/negotiation/schemas";
import { chronologicalRounds, termObservations } from "@/lib/negotiation/resolveCurrentState";
import type { RoundWithPayload, TermWithPayload } from "@/lib/negotiation/resolveStructuredState";
import { formatNumericValue } from "./formatting";
import type { NegotiationMovementView } from "./types";

type Preference = "HIGHER_TENANT" | "LOWER_TENANT";

/** Explicit business semantics. Types absent from this map are never interpreted. */
const DIRECTION: Partial<Record<CanonicalTermType, Preference>> = {
  BASE_RENT: "LOWER_TENANT",
  ANNUAL_ESCALATION: "LOWER_TENANT",
  TI_ALLOWANCE: "HIGHER_TENANT",
  FREE_RENT: "HIGHER_TENANT",
  SECURITY_DEPOSIT: "LOWER_TENANT",
};

function active(term: TermWithPayload): boolean {
  return term.status === "PROPOSED" || term.status === "AGREED" || term.status === "UNRESOLVED";
}

function fingerprint(term: TermWithPayload): string {
  const payload = parseStructuredPayload(term.structuredPayload, term.canonicalType);
  if (payload) return `structured:${JSON.stringify(payload)}`;
  if (term.normalizedNumeric !== null && term.normalizedUnit) {
    return `numeric:${term.normalizedUnit}:${term.normalizedNumeric}`;
  }
  return `text:${(term.normalizedValue ?? term.rawValue).trim().toLocaleLowerCase()}`;
}

export function observationFingerprint(term: TermWithPayload): string {
  return `${term.status}:${fingerprint(term)}`;
}

function previousDifferentPosition(
  rounds: RoundWithPayload[],
  canonicalType: CanonicalTermType,
  side: NegotiationSide
): { current: TermWithPayload; previous: TermWithPayload; roundId: string } | null {
  const observations = termObservations(
    chronologicalRounds(rounds as never) as never,
    canonicalType
  ) as Array<{ round: RoundWithPayload; term: TermWithPayload }>;
  const positions = observations.filter(({ term }) => term.side === side && active(term));
  const currentEntry = positions.at(-1);
  if (!currentEntry) return null;
  const currentFingerprint = fingerprint(currentEntry.term);
  const previousEntry = positions
    .slice(0, -1)
    .findLast(({ term }) => fingerprint(term) !== currentFingerprint);
  if (!previousEntry) return null;
  return {
    current: currentEntry.term,
    previous: previousEntry.term,
    roundId: currentEntry.round.id,
  };
}

function semanticDirection(
  canonicalType: CanonicalTermType,
  change: number
): NegotiationMovementView["direction"] {
  const preference = DIRECTION[canonicalType];
  if (!preference || change === 0) return change === 0 ? "NEUTRAL" : "UNKNOWN";
  const tenantFavored =
    (preference === "HIGHER_TENANT" && change > 0) ||
    (preference === "LOWER_TENANT" && change < 0);
  return tenantFavored ? "TOWARD_TENANT" : "TOWARD_LANDLORD";
}

function numericMovement(
  canonicalType: CanonicalTermType,
  side: NegotiationSide,
  current: TermWithPayload,
  previous: TermWithPayload,
  roundId: string
): NegotiationMovementView | null {
  if (!DIRECTION[canonicalType]) return null;
  if (
    current.normalizedNumeric === null ||
    previous.normalizedNumeric === null ||
    !current.normalizedUnit ||
    current.normalizedUnit !== previous.normalizedUnit
  ) {
    return null;
  }
  const currentPayload = parseStructuredPayload(current.structuredPayload, canonicalType);
  const previousPayload = parseStructuredPayload(previous.structuredPayload, canonicalType);
  if (
    currentPayload?.termType === "BASE_RENT" && currentPayload.rent.kind === "stepped" ||
    previousPayload?.termType === "BASE_RENT" && previousPayload.rent.kind === "stepped" ||
    currentPayload?.termType === "FREE_RENT" && currentPayload.abatement.kind === "irregular" ||
    previousPayload?.termType === "FREE_RENT" && previousPayload.abatement.kind === "irregular"
  ) {
    return null;
  }
  const change = current.normalizedNumeric - previous.normalizedNumeric;
  if (change === 0) return null;
  const direction = semanticDirection(canonicalType, change);
  const sideLabel = side === "TENANT" ? "Tenant" : "Landlord";
  const directionLabel =
    direction === "TOWARD_TENANT"
      ? "toward tenant"
      : direction === "TOWARD_LANDLORD"
        ? "toward landlord"
        : "changed";
  return {
    kind: "NUMERIC",
    label: `${sideLabel}: ${formatNumericValue(previous.normalizedNumeric, current.normalizedUnit)} → ${formatNumericValue(current.normalizedNumeric, current.normalizedUnit)} · ${formatNumericValue(Math.abs(change), current.normalizedUnit)} ${directionLabel}`,
    side,
    from: previous.normalizedNumeric,
    to: current.normalizedNumeric,
    amount: Math.abs(change),
    unit: current.normalizedUnit,
    direction,
    roundId,
  };
}

export function calculateWorkspaceMovement(
  rounds: RoundWithPayload[],
  canonicalType: CanonicalTermType
): NegotiationMovementView {
  const candidates = (["TENANT", "LANDLORD"] as const)
    .map((side) => {
      const pair = previousDifferentPosition(rounds, canonicalType, side);
      return pair ? { side, ...pair } : null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);
  const latestRoundIds = new Map(
    chronologicalRounds(rounds as never).map((round, index) => [round.id, index])
  );
  const latest = candidates.sort(
    (a, b) => (latestRoundIds.get(b.roundId) ?? -1) - (latestRoundIds.get(a.roundId) ?? -1)
  )[0];
  if (!latest) {
    return {
      kind: "NONE",
      label: "No prior position",
      side: null,
      from: null,
      to: null,
      amount: null,
      unit: null,
      direction: "UNKNOWN",
      roundId: null,
    };
  }
  return (
    numericMovement(
      canonicalType,
      latest.side,
      latest.current,
      latest.previous,
      latest.roundId
    ) ?? {
      kind: "CHANGED",
      label: `${latest.side === "TENANT" ? "Tenant" : "Landlord"} changed this term`,
      side: latest.side,
      from: null,
      to: null,
      amount: null,
      unit: null,
      direction: "UNKNOWN",
      roundId: latest.roundId,
    }
  );
}
