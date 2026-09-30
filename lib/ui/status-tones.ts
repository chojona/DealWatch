export const statusToneClass = {
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  danger: "bg-danger-subtle text-danger",
  info: "bg-info-subtle text-info",
  neutral: "bg-surface-subtle text-ink-secondary",
  quiet: "bg-surface text-ink-secondary ring-1 ring-inset ring-line",
} as const;

export type StatusTone = keyof typeof statusToneClass;

const negotiationStatusTone = {
  AGREED: "success",
  ACCEPTED: "success",
  OPEN: "warning",
  UNRESOLVED: "warning",
  STALE: "warning",
  PENDING: "warning",
  PROPOSED: "info",
  CHANGED: "info",
  CONFLICT: "danger",
  REJECTED: "danger",
  FAILED: "danger",
  WITHDRAWN: "neutral",
  NOT_MENTIONED: "neutral",
  HISTORICAL: "neutral",
  UNKNOWN: "quiet",
} as const satisfies Record<string, StatusTone>;

const obligationStatusTone = {
  OVERDUE: "danger",
  WAITING: "warning",
  OPEN: "info",
  COMPLETED: "success",
} as const satisfies Record<string, StatusTone>;

const comparisonOutcomeTone = {
  DIFFERS: "warning",
  MATCH: "success",
  NOT_COMPARABLE: "quiet",
} as const satisfies Record<string, StatusTone>;

export type NegotiationStatus = keyof typeof negotiationStatusTone;
export type ObligationStatusToneKey = keyof typeof obligationStatusTone;
export type ComparisonOutcome = keyof typeof comparisonOutcomeTone;

export function toneForNegotiationStatus(status: string): StatusTone {
  if (status in negotiationStatusTone) {
    return negotiationStatusTone[status as NegotiationStatus];
  }
  return "quiet";
}

export function toneForObligationStatus(status: string): StatusTone {
  if (status in obligationStatusTone) {
    return obligationStatusTone[status as ObligationStatusToneKey];
  }
  return "quiet";
}

export function toneForComparisonOutcome(outcome: string): StatusTone {
  if (outcome in comparisonOutcomeTone) {
    return comparisonOutcomeTone[outcome as ComparisonOutcome];
  }
  return "quiet";
}
