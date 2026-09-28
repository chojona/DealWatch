/**
 * evals/negotiation/v2/scoring.ts
 *
 * Semantic scoring for CRE structured payloads.
 *
 * IMPORTANT: These functions compare CRE-semantic dimensions, NOT JSON strings.
 * A stepped rent with 3 correct steps but different ordering still scores
 * correctly; a single-step rent masquerading as a 3-step one does not.
 *
 * Partial credit rules:
 *   BASE_RENT stepped  — each step is scored independently (start, end, amount)
 *   FREE_RENT irregular — each period is scored independently (start, end, type, pct)
 *   RENEWAL_OPTIONS    — each option is scored independently (duration, pricing, notice)
 *   All others         — field-by-field scoring with explicit weights
 *
 * Score = rawScore / maxRawScore, normalized to [0, 1].
 */

import type {
  AnnualEscalationPayload,
  BaseRentPayload,
  CommencementDatePayload,
  CREStructuredPayload,
  ExpansionRightsPayload,
  FreeRentPayload,
  OperatingExpensesPayload,
  ParkingPayload,
  RenewalOptionsPayload,
  TerminationRightsPayload,
  TIAllowancePayload,
} from "@/lib/ai/negotiation/payloads";
import type { SemanticComponentScore, SemanticScore } from "./types";

// ─── Shared utilities ──────────────────────────────────────────────────────────

function aggregateComponents(
  components: Record<string, SemanticComponentScore>
): SemanticScore {
  const entries = Object.entries(components);
  const rawScore = entries.reduce((s, [, c]) => s + c.score, 0);
  const maxRawScore = entries.reduce((s, [, c]) => s + c.maxScore, 0);
  return {
    score: maxRawScore === 0 ? 1 : rawScore / maxRawScore,
    rawScore,
    maxRawScore,
    components,
  };
}

/** Numeric closeness with a minimum absolute tolerance of 0.001. */
function numClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * 0.001);
}

/** Fuzzy string containment match (case-insensitive, trimmed). */
function strContains(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  return al.includes(bl) || bl.includes(al);
}

/**
 * Partial-credit string-list match. Each expected string that appears in any
 * actual string (containment, either direction) scores 1. Used for conditions
 * and operating-expense exclusions. Empty expected lists are not scored.
 */
function scoreStringList(
  actual: string[],
  expected: string[],
  label: string
): SemanticComponentScore | null {
  if (expected.length === 0) return null;
  let matched = 0;
  for (const exp of expected) {
    if (actual.some((act) => strContains(act, exp))) matched += 1;
  }
  return {
    score: matched,
    maxScore: expected.length,
    note: `${matched}/${expected.length} ${label}`,
  };
}

function maybeAdd(
  components: Record<string, SemanticComponentScore>,
  key: string,
  value: SemanticComponentScore | null
) {
  if (value) components[key] = value;
}

// ─── BASE_RENT ────────────────────────────────────────────────────────────────

/**
 * Score BASE_RENT payload.
 *
 * Components:
 *   classification (2 pts) — simple vs stepped must match
 *   amount         (3 pts) — $/RSF/yr within tolerance      [simple only]
 *   rentStructure  (1 pt)  — NNN/GROSS/etc                  [when expected]
 *   stepCount      (1 pt)  — number of steps match          [stepped only]
 *   steps          (N*3 pts)— per-step: startMonth + endMonth + amount
 *
 * Partial credit: each step is scored independently.
 * Do not award full credit because only the final-step amount matches.
 */
export function scoreBaseRent(
  actual: BaseRentPayload,
  expected: BaseRentPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  const sameKind = actual.rent.kind === expected.rent.kind;
  components.classification = {
    score: sameKind ? 2 : 0,
    maxScore: 2,
    note: `expected ${expected.rent.kind}, got ${actual.rent.kind}`,
  };

  if (expected.rent.kind === "simple") {
    const expAmt = expected.rent.amountPerRSFYear;
    const actAmt =
      actual.rent.kind === "simple" ? actual.rent.amountPerRSFYear : 0;
    components.amount = {
      score: numClose(actAmt, expAmt) ? 3 : 0,
      maxScore: 3,
      note: `expected $${expAmt}, got $${actAmt}`,
    };
    if (expected.rent.rentStructure !== undefined) {
      components.rentStructure = {
        score:
          actual.rent.kind === "simple" &&
          actual.rent.rentStructure === expected.rent.rentStructure
            ? 1
            : 0,
        maxScore: 1,
      };
    }
  } else {
    // stepped
    const expSteps = expected.rent.steps;
    const actSteps =
      actual.rent.kind === "stepped" ? actual.rent.steps : [];

    components.stepCount = {
      score: actSteps.length === expSteps.length ? 1 : 0,
      maxScore: 1,
      note: `expected ${expSteps.length} steps, got ${actSteps.length}`,
    };

    // Each expected step: 3 sub-points (startMonth, endMonth, amountPerRSFYear)
    let stepRaw = 0;
    const stepMax = expSteps.length * 3;

    for (const expStep of expSteps) {
      let bestPts = 0;
      for (const actStep of actSteps) {
        let pts = 0;
        if (actStep.startMonth === expStep.startMonth) pts += 1;
        if (actStep.endMonth === expStep.endMonth) pts += 1;
        if (numClose(actStep.amountPerRSFYear, expStep.amountPerRSFYear))
          pts += 1;
        bestPts = Math.max(bestPts, pts);
      }
      stepRaw += bestPts;
    }

    components.steps = {
      score: stepRaw,
      maxScore: stepMax,
      note: `${stepRaw}/${stepMax} step-component points`,
    };

    if (expected.rent.rentStructure !== undefined) {
      components.rentStructure = {
        score:
          actual.rent.kind === "stepped" &&
          actual.rent.rentStructure === expected.rent.rentStructure
            ? 1
            : 0,
        maxScore: 1,
      };
    }
  }

  return aggregateComponents(components);
}

// ─── FREE_RENT ────────────────────────────────────────────────────────────────

/**
 * Score FREE_RENT payload.
 *
 * Components:
 *   abatementKind     (2 pts) — contiguous vs irregular must match
 *   scope             (1 pt)  — BASE_RENT_ONLY / ALL_CHARGES / null
 *   months            (2 pts) — for contiguous: total months
 *   abatementType     (1 pt)  — FULL vs PARTIAL (contiguous)
 *   partialPct        (1 pt)  — % when PARTIAL (contiguous)
 *   periodCount       (1 pt)  — number of distinct periods (irregular)
 *   equivalentFullMonths (0.5)— derived metric: separate, lower weight
 *   periods           (N*4 pts)— per-period: start + end + type + pct
 *
 * Partial credit: each period is scored independently.
 * Do not award full semantic correctness because total months match.
 */
export function scoreFreeRent(
  actual: FreeRentPayload,
  expected: FreeRentPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  const sameKind = actual.abatement.kind === expected.abatement.kind;
  components.abatementKind = {
    score: sameKind ? 2 : 0,
    maxScore: 2,
    note: `expected ${expected.abatement.kind}, got ${actual.abatement.kind}`,
  };

  components.scope = {
    score: actual.scope === expected.scope ? 1 : 0,
    maxScore: 1,
  };

  if (expected.abatement.kind === "contiguous") {
    const ea = expected.abatement;
    const aa =
      actual.abatement.kind === "contiguous" ? actual.abatement : null;

    components.months = {
      score: aa && aa.months === ea.months ? 2 : 0,
      maxScore: 2,
      note: `expected ${ea.months} months, got ${aa?.months ?? "N/A"}`,
    };
    components.abatementType = {
      score: aa && aa.abatementType === ea.abatementType ? 1 : 0,
      maxScore: 1,
    };
    if (ea.partialPct !== undefined) {
      components.partialPct = {
        score:
          aa && numClose(aa.partialPct ?? -1, ea.partialPct)
            ? 1
            : 0,
        maxScore: 1,
      };
    }
  } else {
    // irregular
    const ea = expected.abatement;
    const aa =
      actual.abatement.kind === "irregular" ? actual.abatement : null;

    components.periodCount = {
      score: aa && aa.periods.length === ea.periods.length ? 1 : 0,
      maxScore: 1,
      note: `expected ${ea.periods.length} periods, got ${aa?.periods.length ?? 0}`,
    };

    // equivalentFullMonths is a derived summary: lower weight so matching
    // total alone does not inflate the score.
    components.equivalentFullMonths = {
      score:
        aa && numClose(aa.equivalentFullMonths, ea.equivalentFullMonths)
          ? 0.5
          : 0,
      maxScore: 0.5,
      note: "derived metric — does not substitute for period-level correctness",
    };

    // Per-period: start (1) + end (1) + abatementType (1) + partialPct (1 if PARTIAL)
    let periodRaw = 0;
    let periodMax = 0;

    for (const expPeriod of ea.periods) {
      const isPartial = expPeriod.abatementType === "PARTIAL";
      const ptsPerPeriod = 3 + (isPartial ? 1 : 0);
      periodMax += ptsPerPeriod;

      let bestScore = 0;
      for (const actPeriod of aa?.periods ?? []) {
        let s = 0;
        if (actPeriod.startMonth === expPeriod.startMonth) s += 1;
        if (actPeriod.endMonth === expPeriod.endMonth) s += 1;
        if (actPeriod.abatementType === expPeriod.abatementType) s += 1;
        if (
          isPartial &&
          numClose(actPeriod.partialPct ?? -1, expPeriod.partialPct ?? -1)
        )
          s += 1;
        bestScore = Math.max(bestScore, s);
      }
      periodRaw += bestScore;
    }

    components.periods = {
      score: periodRaw,
      maxScore: periodMax,
      note: `${periodRaw}/${periodMax} period-component points`,
    };
  }

  return aggregateComponents(components);
}

// ─── RENEWAL_OPTIONS ─────────────────────────────────────────────────────────

/**
 * Score RENEWAL_OPTIONS payload.
 *
 * Components:
 *   optionCount (2 pts) — number of renewal options
 *   options     (N*3 pts) — per-option: durationMonths + pricingMethod + (pricingValue + noticeLatest)
 */
export function scoreRenewalOptions(
  actual: RenewalOptionsPayload,
  expected: RenewalOptionsPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  components.optionCount = {
    score: actual.options.length === expected.options.length ? 2 : 0,
    maxScore: 2,
    note: `expected ${expected.options.length} options, got ${actual.options.length}`,
  };

  let optRaw = 0;
  const optMax = expected.options.length * 3;

  for (const expOpt of expected.options) {
    let bestPts = 0;
    for (const actOpt of actual.options) {
      let pts = 0;
      if (actOpt.durationMonths === expOpt.durationMonths) pts += 1;
      if (actOpt.pricingMethod === expOpt.pricingMethod) pts += 1;
      if (
        expOpt.pricingValue !== undefined &&
        actOpt.pricingValue !== undefined &&
        numClose(actOpt.pricingValue, expOpt.pricingValue)
      )
        pts += 0.5;
      if (
        expOpt.noticeLatestMonths !== undefined &&
        actOpt.noticeLatestMonths !== undefined &&
        actOpt.noticeLatestMonths === expOpt.noticeLatestMonths
      )
        pts += 0.5;
      bestPts = Math.max(bestPts, pts);
    }
    optRaw += bestPts;
  }

  components.options = {
    score: optRaw,
    maxScore: optMax,
    note: `${optRaw}/${optMax} option-component points`,
  };

  const expectedConditions = expected.options.flatMap((o) => o.conditions);
  const actualConditions = actual.options.flatMap((o) => o.conditions);
  maybeAdd(
    components,
    "conditions",
    scoreStringList(actualConditions, expectedConditions, "conditions")
  );

  return aggregateComponents(components);
}

// ─── TERMINATION_RIGHTS ──────────────────────────────────────────────────────

/**
 * Score TERMINATION_RIGHTS payload.
 *
 * Components:
 *   rightPresence      (1 pt) — right !== null when expected
 *   eligibleAfterMonth (2 pts)— timing by month
 *   eligibleAfterYear  (2 pts)— timing by year (when month not present)
 *   noticeMonths       (2 pts)— required notice period
 *   feeKind            (2 pts)— termination fee structure kind
 */
export function scoreTerminationRights(
  actual: TerminationRightsPayload,
  expected: TerminationRightsPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  const expHasRight = expected.right !== null;
  const actHasRight = actual.right !== null;
  components.rightPresence = {
    score: expHasRight === actHasRight ? 1 : 0,
    maxScore: 1,
    note: expHasRight ? "right expected" : "right expected to be null",
  };

  if (expHasRight && actHasRight && expected.right && actual.right) {
    const er = expected.right;
    const ar = actual.right;

    if (er.eligibleAfterMonth !== null) {
      components.eligibleAfterMonth = {
        score:
          ar.eligibleAfterMonth !== null &&
          ar.eligibleAfterMonth === er.eligibleAfterMonth
            ? 2
            : 0,
        maxScore: 2,
        note: `expected month ${er.eligibleAfterMonth}, got ${ar.eligibleAfterMonth ?? "null"}`,
      };
    } else if (er.eligibleAfterYear !== null) {
      components.eligibleAfterYear = {
        score:
          ar.eligibleAfterYear !== null &&
          ar.eligibleAfterYear === er.eligibleAfterYear
            ? 2
            : 0,
        maxScore: 2,
        note: `expected year ${er.eligibleAfterYear}, got ${ar.eligibleAfterYear ?? "null"}`,
      };
    }

    if (er.noticeMonths !== null) {
      components.noticeMonths = {
        score:
          ar.noticeMonths !== null && ar.noticeMonths === er.noticeMonths
            ? 2
            : 0,
        maxScore: 2,
        note: `expected ${er.noticeMonths} months notice, got ${ar.noticeMonths ?? "null"}`,
      };
    }

    if (er.terminationFee !== null) {
      components.feeKind = {
        score:
          ar.terminationFee !== null &&
          ar.terminationFee.kind === er.terminationFee.kind
            ? 2
            : 0,
        maxScore: 2,
        note: `expected fee kind "${er.terminationFee.kind}", got "${ar.terminationFee?.kind ?? "null"}"`,
      };
      if (
        er.terminationFee.kind === "months_rent" &&
        ar.terminationFee?.kind === "months_rent"
      ) {
        components.feeMonths = {
          score: ar.terminationFee.months === er.terminationFee.months ? 1 : 0,
          maxScore: 1,
        };
      }
      if (
        er.terminationFee.kind === "unamortized_costs" &&
        ar.terminationFee?.kind === "unamortized_costs"
      ) {
        components.feeDescription = {
          score: strContains(
            ar.terminationFee.description,
            er.terminationFee.description
          )
            ? 1
            : 0,
          maxScore: 1,
        };
      }
    }

    maybeAdd(
      components,
      "conditions",
      scoreStringList(ar.conditions, er.conditions, "conditions")
    );
  }

  return aggregateComponents(components);
}

// ─── PARKING ─────────────────────────────────────────────────────────────────

/**
 * Score PARKING payload.
 *
 * Components scored independently:
 *   spacesCount         (2 pts)
 *   ratePerSpacePerMonth(2 pts) — when expected
 *   rateType            (1 pt)  — MARKET / FIXED / FREE / PREVAILING
 *   reserved            (1 pt)  — when expected
 */
export function scoreParking(
  actual: ParkingPayload,
  expected: ParkingPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  if (expected.spacesCount !== null) {
    components.spacesCount = {
      score:
        actual.spacesCount !== null &&
        actual.spacesCount === expected.spacesCount
          ? 2
          : 0,
      maxScore: 2,
      note: `expected ${expected.spacesCount} spaces, got ${actual.spacesCount ?? "null"}`,
    };
  }

  if (expected.ratePerSpacePerMonth !== null) {
    components.ratePerSpacePerMonth = {
      score:
        actual.ratePerSpacePerMonth !== null &&
        numClose(actual.ratePerSpacePerMonth, expected.ratePerSpacePerMonth)
          ? 2
          : 0,
      maxScore: 2,
      note: `expected $${expected.ratePerSpacePerMonth}/space/mo`,
    };
  }

  if (expected.rateType !== null) {
    components.rateType = {
      score: actual.rateType === expected.rateType ? 1 : 0,
      maxScore: 1,
      note: `expected "${expected.rateType}", got "${actual.rateType ?? "null"}"`,
    };
  }

  if (expected.reserved !== null) {
    components.reserved = {
      score: actual.reserved === expected.reserved ? 1 : 0,
      maxScore: 1,
    };
  }

  maybeAdd(
    components,
    "conditions",
    scoreStringList(actual.conditions, expected.conditions, "conditions")
  );

  return aggregateComponents(components);
}

// ─── OPERATING_EXPENSES ──────────────────────────────────────────────────────

/**
 * Score OPERATING_EXPENSES payload.
 *
 * Components:
 *   structure              (2 pts) — GROSS / NNN / etc.
 *   controllableCapPct     (2 pts) — % cap when expected
 *   taxesInsuranceUncapped (1 pt)  — when expected
 */
export function scoreOperatingExpenses(
  actual: OperatingExpensesPayload,
  expected: OperatingExpensesPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  components.structure = {
    score: actual.structure === expected.structure ? 2 : 0,
    maxScore: 2,
  };

  if (expected.controllableCapPct !== null) {
    components.controllableCapPct = {
      score:
        actual.controllableCapPct !== null &&
        numClose(actual.controllableCapPct, expected.controllableCapPct)
          ? 2
          : 0,
      maxScore: 2,
      note: `expected ${expected.controllableCapPct}% cap`,
    };
  }

  if (expected.taxesInsuranceUncapped !== null) {
    components.taxesInsuranceUncapped = {
      score:
        actual.taxesInsuranceUncapped === expected.taxesInsuranceUncapped
          ? 1
          : 0,
      maxScore: 1,
    };
  }

  maybeAdd(
    components,
    "exclusions",
    scoreStringList(actual.exclusions, expected.exclusions, "exclusions")
  );

  return aggregateComponents(components);
}

// ─── ANNUAL_ESCALATION ───────────────────────────────────────────────────────

/**
 * Score ANNUAL_ESCALATION payload.
 *
 * Components:
 *   frequency          (1 pt)  — ANNUAL / OTHER
 *   escalationKind     (2 pts) — percent / fixed / cpi / greater_of / other
 *   escalationPct      (2 pts) — when kind is "percent"
 *   cpiCap             (1 pt)  — when kind is "cpi" and cap expected
 *   firstEscalationMonth(1 pt) — when expected
 */
export function scoreAnnualEscalation(
  actual: AnnualEscalationPayload,
  expected: AnnualEscalationPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  components.frequency = {
    score: actual.frequency === expected.frequency ? 1 : 0,
    maxScore: 1,
  };

  const sameKind = actual.escalation.kind === expected.escalation.kind;
  components.escalationKind = {
    score: sameKind ? 2 : 0,
    maxScore: 2,
    note: `expected "${expected.escalation.kind}", got "${actual.escalation.kind}"`,
  };

  if (expected.escalation.kind === "percent" && sameKind) {
    const expPct = expected.escalation.pct;
    const actPct =
      actual.escalation.kind === "percent" ? actual.escalation.pct : -1;
    components.escalationPct = {
      score: numClose(actPct, expPct) ? 2 : 0,
      maxScore: 2,
      note: `expected ${expPct}%, got ${actPct}`,
    };
  }

  if (expected.escalation.kind === "fixed_amount_per_rsf") {
    const expAmt = expected.escalation.amount;
    const actAmt =
      actual.escalation.kind === "fixed_amount_per_rsf"
        ? actual.escalation.amount
        : -1;
    components.fixedAmount = {
      score: sameKind && numClose(actAmt, expAmt) ? 2 : 0,
      maxScore: 2,
    };
  }

  if (expected.escalation.kind === "cpi") {
    if (expected.escalation.capPct !== undefined) {
      const expCap = expected.escalation.capPct;
      const actCap =
        actual.escalation.kind === "cpi" ? actual.escalation.capPct : undefined;
      components.cpiCap = {
        score: actCap !== undefined && numClose(actCap, expCap) ? 1 : 0,
        maxScore: 1,
      };
    }
    if (expected.escalation.floorPct !== undefined) {
      const expFloor = expected.escalation.floorPct;
      const actFloor =
        actual.escalation.kind === "cpi"
          ? actual.escalation.floorPct
          : undefined;
      components.cpiFloor = {
        score: actFloor !== undefined && numClose(actFloor, expFloor) ? 1 : 0,
        maxScore: 1,
      };
    }
  }

  if (expected.escalation.kind === "greater_of") {
    components.greaterOfCount = {
      score:
        sameKind &&
        actual.escalation.kind === "greater_of" &&
        actual.escalation.options.length === expected.escalation.options.length
          ? 1
          : 0,
      maxScore: 1,
    };
  }

  if (expected.firstEscalationMonth !== null) {
    components.firstEscalationMonth = {
      score:
        actual.firstEscalationMonth === expected.firstEscalationMonth ? 1 : 0,
      maxScore: 1,
    };
  }

  return aggregateComponents(components);
}

// ─── EXPANSION_RIGHTS ────────────────────────────────────────────────────────

/**
 * Score EXPANSION_RIGHTS payload.
 *
 * Components:
 *   rightKind       (2 pts) — EXPANSION / ROFO / ROFR / MUST_TAKE / OTHER
 *   applicableSpace (1 pt)  — fuzzy string match
 *   pricingMethod   (1 pt)  — when expected
 *   noticeMonths    (1 pt)  — when expected
 */
export function scoreExpansionRights(
  actual: ExpansionRightsPayload,
  expected: ExpansionRightsPayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  components.rightKind = {
    score: actual.rightKind === expected.rightKind ? 2 : 0,
    maxScore: 2,
    note: `expected "${expected.rightKind}", got "${actual.rightKind}"`,
  };

  if (expected.applicableSpace !== null) {
    components.applicableSpace = {
      score: strContains(actual.applicableSpace, expected.applicableSpace)
        ? 1
        : 0,
      maxScore: 1,
      note: `expected "${expected.applicableSpace}"`,
    };
  }

  if (expected.pricingMethod !== null) {
    components.pricingMethod = {
      score: actual.pricingMethod === expected.pricingMethod ? 1 : 0,
      maxScore: 1,
    };
  }

  if (expected.noticeMonths !== null) {
    components.noticeMonths = {
      score: actual.noticeMonths === expected.noticeMonths ? 1 : 0,
      maxScore: 1,
    };
  }

  if (expected.trigger !== null) {
    components.trigger = {
      score: strContains(actual.trigger, expected.trigger) ? 1 : 0,
      maxScore: 1,
      note: `expected "${expected.trigger}"`,
    };
  }

  maybeAdd(
    components,
    "conditions",
    scoreStringList(actual.conditions, expected.conditions, "conditions")
  );

  return aggregateComponents(components);
}

// ─── TI_ALLOWANCE ────────────────────────────────────────────────────────────

/**
 * Score TI_ALLOWANCE payload.
 *
 * Components:
 *   amount (3 pts) — monetary amount within tolerance
 *   unit   (1 pt)  — USD_PER_RSF_YEAR vs USD
 */
export function scoreTIAllowance(
  actual: TIAllowancePayload,
  expected: TIAllowancePayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  components.amount = {
    score: numClose(actual.amount.amount, expected.amount.amount) ? 3 : 0,
    maxScore: 3,
    note: `expected $${expected.amount.amount}, got $${actual.amount.amount}`,
  };
  components.unit = {
    score: actual.amount.unit === expected.amount.unit ? 1 : 0,
    maxScore: 1,
  };

  maybeAdd(
    components,
    "conditions",
    scoreStringList(actual.conditions, expected.conditions, "conditions")
  );

  return aggregateComponents(components);
}

// ─── COMMENCEMENT_DATE ───────────────────────────────────────────────────────

/**
 * Score COMMENCEMENT_DATE payload.
 *
 * Components:
 *   fixedDate       (3 pts) — exact ISO date match when expected
 *   conditionalFlag (1 pt)  — null when expected null (conditional date)
 *   conditionsCount (1 pt)  — number of conditions matches
 */
export function scoreCommencementDate(
  actual: CommencementDatePayload,
  expected: CommencementDatePayload
): SemanticScore {
  const components: Record<string, SemanticComponentScore> = {};

  if (expected.fixedDate !== null) {
    components.fixedDate = {
      score: actual.fixedDate === expected.fixedDate ? 3 : 0,
      maxScore: 3,
      note: `expected "${expected.fixedDate}", got "${actual.fixedDate ?? "null"}"`,
    };
  } else {
    components.conditionalFlag = {
      score: actual.fixedDate === null ? 1 : 0,
      maxScore: 1,
      note: "expected conditional (null) date",
    };
  }

  components.conditionsCount = {
    score: actual.conditions.length === expected.conditions.length ? 1 : 0,
    maxScore: 1,
    note: `expected ${expected.conditions.length} conditions, got ${actual.conditions.length}`,
  };
  maybeAdd(
    components,
    "conditions",
    scoreStringList(actual.conditions, expected.conditions, "conditions")
  );

  return aggregateComponents(components);
}

// ─── Master dispatcher ────────────────────────────────────────────────────────

/**
 * Score any CREStructuredPayload against its expected counterpart.
 *
 * Dispatches to the type-specific scorer. Type mismatch returns score 0.
 * Does NOT compare JSON strings — each scorer tests CRE-meaningful dimensions.
 */
export function scorePayload(
  actual: CREStructuredPayload,
  expected: CREStructuredPayload
): SemanticScore {
  if (actual.termType !== expected.termType) {
    return {
      score: 0,
      rawScore: 0,
      maxRawScore: 1,
      components: {
        termType: {
          score: 0,
          maxScore: 1,
          note: `termType mismatch: actual "${actual.termType}" vs expected "${expected.termType}"`,
        },
      },
    };
  }

  switch (expected.termType) {
    case "BASE_RENT":
      return scoreBaseRent(actual as BaseRentPayload, expected);
    case "FREE_RENT":
      return scoreFreeRent(actual as FreeRentPayload, expected);
    case "RENEWAL_OPTIONS":
      return scoreRenewalOptions(actual as RenewalOptionsPayload, expected);
    case "TERMINATION_RIGHTS":
      return scoreTerminationRights(
        actual as TerminationRightsPayload,
        expected
      );
    case "PARKING":
      return scoreParking(actual as ParkingPayload, expected);
    case "OPERATING_EXPENSES":
      return scoreOperatingExpenses(
        actual as OperatingExpensesPayload,
        expected
      );
    case "ANNUAL_ESCALATION":
      return scoreAnnualEscalation(
        actual as AnnualEscalationPayload,
        expected
      );
    case "EXPANSION_RIGHTS":
      return scoreExpansionRights(actual as ExpansionRightsPayload, expected);
    case "TI_ALLOWANCE":
      return scoreTIAllowance(actual as TIAllowancePayload, expected);
    case "COMMENCEMENT_DATE":
      return scoreCommencementDate(
        actual as CommencementDatePayload,
        expected
      );
    default:
      // Exhaustive: all CRETermType variants handled above
      return { score: 1, rawScore: 1, maxRawScore: 1, components: {} };
  }
}

/** True when every scored component is fully correct (no partial credit leftover). */
export function isPerfectSemanticScore(score: SemanticScore): boolean {
  return score.maxRawScore === 0 || score.score >= 1 - 1e-9;
}

/**
 * Normalized score for the stepped-rent `steps` component, or null if the
 * comparison is not a stepped BASE_RENT payload.
 */
export function scheduleComponentScore(score: SemanticScore): number | null {
  const steps = score.components.steps;
  if (!steps || steps.maxScore === 0) return null;
  return steps.score / steps.maxScore;
}

/**
 * Normalized score for the irregular free-rent `periods` component, or null
 * if the comparison is not an irregular FREE_RENT payload.
 */
export function periodComponentScore(score: SemanticScore): number | null {
  const periods = score.components.periods;
  if (!periods || periods.maxScore === 0) return null;
  return periods.score / periods.maxScore;
}

const RIGHTS_TYPES = new Set([
  "RENEWAL_OPTIONS",
  "TERMINATION_RIGHTS",
  "EXPANSION_RIGHTS",
]);

/** Overall semantic score when the payload is a rights type; otherwise null. */
export function rightsScoreFor(
  actual: CREStructuredPayload,
  expected: CREStructuredPayload,
  score: SemanticScore
): number | null {
  if (!RIGHTS_TYPES.has(expected.termType)) return null;
  if (actual.termType !== expected.termType) return 0;
  return score.score;
}

/**
 * Normalized conditions-component score when conditions were expected.
 * Independent of the rest of the payload so a conditions miss is visible.
 */
export function conditionsComponentScore(score: SemanticScore): number | null {
  const conditions = score.components.conditions;
  if (!conditions || conditions.maxScore === 0) return null;
  return conditions.score / conditions.maxScore;
}
