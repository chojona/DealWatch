import type { NegotiationTermStatus } from "@/lib/ai/negotiation/schemas";

/**
 * Formal status as the Deal Brief may display it.
 *
 * Resolver statuses stay on `DealBriefNegotiationTerm.status`. This projection
 * is the only place those statuses become a Brief label, an open-count
 * decision, or formal-term attention copy. Unknown statuses become Unknown
 * and do not count as open.
 *
 * | Resolver status | Brief status   | Label         | openCount | Attention                          |
 * |-----------------|----------------|---------------|-----------|------------------------------------|
 * | PROPOSED        | OPEN           | Open          | yes       | "{label} remains open"             |
 * | UNRESOLVED      | OPEN           | Open          | yes       | "{label} is unresolved"            |
 * | AGREED          | AGREED         | Agreed        | no        | none                               |
 * | REJECTED        | REJECTED       | Rejected      | no        | "{label} was rejected"             |
 * | WITHDRAWN       | WITHDRAWN      | Withdrawn     | no        | "{label} was withdrawn"            |
 * | NOT_MENTIONED   | NOT_MENTIONED  | Not mentioned | no        | none                               |
 * | NOT_MENTIONED + every observation formal-review REJECTED | REJECTED | Rejected | no | "{label} was rejected" |
 * | conflict, unless the status is already agreed, rejected, or withdrawn | CONFLICT | Conflict | follows the resolver status | conflicting-evidence copy |
 * | anything else   | UNKNOWN        | Unknown       | no        | none                               |
 *
 * A within-side conflict still counts as open when the resolver status is
 * PROPOSED or UNRESOLVED. Rejection and withdrawal never do.
 */
export const DEAL_BRIEF_FORMAL_STATUSES = [
  "OPEN",
  "AGREED",
  "CONFLICT",
  "REJECTED",
  "WITHDRAWN",
  "NOT_MENTIONED",
  "UNKNOWN",
] as const;

export type DealBriefFormalStatus = (typeof DEAL_BRIEF_FORMAL_STATUSES)[number];

const RESOLVER_STATUSES = [
  "PROPOSED",
  "AGREED",
  "REJECTED",
  "WITHDRAWN",
  "UNRESOLVED",
  "NOT_MENTIONED",
] as const satisfies readonly NegotiationTermStatus[];

export type FormalAttentionType =
  | "NEGOTIATION_CONFLICT"
  | "NEGOTIATION_UNRESOLVED"
  | "NEGOTIATION_REJECTED"
  | "NEGOTIATION_WITHDRAWN";

export interface FormalAttentionCopy {
  type: FormalAttentionType;
  label: string;
  description: string;
}

export interface FormalStatusProjection {
  resolverStatus: NegotiationTermStatus | "UNKNOWN";
  briefStatus: DealBriefFormalStatus;
  label: string;
  countsAsOpen: boolean;
  attention: FormalAttentionCopy | null;
}

const LABELS: Record<DealBriefFormalStatus, string> = {
  OPEN: "Open",
  AGREED: "Agreed",
  CONFLICT: "Conflict",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  NOT_MENTIONED: "Not mentioned",
  UNKNOWN: "Unknown",
};

function resolverStatus(status: string): NegotiationTermStatus | null {
  return (RESOLVER_STATUSES as readonly string[]).includes(status)
    ? status as NegotiationTermStatus
    : null;
}

function statusLabel(status: NegotiationTermStatus): string {
  switch (status) {
    case "PROPOSED":
      return "Proposed";
    case "AGREED":
      return "Agreed";
    case "REJECTED":
      return "Rejected";
    case "WITHDRAWN":
      return "Withdrawn";
    case "UNRESOLVED":
      return "Unresolved";
    case "NOT_MENTIONED":
      return "Not mentioned";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function formalPositionFullyRejected(
  history: ReadonlyArray<{ formalReview: { state: string } | null }>
): boolean {
  return history.length > 0 && history.every((item) => item.formalReview?.state === "REJECTED");
}

export function projectFormalBriefStatus(input: {
  label: string;
  status: string;
  conflict: boolean;
  reviewRejected?: boolean;
}): FormalStatusProjection {
  const known = resolverStatus(input.status);
  if (!known) {
    return {
      resolverStatus: "UNKNOWN",
      briefStatus: "UNKNOWN",
      label: LABELS.UNKNOWN,
      countsAsOpen: false,
      attention: null,
    };
  }

  let briefStatus: DealBriefFormalStatus;
  switch (known) {
    case "AGREED":
      briefStatus = "AGREED";
      break;
    case "REJECTED":
      briefStatus = "REJECTED";
      break;
    case "WITHDRAWN":
      briefStatus = "WITHDRAWN";
      break;
    case "PROPOSED":
    case "UNRESOLVED":
      briefStatus = "OPEN";
      break;
    case "NOT_MENTIONED":
      briefStatus = input.reviewRejected ? "REJECTED" : "NOT_MENTIONED";
      break;
    default: {
      const exhaustive: never = known;
      return exhaustive;
    }
  }

  if (
    input.conflict
    && briefStatus !== "AGREED"
    && briefStatus !== "REJECTED"
    && briefStatus !== "WITHDRAWN"
  ) {
    briefStatus = "CONFLICT";
  }

  const countsAsOpen = known === "PROPOSED" || known === "UNRESOLVED";
  let attention: FormalAttentionCopy | null = null;
  if (briefStatus === "CONFLICT") {
    attention = {
      type: "NEGOTIATION_CONFLICT",
      label: `${input.label} has conflicting formal evidence`,
      description: "The deterministic resolver found multiple current candidates.",
    };
  } else if (briefStatus === "REJECTED") {
    attention = {
      type: "NEGOTIATION_REJECTED",
      label: `${input.label} was rejected`,
      description: known === "REJECTED"
        ? "Current formal status: Rejected."
        : "Formal review rejected the current extraction.",
    };
  } else if (briefStatus === "WITHDRAWN") {
    attention = {
      type: "NEGOTIATION_WITHDRAWN",
      label: `${input.label} was withdrawn`,
      description: "Current formal status: Withdrawn.",
    };
  } else if (briefStatus === "OPEN") {
    const unresolved = known === "UNRESOLVED";
    attention = {
      type: "NEGOTIATION_UNRESOLVED",
      label: `${input.label} ${unresolved ? "is unresolved" : "remains open"}`,
      description: `Current formal status: ${statusLabel(known)}.`,
    };
  }

  return {
    resolverStatus: known,
    briefStatus,
    label: LABELS[briefStatus],
    countsAsOpen,
    attention,
  };
}

export function countOpenFormalTerms(
  terms: ReadonlyArray<{ countsAsOpen: boolean }>
): number {
  return terms.filter((term) => term.countsAsOpen).length;
}

/** Shared open-term predicate for Brief, Negotiation, meeting prep, and deal overview. */
export function termCountsAsOpen(term: {
  label: string;
  status: string;
  conflict: boolean;
  history: ReadonlyArray<{ formalReview: { state: string } | null }>;
}): boolean {
  return projectFormalBriefStatus({
    label: term.label,
    status: term.status,
    conflict: term.conflict,
    reviewRejected: formalPositionFullyRejected(term.history),
  }).countsAsOpen;
}
