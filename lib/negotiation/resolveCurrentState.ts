import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import type {
  CurrentTermState,
  NegotiationRoundRecord,
  NegotiationTermRecord,
} from "./types";

export function chronologicalRounds(rounds: NegotiationRoundRecord[]) {
  return [...rounds].sort(
    (a, b) =>
      a.documentDate.getTime() - b.documentDate.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );
}

function identity(term: NegotiationTermRecord): string {
  if (term.normalizedNumeric !== null && term.normalizedUnit) {
    return `${term.normalizedUnit}:${term.normalizedNumeric}`;
  }
  return (term.normalizedValue ?? term.rawValue).trim().toLocaleLowerCase();
}

export function termObservations(
  rounds: NegotiationRoundRecord[],
  canonicalType: CanonicalTermType
): Array<{ round: NegotiationRoundRecord; term: NegotiationTermRecord }> {
  return chronologicalRounds(rounds).flatMap((round) =>
    round.terms
      .filter((term) => term.canonicalType === canonicalType)
      .map((term) => ({ round, term }))
  );
}

export function currentPositionForSide(
  rounds: NegotiationRoundRecord[],
  canonicalType: CanonicalTermType,
  side: "TENANT" | "LANDLORD"
): NegotiationTermRecord | undefined {
  const observations = termObservations(rounds, canonicalType).filter(
    ({ term }) => term.side === side
  );
  const latest = observations.at(-1)?.term;
  if (latest?.status === "WITHDRAWN") return undefined;

  return observations
    .map(({ term }) => term)
    .filter((term) => ["PROPOSED", "AGREED"].includes(term.status))
    .at(-1);
}

export function resolveCurrentState(
  rounds: NegotiationRoundRecord[],
  canonicalType: CanonicalTermType
): CurrentTermState {
  const observations = termObservations(rounds, canonicalType);
  if (observations.length === 0) {
    return { canonicalType, status: "NOT_MENTIONED", contradictory: false };
  }

  const latestRound = observations.at(-1)!.round;
  const latestRoundTerms = observations
    .filter(({ round }) => round.id === latestRound.id)
    .map(({ term }) => term);
  const meaningfulLatest = latestRoundTerms.at(-1)!;
  const distinctLatestValues = new Set(
    latestRoundTerms
      .filter((term) => ["PROPOSED", "AGREED"].includes(term.status))
      .map(identity)
  );
  const contradictory = distinctLatestValues.size > 1;

  const currentTenantTerm = currentPositionForSide(
    rounds,
    canonicalType,
    "TENANT"
  );
  const currentLandlordTerm = currentPositionForSide(
    rounds,
    canonicalType,
    "LANDLORD"
  );

  const laterThanLatestAgreement = observations
    .map(({ term }) => term)
    .findLastIndex((term) => term.status === "AGREED");
  const agreedTerm =
    laterThanLatestAgreement >= 0
      ? observations[laterThanLatestAgreement]?.term
      : undefined;
  const agreementIsLatest =
    laterThanLatestAgreement === observations.length - 1 && !contradictory;

  let status: CurrentTermState["status"];
  if (contradictory) {
    status = "UNRESOLVED";
  } else if (agreementIsLatest) {
    status = "AGREED";
  } else if (
    ["REJECTED", "WITHDRAWN", "UNRESOLVED"].includes(
      meaningfulLatest.status
    )
  ) {
    status = meaningfulLatest.status;
  } else if (currentTenantTerm && currentLandlordTerm) {
    // Matching values are not silently promoted to agreement without explicit evidence.
    status = "UNRESOLVED";
  } else {
    status = "PROPOSED";
  }

  return {
    canonicalType,
    status,
    ...(currentTenantTerm ? { currentTenantTerm } : {}),
    ...(currentLandlordTerm ? { currentLandlordTerm } : {}),
    ...(agreementIsLatest && agreedTerm ? { agreedTerm } : {}),
    contradictory,
  };
}
