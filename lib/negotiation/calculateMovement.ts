import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import { termObservations, currentPositionForSide } from "./resolveCurrentState";
import type { NegotiationRoundRecord, NegotiationTermRecord } from "./types";

export interface SideMovement {
  side: "TENANT" | "LANDLORD";
  initial: number;
  current: number;
  change: number;
  unit: string;
  initialTerm: NegotiationTermRecord;
  currentTerm: NegotiationTermRecord;
}

export interface TermMovement {
  canonicalType: CanonicalTermType;
  tenant?: SideMovement;
  landlord?: SideMovement;
}

function movementForSide(
  rounds: NegotiationRoundRecord[],
  canonicalType: CanonicalTermType,
  side: "TENANT" | "LANDLORD"
): SideMovement | undefined {
  const positions = termObservations(rounds, canonicalType)
    .map(({ term }) => term)
    .filter(
      (term) =>
        term.side === side &&
        ["PROPOSED", "AGREED"].includes(term.status) &&
        term.normalizedNumeric !== null &&
        term.normalizedUnit !== null
    );
  const initialTerm = positions[0];
  const currentTerm = currentPositionForSide(rounds, canonicalType, side);
  if (
    !initialTerm ||
    !currentTerm ||
    initialTerm.normalizedNumeric === null ||
    currentTerm.normalizedNumeric === null ||
    !initialTerm.normalizedUnit ||
    currentTerm.normalizedUnit !== initialTerm.normalizedUnit
  ) {
    return undefined;
  }

  return {
    side,
    initial: initialTerm.normalizedNumeric,
    current: currentTerm.normalizedNumeric,
    change: currentTerm.normalizedNumeric - initialTerm.normalizedNumeric,
    unit: initialTerm.normalizedUnit,
    initialTerm,
    currentTerm,
  };
}

export function calculateMovement(
  rounds: NegotiationRoundRecord[],
  canonicalType: CanonicalTermType
): TermMovement {
  const tenant = movementForSide(rounds, canonicalType, "TENANT");
  const landlord = movementForSide(rounds, canonicalType, "LANDLORD");
  return {
    canonicalType,
    ...(tenant ? { tenant } : {}),
    ...(landlord ? { landlord } : {}),
  };
}
