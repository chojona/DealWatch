/**
 * lib/negotiation/resolveStructuredState.ts
 *
 * Phase 3 — Structured Current-State Resolution.
 *
 * Derives the canonical structured current position for each negotiation side
 * and term type from a sequence of immutable NegotiationTerm observations,
 * without ever mutating any source observation.
 *
 * ARCHITECTURE (see artifacts/cre-ontology-design.md §2.0):
 *
 *   SOURCE OBSERVATIONS  (NegotiationTerm rows — never mutated)
 *         ↓
 *   STRUCTURED RESOLVER  (this module)
 *         ↓
 *   DERIVED CURRENT STATE (StructuredCurrentTermState — pure derived data)
 *
 * The existing flat resolveCurrentState remains fully available and is not
 * replaced. This module is an additive sibling that operates on term types
 * carrying CREStructuredPayload.
 *
 * CARRY-FORWARD (§4):  Omission ≠ withdrawal. A side's most recent active
 *   position carries forward through all subsequent rounds that omit it.
 *
 * STEPPED RENT (§5): All steps are preserved as a schedule; periods are
 *   assembled from multiple same-round observations when non-overlapping.
 *   Overlapping same-period, different-amount candidates → CONFLICT.
 *
 * FREE RENT (§6): Non-contiguous abatement periods are preserved as-is.
 *   equivalentFullMonths is a derived summary, never the authoritative state.
 *
 * RIGHTS ATOMICITY (§7): RENEWAL_OPTIONS, TERMINATION_RIGHTS, EXPANSION_RIGHTS
 *   are replaced as atomic units. A newer proposal supersedes the old right
 *   as a whole, not field-by-field.
 *
 * AGREEMENT (§8): AGREED state requires explicit assent evidence (status ===
 *   "AGREED"). Matching values between sides do not constitute agreement.
 *
 * CONFLICT (§11): Irreconcilable same-side same-round alternatives surface as
 *   a typed CONFLICT with all candidates preserved.
 *
 * PROVENANCE (§10): All observationIds in the result are real NegotiationTerm
 *   row IDs. The "pending" placeholder written by the extraction model is
 *   replaced deterministically with the enclosing term's real ID.
 */

import { parseStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type {
  AbatementPeriod,
  BaseRentPayload,
  CREStructuredPayload,
  CRETermType,
  FreeRentPayload,
  RentStep,
} from "@/lib/ai/negotiation/payloads";
import type { NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";
import { chronologicalRounds, termObservations } from "./resolveCurrentState";
import type { NegotiationRoundRecord, NegotiationTermRecord } from "./types";

// ─── Extended input types ─────────────────────────────────────────────────────

/**
 * A NegotiationTermRecord that may carry an optional typed structured payload.
 * NegotiationTermRecordV2 is structurally a subtype of TermWithPayload, so
 * V2 round arrays can be passed directly.
 *
 * Plain NegotiationTermRecord (without structuredPayload) is also accepted;
 * the resolver treats the absent field as null and falls back gracefully.
 */
export type TermWithPayload = NegotiationTermRecord & {
  structuredPayload?: CREStructuredPayload | null;
};

/** A NegotiationRoundRecord whose terms may carry structured payloads. */
export type RoundWithPayload = Omit<NegotiationRoundRecord, "terms"> & {
  terms: TermWithPayload[];
};

// ─── Result types ─────────────────────────────────────────────────────────────

/**
 * A successfully resolved current position for one side on one term type.
 * observationIds contains REAL NegotiationTerm.id values — never "pending".
 */
export interface ResolvedSidePosition {
  payload: CREStructuredPayload;
  /**
   * Real NegotiationTerm.id values whose observations contributed to this
   * resolved position. Enables click-to-source provenance drill-down.
   */
  observationIds: string[];
}

/**
 * One candidate within an explicit conflict. Produced when multiple structured
 * observations from the same side and the same round are irreconcilably
 * contradictory (e.g., n13-contradictory-draft).
 */
export interface ResolvedConflictCandidate {
  payload: CREStructuredPayload;
  observationIds: string[];
}

/**
 * Explicit conflict representation. DealWatch surfaces "Two conflicting tenant
 * rent positions detected" rather than silently picking one candidate.
 *
 * Produced for same-side same-round observations whose structured payloads
 * cannot be reconciled into a single coherent position.
 */
export interface ResolvedSideConflict {
  status: "CONFLICT";
  candidates: ResolvedConflictCandidate[];
}

/** Discriminated union: resolved position or explicit conflict for one side. */
export type SideResult = ResolvedSidePosition | ResolvedSideConflict;

/** Type-guard for conflict results. */
export function isSideConflict(r: SideResult): r is ResolvedSideConflict {
  return "status" in r && (r as ResolvedSideConflict).status === "CONFLICT";
}

/**
 * Structured canonical current state for one CRE term type across all
 * negotiation rounds. This is DERIVED data — source observations are never
 * mutated.
 *
 * Parallel to the flat CurrentTermState but carries full structured payloads
 * with per-component provenance.
 */
export interface StructuredCurrentTermState {
  canonicalType: CRETermType;
  /**
   * Overall negotiation status for this term type, following the same
   * semantics as CurrentTermState.status.
   *
   * Note: individual within-round conflicts surface in the tenant/landlord
   * SideResult, not as "CONFLICT" here. The status here reflects the overall
   * agreement/open/rejected/withdrawn state of the term across both sides.
   */
  status: NegotiationTermStatus;
  /**
   * Tenant's current structured position.
   * undefined = tenant has never addressed this term (or has withdrawn).
   */
  tenant?: SideResult;
  /**
   * Landlord's current structured position.
   * undefined = landlord has never addressed this term (or has withdrawn).
   */
  landlord?: SideResult;
  /**
   * Agreed canonical state, present only when both sides have explicitly
   * assented (status === "AGREED" on an observation). Matching structured
   * values alone do not constitute agreement.
   */
  agreed?: {
    payload: CREStructuredPayload;
    observationIds: string[];
  };
  /**
   * All real NegotiationTerm.id values visible to this resolution pass.
   * Includes observations from all rounds (including historical / superseded).
   * Never contains "pending".
   */
  sourceObservationIds: string[];
}

// ─── Internal types ───────────────────────────────────────────────────────────

type Obs = { round: NegotiationRoundRecord; term: TermWithPayload };

// ─── Provenance helpers ───────────────────────────────────────────────────────

/**
 * Safely read the structured payload from a TermWithPayload.
 * Returns null when the payload is absent, null, or fails Zod validation.
 */
function getPayload(
  term: TermWithPayload,
  canonicalType: CRETermType
): CREStructuredPayload | null {
  const raw = term.structuredPayload; // optional on TermWithPayload
  if (raw == null) return null;
  return parseStructuredPayload(raw, canonicalType);
}

/**
 * Return a new payload with all internal observationRef.observationId values
 * replaced by the real termId. Prevents "pending" placeholder IDs from
 * leaking into the resolved provenance output.
 *
 * Only BASE_RENT (stepped) and FREE_RENT (irregular) carry internal
 * observationRefs. All other payload types are returned as-is (no internal
 * refs exist).
 *
 * IMMUTABILITY: the source payload object is never mutated. New objects are
 * created via spread for every level that changes.
 */
function attachRealProvenance(
  payload: CREStructuredPayload,
  termId: string
): CREStructuredPayload {
  if (payload.termType === "BASE_RENT" && payload.rent.kind === "stepped") {
    return {
      ...payload,
      rent: {
        ...payload.rent,
        steps: payload.rent.steps.map((step) => ({
          ...step,
          observationRef: {
            observationId: termId,
            ...(step.observationRef?.evidenceSpan
              ? { evidenceSpan: step.observationRef.evidenceSpan }
              : {}),
          },
        })),
      },
    };
  }
  if (payload.termType === "FREE_RENT" && payload.abatement.kind === "irregular") {
    return {
      ...payload,
      abatement: {
        ...payload.abatement,
        periods: payload.abatement.periods.map((p) => ({
          ...p,
          observationRef: {
            observationId: termId,
            ...(p.observationRef?.evidenceSpan
              ? { evidenceSpan: p.observationRef.evidenceSpan }
              : {}),
          },
        })),
      },
    };
  }
  return payload;
}


// ─── Month-range overlap utility ──────────────────────────────────────────────

function rangesOverlap(
  a: { startMonth: number; endMonth: number },
  b: { startMonth: number; endMonth: number }
): boolean {
  return a.startMonth <= b.endMonth && b.startMonth <= a.endMonth;
}

// ─── Payload deduplication ────────────────────────────────────────────────────

interface PayloadGroup<P extends CREStructuredPayload = CREStructuredPayload> {
  /** The representative term ID for this unique payload. */
  termId: string;
  payload: P;
  /** All term IDs that had this exact payload. */
  allTermIds: string[];
}

/**
 * Group observations by JSON-serialized payload fingerprint.
 * Observations that share an identical payload are collapsed to one group;
 * their term IDs are unioned into allTermIds.
 */
function groupByPayload<P extends CREStructuredPayload>(
  items: Array<{ termId: string; payload: P }>
): PayloadGroup<P>[] {
  const byJson = new Map<
    string,
    { termId: string; payload: P; allTermIds: string[] }
  >();
  for (const item of items) {
    const key = JSON.stringify(item.payload);
    const existing = byJson.get(key);
    if (existing) {
      existing.allTermIds.push(item.termId);
    } else {
      byJson.set(key, {
        termId: item.termId,
        payload: item.payload,
        allTermIds: [item.termId],
      });
    }
  }
  return [...byJson.values()];
}

// ─── BASE_RENT step aggregation ───────────────────────────────────────────────

/**
 * Internal representation of a rent step with its source term ID.
 * MAX_SAFE_INTEGER is used as a sentinel endMonth for simple rents that
 * carry no explicit period range.
 */
interface StepWithSource {
  startMonth: number;
  endMonth: number;
  amountPerRSFYear: number;
  termId: string;
  evidenceSpan?: string;
}

const SIMPLE_RENT_END_SENTINEL = Number.MAX_SAFE_INTEGER;

/**
 * Extract StepWithSource entries from a BaseRentPayload.
 * Simple rents are represented as a single step from month 1 to
 * SIMPLE_RENT_END_SENTINEL so they can participate in conflict detection.
 */
function stepsFromPayload(
  payload: BaseRentPayload,
  termId: string
): StepWithSource[] {
  if (payload.rent.kind === "simple") {
    return [
      {
        startMonth: 1,
        endMonth: SIMPLE_RENT_END_SENTINEL,
        amountPerRSFYear: payload.rent.amountPerRSFYear,
        termId,
      },
    ];
  }
  return payload.rent.steps.map((step) => ({
    startMonth: step.startMonth,
    endMonth: step.endMonth,
    amountPerRSFYear: step.amountPerRSFYear,
    termId,
    evidenceSpan: step.observationRef?.evidenceSpan,
  }));
}

/** Deduplicate steps by (startMonth, endMonth, amountPerRSFYear) key. */
function deduplicateSteps(steps: StepWithSource[]): StepWithSource[] {
  const seen = new Map<string, StepWithSource>();
  for (const s of steps) {
    const key = `${s.startMonth}:${s.endMonth}:${s.amountPerRSFYear}`;
    if (!seen.has(key)) {
      seen.set(key, s);
    }
  }
  return [...seen.values()];
}

/**
 * Returns true when any two steps overlap on the same time range but have
 * different amounts — indicating an irreconcilable contradiction.
 */
function hasStepConflicts(steps: StepWithSource[]): boolean {
  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      const a = steps[i]!;
      const b = steps[j]!;
      if (
        rangesOverlap(a, b) &&
        a.amountPerRSFYear !== b.amountPerRSFYear
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Resolve BASE_RENT for observations from the same side and round.
 *
 * - Single observation: return its payload with real provenance.
 * - Multiple observations with identical payloads (e.g., n07 — each step
 *   observation carries the full schedule): deduplicate and return that
 *   schedule with all contributing term IDs.
 * - Multiple observations with non-overlapping steps: assemble into a
 *   stepped schedule.
 * - Overlapping same-period different-amount observations: CONFLICT.
 */
function resolveBaseRent(currentObs: Obs[]): SideResult | undefined {
  const withPayloads = currentObs
    .map(({ term }) => ({
      termId: term.id,
      payload: getPayload(term, "BASE_RENT") as BaseRentPayload | null,
    }))
    .filter(
      (x): x is { termId: string; payload: BaseRentPayload } =>
        x.payload !== null
    );

  if (withPayloads.length === 0) return undefined;

  // Single observation: return with real provenance attached
  if (withPayloads.length === 1) {
    const { termId, payload } = withPayloads[0]!;
    return {
      payload: attachRealProvenance(payload, termId),
      observationIds: [termId],
    };
  }

  // Multiple observations: collect all steps, deduplicate, then check for conflicts
  const allSteps: StepWithSource[] = withPayloads.flatMap(({ termId, payload }) =>
    stepsFromPayload(payload, termId)
  );

  const uniqueSteps = deduplicateSteps(allSteps);

  // Conflict: two different amounts for the same (overlapping) time range
  if (hasStepConflicts(uniqueSteps)) {
    // Build candidates from unique payload groups
    const groups = groupByPayload(withPayloads);
    return {
      status: "CONFLICT",
      candidates: groups.map(({ termId, payload, allTermIds }) => ({
        payload: attachRealProvenance(payload, termId),
        observationIds: allTermIds,
      })),
    };
  }

  // No conflicts — assemble the schedule
  const sorted = [...uniqueSteps].sort((a, b) => a.startMonth - b.startMonth);
  const allTermIds = withPayloads.map((p) => p.termId);

  // All steps came from simple-rent observations (sentinel end month)
  const isAllSimple =
    sorted.length === 1 && sorted[0]!.endMonth === SIMPLE_RENT_END_SENTINEL;

  // Get rentStructure and inlineEscalation from the first payload that has them
  const rentStructure = withPayloads.find(
    (p) => p.payload.rent.rentStructure
  )?.payload.rent.rentStructure;
  const inlineEscalation = withPayloads.find(
    (p) => p.payload.inlineEscalation
  )?.payload.inlineEscalation;

  if (isAllSimple) {
    // All observations agreed on a simple rent — return as simple
    const origPayload = withPayloads[0]!.payload;
    const simplePayload: CREStructuredPayload = {
      termType: "BASE_RENT",
      rent: {
        kind: "simple",
        amountPerRSFYear: sorted[0]!.amountPerRSFYear,
        ...(rentStructure ? { rentStructure } : {}),
      },
      ...(inlineEscalation ? { inlineEscalation } : {}),
    };
    // If the original was already a simple rent (no sentinel confusion), prefer it
    return {
      payload:
        origPayload.rent.kind === "simple"
          ? origPayload
          : simplePayload,
      observationIds: allTermIds,
    };
  }

  // Build assembled stepped schedule with per-step provenance
  const assembledSteps: RentStep[] = sorted
    .filter((sw) => sw.endMonth !== SIMPLE_RENT_END_SENTINEL)
    .map((sw) => ({
      startMonth: sw.startMonth,
      endMonth: sw.endMonth,
      amountPerRSFYear: sw.amountPerRSFYear,
      observationRef: {
        observationId: sw.termId,
        ...(sw.evidenceSpan ? { evidenceSpan: sw.evidenceSpan } : {}),
      },
    }));

  const steppedPayload: CREStructuredPayload = {
    termType: "BASE_RENT",
    rent: {
      kind: "stepped",
      steps: assembledSteps,
      ...(rentStructure ? { rentStructure } : {}),
    },
    ...(inlineEscalation ? { inlineEscalation } : {}),
  };

  return { payload: steppedPayload, observationIds: allTermIds };
}

// ─── FREE_RENT period aggregation ─────────────────────────────────────────────

interface PeriodWithSource {
  startMonth: number;
  endMonth: number;
  abatementType: "FULL" | "PARTIAL";
  partialPct?: number;
  termId: string;
  evidenceSpan?: string;
}

/**
 * Extract PeriodWithSource entries from a FreeRentPayload.
 * Contiguous periods are unfolded to a single range for assembly purposes.
 */
function periodsFromPayload(
  payload: FreeRentPayload,
  termId: string
): PeriodWithSource[] {
  const ab = payload.abatement;
  if (ab.kind === "contiguous") {
    return [
      {
        startMonth: 1,
        endMonth: ab.months,
        abatementType: ab.abatementType,
        partialPct: ab.partialPct,
        termId,
      },
    ];
  }
  return ab.periods.map((p) => ({
    startMonth: p.startMonth,
    endMonth: p.endMonth,
    abatementType: p.abatementType,
    partialPct: p.partialPct,
    termId,
    evidenceSpan: p.observationRef?.evidenceSpan,
  }));
}

/** Deduplicate periods by (startMonth, endMonth, abatementType, partialPct). */
function deduplicatePeriods(periods: PeriodWithSource[]): PeriodWithSource[] {
  const seen = new Map<string, PeriodWithSource>();
  for (const p of periods) {
    const key = `${p.startMonth}:${p.endMonth}:${p.abatementType}:${p.partialPct ?? ""}`;
    if (!seen.has(key)) {
      seen.set(key, p);
    }
  }
  return [...seen.values()];
}

/**
 * Returns true when any two periods overlap on the same time range but have
 * different abatement type or percentage — indicating a contradiction.
 */
function hasPeriodConflicts(periods: PeriodWithSource[]): boolean {
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const a = periods[i]!;
      const b = periods[j]!;
      if (
        rangesOverlap(a, b) &&
        (a.abatementType !== b.abatementType || a.partialPct !== b.partialPct)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Compute total full-abatement months from a period list. */
function computeEquivalentFullMonths(periods: PeriodWithSource[]): number {
  return periods
    .filter((p) => p.abatementType === "FULL")
    .reduce((sum, p) => sum + (p.endMonth - p.startMonth + 1), 0);
}

/**
 * Resolve FREE_RENT for observations from the same side and round.
 *
 * - Single contiguous observation: preserved as ContiguousFreeRent.
 * - Single irregular observation: preserved as IrregularFreeRent with all
 *   periods and observationRefs replaced by the real term ID.
 * - Multiple observations with identical payloads: deduplicated.
 * - Multiple non-overlapping period sets: assembled into IrregularFreeRent.
 * - Overlapping conflicting periods: CONFLICT.
 *
 * equivalentFullMonths is always recomputed from the assembled periods.
 * It is a derived summary and must never replace the actual period list.
 */
function resolveFreeRent(currentObs: Obs[]): SideResult | undefined {
  const withPayloads = currentObs
    .map(({ term }) => ({
      termId: term.id,
      payload: getPayload(term, "FREE_RENT") as FreeRentPayload | null,
    }))
    .filter(
      (x): x is { termId: string; payload: FreeRentPayload } =>
        x.payload !== null
    );

  if (withPayloads.length === 0) return undefined;

  // Single observation: return with real provenance
  if (withPayloads.length === 1) {
    const { termId, payload } = withPayloads[0]!;
    return {
      payload: attachRealProvenance(payload, termId),
      observationIds: [termId],
    };
  }

  // Multiple: collect and deduplicate all periods
  const allPeriods: PeriodWithSource[] = withPayloads.flatMap(({ termId, payload }) =>
    periodsFromPayload(payload, termId)
  );

  const uniquePeriods = deduplicatePeriods(allPeriods);

  if (hasPeriodConflicts(uniquePeriods)) {
    const groups = groupByPayload(withPayloads);
    return {
      status: "CONFLICT",
      candidates: groups.map(({ termId, payload, allTermIds }) => ({
        payload: attachRealProvenance(payload, termId),
        observationIds: allTermIds,
      })),
    };
  }

  // Assemble non-conflicting periods into IrregularFreeRent
  const sorted = [...uniquePeriods].sort((a, b) => a.startMonth - b.startMonth);
  const allTermIds = withPayloads.map((p) => p.termId);
  const scope = withPayloads[0]!.payload.scope;

  // Single period from a contiguous-origin observation: keep as contiguous
  if (sorted.length === 1) {
    const { termId, payload } = withPayloads[0]!;
    if (payload.abatement.kind === "contiguous") {
      return {
        payload: attachRealProvenance(payload, termId),
        observationIds: allTermIds,
      };
    }
  }

  // Build IrregularFreeRent with real per-period provenance
  const assembledPeriods: AbatementPeriod[] = sorted.map((pw) => ({
    startMonth: pw.startMonth,
    endMonth: pw.endMonth,
    abatementType: pw.abatementType,
    ...(pw.partialPct !== undefined ? { partialPct: pw.partialPct } : {}),
    observationRef: {
      observationId: pw.termId,
      ...(pw.evidenceSpan ? { evidenceSpan: pw.evidenceSpan } : {}),
    },
  }));

  const assembled: CREStructuredPayload = {
    termType: "FREE_RENT",
    abatement: {
      kind: "irregular",
      periods: assembledPeriods,
      equivalentFullMonths: computeEquivalentFullMonths(sorted),
    },
    scope,
  };

  return { payload: assembled, observationIds: allTermIds };
}

// ─── Generic scalar / struct / rights resolver ────────────────────────────────

/**
 * Resolve any term type that is authoritative as an atomic unit:
 * TI_ALLOWANCE, OPERATING_EXPENSES, ANNUAL_ESCALATION, PARKING,
 * COMMENCEMENT_DATE, RENEWAL_OPTIONS, TERMINATION_RIGHTS, EXPANSION_RIGHTS.
 *
 * Latest observation wins for carry-forward. Multiple distinct payloads
 * from the same side and round are irreconcilable → CONFLICT.
 *
 * Rights (RENEWAL_OPTIONS, TERMINATION_RIGHTS, EXPANSION_RIGHTS) use this
 * same path because they must be replaced atomically — a new proposal
 * supersedes the prior right as a whole, never field-by-field.
 */
function resolveScalarOrRights(
  currentObs: Obs[],
  canonicalType: CRETermType
): SideResult | undefined {
  const withPayloads = currentObs
    .map(({ term }) => ({
      termId: term.id,
      payload: getPayload(term, canonicalType),
    }))
    .filter(
      (x): x is { termId: string; payload: CREStructuredPayload } =>
        x.payload !== null
    );

  if (withPayloads.length === 0) return undefined;

  const groups = groupByPayload(withPayloads);

  if (groups.length === 1) {
    const { payload, allTermIds } = groups[0]!;
    return { payload, observationIds: allTermIds };
  }

  // Multiple distinct payloads → CONFLICT
  return {
    status: "CONFLICT",
    candidates: groups.map(({ payload, allTermIds }) => ({
      payload,
      observationIds: allTermIds,
    })),
  };
}

// ─── Type dispatcher ──────────────────────────────────────────────────────────

function resolveCurrentObservations(
  currentObs: Obs[],
  canonicalType: CRETermType
): SideResult | undefined {
  if (currentObs.length === 0) return undefined;

  switch (canonicalType) {
    case "BASE_RENT":
      return resolveBaseRent(currentObs);
    case "FREE_RENT":
      return resolveFreeRent(currentObs);
    // Rights: atomically replaced
    case "RENEWAL_OPTIONS":
    case "TERMINATION_RIGHTS":
    case "EXPANSION_RIGHTS":
    // Scalar/struct: latest observation wins
    case "TI_ALLOWANCE":
    case "OPERATING_EXPENSES":
    case "ANNUAL_ESCALATION":
    case "PARKING":
    case "COMMENCEMENT_DATE":
      return resolveScalarOrRights(currentObs, canonicalType);
    default:
      return undefined;
  }
}

// ─── Side resolution (carry-forward + supersession) ──────────────────────────

/**
 * Derive the current structured position for one negotiation side.
 *
 * CARRY-FORWARD: The most recent round where this side has an active
 * (PROPOSED / AGREED / UNRESOLVED) observation for this canonicalType is
 * used as the current position. Subsequent rounds that omit this term do
 * not erase the position.
 *
 * SUPERSESSION: A newer active observation from the same side supersedes
 * that side's prior position for this term type (not the other side's).
 *
 * WITHDRAWAL: If the side's last observation has status WITHDRAWN, their
 * position is cleared.
 */
function resolveSide(
  allObs: Obs[],
  side: "TENANT" | "LANDLORD",
  canonicalType: CRETermType
): SideResult | undefined {
  const sideObs = allObs.filter(({ term }) => term.side === side);
  if (sideObs.length === 0) return undefined;

  // If the chronologically last observation for this side is WITHDRAWN,
  // clear that side's position entirely.
  const lastForSide = sideObs[sideObs.length - 1]!;
  if (lastForSide.term.status === "WITHDRAWN") return undefined;

  // Active statuses: PROPOSED, AGREED, UNRESOLVED (contradictory candidates
  // remain visible; they appear as CONFLICT in the result).
  const active = sideObs.filter(({ term }) =>
    (["PROPOSED", "AGREED", "UNRESOLVED"] as string[]).includes(term.status)
  );
  if (active.length === 0) return undefined;

  // Latest round where this side has any active observation
  const latestRoundId = active[active.length - 1]!.round.id;
  const currentObs = active.filter(({ round }) => round.id === latestRoundId);

  return resolveCurrentObservations(currentObs, canonicalType);
}

// ─── Agreement resolution ─────────────────────────────────────────────────────

/**
 * Resolve an explicitly agreed canonical state.
 *
 * Agreement is present when:
 * 1. At least one observation across either side has status === "AGREED".
 * 2. No later PROPOSED or UNRESOLVED observation supersedes it.
 *
 * Matching structured values between sides do NOT constitute agreement.
 * Only explicit assent evidence (status === "AGREED") does.
 */
function resolveAgreement(
  allObs: Obs[],
  canonicalType: CRETermType
): { payload: CREStructuredPayload; observationIds: string[] } | undefined {
  const lastAgreedIdx = [...allObs].findLastIndex(
    ({ term }) => term.status === "AGREED"
  );
  if (lastAgreedIdx < 0) return undefined;

  // If any later observation is PROPOSED or UNRESOLVED, the agreement is no
  // longer current — a new proposal has reopened this term.
  const afterAgreed = allObs.slice(lastAgreedIdx + 1);
  if (
    afterAgreed.some(({ term }) =>
      (["PROPOSED", "UNRESOLVED"] as string[]).includes(term.status)
    )
  ) {
    return undefined;
  }

  const agreedTerm = allObs[lastAgreedIdx]!.term;
  const payload = getPayload(agreedTerm, canonicalType);
  if (!payload) return undefined;

  return {
    payload: attachRealProvenance(payload, agreedTerm.id),
    observationIds: [agreedTerm.id],
  };
}

// ─── Overall status derivation ────────────────────────────────────────────────

function deriveStatus(params: {
  tenantResult: SideResult | undefined;
  landlordResult: SideResult | undefined;
  agreed:
    | { payload: CREStructuredPayload; observationIds: string[] }
    | undefined;
  allObs: Obs[];
}): NegotiationTermStatus {
  const { tenantResult, landlordResult, agreed, allObs } = params;

  if (agreed) return "AGREED";

  // A within-round conflict on either side → overall UNRESOLVED
  if (
    (tenantResult && isSideConflict(tenantResult)) ||
    (landlordResult && isSideConflict(landlordResult))
  ) {
    return "UNRESOLVED";
  }

  // Derive from the most recent overall observation's status
  const latestObs = allObs[allObs.length - 1]?.term;
  if (!latestObs) return "NOT_MENTIONED";

  if (latestObs.status === "REJECTED") return "REJECTED";
  if (latestObs.status === "WITHDRAWN") return "WITHDRAWN";

  // Both sides have active positions but have not agreed → still open
  if (tenantResult && landlordResult) return "UNRESOLVED";

  // One side has a position. Preserve UNRESOLVED only when every observation
  // that contributed to that position is itself UNRESOLVED. A one-sided
  // PROPOSED observation stays PROPOSED.
  const onlySide = tenantResult ?? landlordResult;
  if (onlySide) {
    if (!isSideConflict(onlySide)) {
      const ids = new Set(onlySide.observationIds);
      const statuses = allObs
        .filter(({ term }) => ids.has(term.id))
        .map(({ term }) => term.status);
      if (
        statuses.length > 0 &&
        statuses.every((status) => status === "UNRESOLVED")
      ) {
        return "UNRESOLVED";
      }
    }
    return "PROPOSED";
  }

  return "NOT_MENTIONED";
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Derive the canonical structured current position for each negotiation side
 * and term type from a sequence of immutable NegotiationTerm observations.
 *
 * ## Guarantees
 *
 * IMMUTABILITY: No input observation or round is ever mutated. All returned
 *   objects are freshly created derived values.
 *
 * CARRY-FORWARD: A side's last active structured position carries forward
 *   through rounds that omit this term. Omission ≠ withdrawal.
 *
 * SUPERSESSION: A newer observation from a side supersedes that side's prior
 *   position for this term, never the other side's.
 *
 * CONFLICT TRANSPARENCY: Irreconcilable same-side same-round alternatives
 *   surface as an explicit CONFLICT with all candidates, not a silent pick.
 *
 * PROVENANCE: observationIds always reference real NegotiationTerm.id values.
 *   "pending" placeholder IDs written by the extraction model are replaced
 *   deterministically with the enclosing term's real ID.
 *
 * BACKWARD COMPATIBILITY: The existing resolveCurrentState function is not
 *   replaced. Call resolveStructuredState when a CREStructuredPayload is
 *   needed; continue calling resolveCurrentState for flat field access.
 *
 * ## Parameters
 *
 * @param rounds - Deal rounds whose terms may carry structured payloads.
 *   NegotiationTermRecordV2[] is a structural subtype of TermWithPayload[];
 *   plain NegotiationTermRecord arrays also accepted (payloads degrade to null).
 * @param canonicalType - The CRE term type to resolve.
 * @param asOf - Optional cutoff date; rounds after this date are excluded.
 */
export function resolveStructuredState(params: {
  rounds: RoundWithPayload[];
  canonicalType: CRETermType;
  asOf?: Date;
}): StructuredCurrentTermState {
  const { rounds, canonicalType, asOf } = params;

  // chronologicalRounds accepts NegotiationRoundRecord[]; RoundWithPayload is
  // structurally compatible (terms are a superset).
  const sorted = chronologicalRounds(rounds as unknown as NegotiationRoundRecord[]);
  const filtered: RoundWithPayload[] = asOf
    ? (sorted as unknown as RoundWithPayload[]).filter(
        (r) => r.documentDate <= asOf
      )
    : (sorted as unknown as RoundWithPayload[]);

  // termObservations also accepts NegotiationRoundRecord[]
  const allObs = termObservations(
    filtered as unknown as NegotiationRoundRecord[],
    canonicalType
  ) as Obs[];

  if (allObs.length === 0) {
    return {
      canonicalType,
      status: "NOT_MENTIONED",
      sourceObservationIds: [],
    };
  }

  const tenantResult = resolveSide(allObs, "TENANT", canonicalType);
  const landlordResult = resolveSide(allObs, "LANDLORD", canonicalType);
  const agreed = resolveAgreement(allObs, canonicalType);

  const status = deriveStatus({ tenantResult, landlordResult, agreed, allObs });

  // sourceObservationIds covers ALL visible observations (including historical /
  // superseded) so provenance drill-down always has a complete audit trail.
  const sourceObservationIds = [...new Set(allObs.map(({ term }) => term.id))];

  return {
    canonicalType,
    status,
    ...(tenantResult !== undefined ? { tenant: tenantResult } : {}),
    ...(landlordResult !== undefined ? { landlord: landlordResult } : {}),
    ...(agreed !== undefined ? { agreed } : {}),
    sourceObservationIds,
  };
}
