import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import { calculateMovement } from "./calculateMovement";
import {
  chronologicalRounds,
  resolveCurrentState,
  termObservations,
} from "./resolveCurrentState";
import { TERM_CATALOG } from "./termCatalog";
import type { NegotiationRoundRecord, NegotiationTermRecord } from "./types";

export interface NumericGap {
  initialGap: number;
  currentGap: number;
  gapClosed: number;
  gapClosurePercent: number;
  unit: string;
}

export function calculateNumericGap(
  tenantInitial: number,
  landlordInitial: number,
  tenantCurrent: number,
  landlordCurrent: number,
  unit: string
): NumericGap {
  const initialGap = Math.abs(landlordInitial - tenantInitial);
  const currentGap = Math.abs(landlordCurrent - tenantCurrent);
  const gapClosed = initialGap - currentGap;
  return {
    initialGap,
    currentGap,
    gapClosed,
    gapClosurePercent: initialGap === 0 ? 0 : (gapClosed / initialGap) * 100,
    unit,
  };
}

function firstNumericPosition(
  rounds: NegotiationRoundRecord[],
  type: CanonicalTermType,
  side: "TENANT" | "LANDLORD"
): NegotiationTermRecord | undefined {
  return termObservations(rounds, type)
    .map(({ term }) => term)
    .find(
      (term) =>
        term.side === side &&
        ["PROPOSED", "AGREED"].includes(term.status) &&
        term.normalizedNumeric !== null &&
        term.normalizedUnit !== null
    );
}

export function compareRounds(rounds: NegotiationRoundRecord[]) {
  const orderedRounds = chronologicalRounds(rounds);
  const rows = TERM_CATALOG.map(({ type, label, significance }) => {
    const state = resolveCurrentState(orderedRounds, type);
    const movement = calculateMovement(orderedRounds, type);
    const firstTenant = firstNumericPosition(orderedRounds, type, "TENANT");
    const firstLandlord = firstNumericPosition(orderedRounds, type, "LANDLORD");
    const currentTenant = state.currentTenantTerm;
    const currentLandlord = state.currentLandlordTerm;

    let gap: NumericGap | undefined;
    if (
      firstTenant?.normalizedNumeric !== null &&
      firstTenant?.normalizedNumeric !== undefined &&
      firstLandlord?.normalizedNumeric !== null &&
      firstLandlord?.normalizedNumeric !== undefined &&
      currentTenant?.normalizedNumeric !== null &&
      currentTenant?.normalizedNumeric !== undefined &&
      currentLandlord?.normalizedNumeric !== null &&
      currentLandlord?.normalizedNumeric !== undefined &&
      firstTenant.normalizedUnit &&
      firstTenant.normalizedUnit === firstLandlord.normalizedUnit &&
      firstTenant.normalizedUnit === currentTenant.normalizedUnit &&
      firstTenant.normalizedUnit === currentLandlord.normalizedUnit
    ) {
      gap = calculateNumericGap(
        firstTenant.normalizedNumeric,
        firstLandlord.normalizedNumeric,
        currentTenant.normalizedNumeric,
        currentLandlord.normalizedNumeric,
        firstTenant.normalizedUnit
      );
      if (state.status === "AGREED") {
        gap.currentGap = 0;
        gap.gapClosed = gap.initialGap;
        gap.gapClosurePercent = initialGapPercentage(gap.initialGap);
      }
    }

    return {
      type,
      label,
      significance,
      state,
      movement,
      ...(gap ? { gap } : {}),
      cells: orderedRounds.map((round) => ({
        roundId: round.id,
        terms: round.terms.filter((term) => term.canonicalType === type),
      })),
    };
  });

  return {
    rounds: orderedRounds,
    rows,
    openIssues: rows
      .filter(
        (row) =>
          row.state.status !== "AGREED" &&
          row.state.status !== "NOT_MENTIONED"
      )
      .sort((a, b) => b.significance - a.significance),
    agreedTerms: rows.filter((row) => row.state.status === "AGREED"),
  };
}

function initialGapPercentage(initialGap: number) {
  return initialGap === 0 ? 0 : 100;
}
