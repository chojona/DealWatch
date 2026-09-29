/** Central action-intelligence timing. These are presentation thresholds, not contractual defaults. */
export const ACTION_INTELLIGENCE_THRESHOLDS = {
  staleAfterDays: 5,
  deadlineApproachingDays: 3,
  preparationLookbackDays: 14,
} as const;

export const ACTION_DAY_MS = 86_400_000;
