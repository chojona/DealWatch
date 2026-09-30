import {
  StructuredActionDirectiveSchema,
  type StructuredActionDirective,
} from "@/lib/ai/activity/schema";
import { ACTION_DAY_MS, ACTION_INTELLIGENCE_THRESHOLDS } from "./thresholds";
import type {
  ActionEvidence,
  DealAction,
  DealActionKind,
  DealActionPriority,
  DealActionState,
  DealCourt,
  DealDeadline,
  DealDiscrepancySignal,
  DealMeeting,
  DealMeetingKind,
  DealMeetingTiming,
  DealPreparationChange,
  DealPreparationTerm,
  DealRankedItem,
  DealResponsibleSide,
  DealUpcomingItem,
} from "./types";

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const ACTION_KINDS = new Set<DealActionKind>([
  "RESPONSE_REQUESTED",
  "FOLLOW_UP_REQUESTED",
  "DOCUMENT_REQUESTED",
  "INFORMATION_REQUESTED",
  "MEETING_REQUESTED",
  "CALL_REQUESTED",
  "COMMITMENT",
  "NEXT_STEP",
]);

const OUR_SIDE_REQUESTS = new Set<DealActionKind>([
  "RESPONSE_REQUESTED",
  "FOLLOW_UP_REQUESTED",
  "DOCUMENT_REQUESTED",
  "INFORMATION_REQUESTED",
  "MEETING_REQUESTED",
  "CALL_REQUESTED",
  "COMMITMENT",
]);

const PRIORITY_RANK: Record<DealActionPriority, number> = {
  DEADLINE_PASSED: 1,
  DEADLINE_APPROACHING: 2,
  OUR_SIDE_RESPONSE: 3,
  UPCOMING_MEETING: 4,
  PAPER_COMMUNICATION_DISCREPANCY: 5,
  STALE_OUTSTANDING: 6,
  OTHER_NEXT_STEP: 7,
};

export interface ActionFactInput {
  id: string;
  messageId: string;
  factType: string;
  assertionStatus: string;
  evidenceQuote: string;
  timestamp: string;
  subject: string;
  href: string;
  display: string | null;
  participants: Array<{ role: string; displayName: string | null; address: string }>;
  reviewed: boolean;
  payload: unknown;
}

export interface DealActionDerivationInput {
  facts: ActionFactInput[];
  openTerms: DealPreparationTerm[];
  changes: DealPreparationChange[];
  discrepancies: DealDiscrepancySignal[];
  now: Date;
}

function instant(value: string | null | undefined): string | null {
  if (!value || !INSTANT.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return value;
}

function readDirective(payload: unknown): StructuredActionDirective | null {
  if (!payload || typeof payload !== "object" || !("action" in payload)) return null;
  const action = (payload as { action?: unknown }).action;
  if (action == null) return null;
  const parsed = StructuredActionDirectiveSchema.safeParse(action);
  return parsed.success ? parsed.data : null;
}

function evidence(fact: ActionFactInput): ActionEvidence {
  return {
    factId: fact.id,
    messageId: fact.messageId,
    href: fact.href,
    label: fact.subject,
    evidenceQuote: fact.evidenceQuote,
    timestamp: fact.timestamp,
  };
}

function ageDays(timestamp: string, now: Date): number | null {
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((now.getTime() - time) / ACTION_DAY_MS);
}

function blankId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function comparePriority(left: DealActionPriority, right: DealActionPriority): number {
  return PRIORITY_RANK[left] - PRIORITY_RANK[right];
}

function meetingKind(factType: string, directive: StructuredActionDirective | null): DealMeetingKind | null {
  if (factType === "MEETING" || factType === "CALL" || factType === "TOUR") return factType;
  if (directive?.kind === "MEETING_REQUESTED" && instant(directive.occursAt)) return "MEETING";
  if (directive?.kind === "CALL_REQUESTED" && instant(directive.occursAt)) return "CALL";
  return null;
}

function meetingTiming(occursAt: string | null, now: Date): DealMeetingTiming {
  if (!occursAt) return "UNDATED";
  return new Date(occursAt).getTime() >= now.getTime() ? "UPCOMING" : "PAST";
}

function deadlineTiming(dueAt: string | null, now: Date): { passed: boolean; approaching: boolean; label: string } {
  if (!dueAt) return { passed: false, approaching: false, label: "Date not specified" };
  const delta = new Date(dueAt).getTime() - now.getTime();
  if (delta < 0) return { passed: true, approaching: false, label: "Past due" };
  const approaching = delta <= ACTION_INTELLIGENCE_THRESHOLDS.deadlineApproachingDays * ACTION_DAY_MS;
  return { passed: false, approaching, label: approaching ? "Deadline approaching" : "Upcoming" };
}

function actionPriority(input: {
  kind: DealActionKind;
  responsibleSide: DealResponsibleSide;
  dueAt: string | null;
  stale: boolean;
  now: Date;
}): DealActionPriority {
  const timing = deadlineTiming(input.dueAt, input.now);
  if (timing.passed) return "DEADLINE_PASSED";
  if (timing.approaching) return "DEADLINE_APPROACHING";
  if (input.responsibleSide === "OUR_SIDE" && OUR_SIDE_REQUESTS.has(input.kind)) return "OUR_SIDE_RESPONSE";
  if (input.stale) return "STALE_OUTSTANDING";
  return "OTHER_NEXT_STEP";
}

function timingLabel(input: { dueAt: string | null; stale: boolean; age: number | null; status: "OPEN" | "CLOSED"; now: Date }): string {
  if (input.status === "CLOSED") return "Fulfilled";
  if (deadlineTiming(input.dueAt, input.now).passed) return "Past due";
  if (input.stale && input.age != null) return `Outstanding for ${input.age} days`;
  return "Outstanding";
}

function provesFulfillment(fact: ActionFactInput, directive: StructuredActionDirective, targetId: string, targetTimestamp: string): boolean {
  if (!fact.reviewed) return false;
  if (fact.assertionStatus !== "ACCEPTED") return false;
  if (blankId(directive.fulfillsFactId) !== targetId) return false;
  if (new Date(fact.timestamp).getTime() < new Date(targetTimestamp).getTime()) return false;
  return directive.kind === "FULFILLMENT" || fact.factType === "DOCUMENT_RECEIVED" || fact.factType === "DOCUMENT_SENT";
}

function courtFrom(actions: DealAction[]): DealActionState["court"] {
  const reviewed = actions.filter((action) => action.confidence === "REVIEWED");
  const open = reviewed.filter((action) => action.status === "OPEN");
  const determining = open.filter((action) => action.responsibleSide === "OUR_SIDE" || action.responsibleSide === "COUNTERPARTY" || action.responsibleSide === "BOTH");
  const sides = new Set(determining.map((action) => action.responsibleSide));
  let value: DealCourt = "UNKNOWN";
  let evidenceRows: ActionEvidence[] = [];
  if (sides.has("BOTH") || (sides.has("OUR_SIDE") && sides.has("COUNTERPARTY"))) {
    value = "BOTH";
    evidenceRows = determining.filter((action) => action.responsibleSide !== "UNKNOWN").map((action) => action.source);
  } else if (sides.has("OUR_SIDE")) {
    value = "OUR_SIDE";
    evidenceRows = determining.filter((action) => action.responsibleSide === "OUR_SIDE").map((action) => action.source);
  } else if (sides.has("COUNTERPARTY")) {
    value = "COUNTERPARTY";
    evidenceRows = determining.filter((action) => action.responsibleSide === "COUNTERPARTY").map((action) => action.source);
  } else if (reviewed.length > 0 && open.length === 0) {
    value = "NONE";
    evidenceRows = reviewed.map((action) => action.source);
  }
  return {
    value,
    evidence: evidenceRows.sort((left, right) => left.factId.localeCompare(right.factId)),
  };
}

function compareActions(left: DealAction, right: DealAction): number {
  return comparePriority(left.priority, right.priority)
    || (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999")
    || left.sourceTimestamp.localeCompare(right.sourceTimestamp)
    || left.id.localeCompare(right.id);
}

/**
 * Deterministic action read model.
 * Court, closure, dates, and obligations come only from reviewed structured directives
 * and explicit fact types. Sender identity, open negotiation, and message prose do not qualify.
 */
export function deriveDealActionState(input: DealActionDerivationInput): DealActionState {
  const now = input.now;
  const reviewed = input.facts.filter((fact) => fact.reviewed);
  const directives = new Map<string, StructuredActionDirective>();
  for (const fact of reviewed) {
    const directive = readDirective(fact.payload);
    if (directive) directives.set(fact.id, directive);
  }

  const actions: DealAction[] = [];
  for (const fact of reviewed) {
    const directive = directives.get(fact.id);
    if (!directive || !ACTION_KINDS.has(directive.kind as DealActionKind)) continue;
    const kind = directive.kind as DealActionKind;
    const fulfillment = reviewed.find((candidate) => {
      const candidateDirective = directives.get(candidate.id);
      return Boolean(candidateDirective && provesFulfillment(candidate, candidateDirective, fact.id, fact.timestamp));
    }) ?? null;
    const status = fulfillment ? "CLOSED" as const : "OPEN" as const;
    const dueAt = instant(directive.dueAt);
    const age = ageDays(fact.timestamp, now);
    const dueState = deadlineTiming(dueAt, now);
    const stale = status === "OPEN"
      && !dueState.passed
      && !dueState.approaching
      && age != null
      && age >= ACTION_INTELLIGENCE_THRESHOLDS.staleAfterDays;
    const priority = actionPriority({
      kind,
      responsibleSide: directive.responsibleSide,
      dueAt,
      stale,
      now,
    });
    actions.push({
      id: `action:${fact.id}`,
      kind,
      description: fact.evidenceQuote,
      responsibleSide: directive.responsibleSide,
      responsibleLabel: directive.responsibleLabel,
      counterpartyLabel: directive.counterpartyLabel,
      dueAt,
      dueText: directive.dueText,
      sourceTimestamp: fact.timestamp,
      confidence: "REVIEWED",
      status,
      priority,
      timingLabel: timingLabel({ dueAt, stale, age, status, now }),
      stale,
      ageDays: age,
      source: evidence(fact),
      fulfillment: fulfillment ? evidence(fulfillment) : null,
    });
  }
  actions.sort(compareActions);

  const deadlines: DealDeadline[] = [];
  for (const fact of reviewed) {
    const directive = directives.get(fact.id) ?? null;
    const dueAt = instant(directive?.dueAt);
    const isDeadlineFact = fact.factType === "DEADLINE";
    const isActionDue = Boolean(directive && ACTION_KINDS.has(directive.kind as DealActionKind) && (dueAt || directive.dueText));
    if (!isDeadlineFact && !isActionDue) continue;
    if (meetingKind(fact.factType, directive)) continue;
    const timing = deadlineTiming(dueAt, now);
    deadlines.push({
      id: `deadline:${fact.id}`,
      kind: isDeadlineFact ? "HARD_DEADLINE" : "RESPONSE_DUE",
      label: fact.display || fact.evidenceQuote,
      dueAt,
      dueText: directive?.dueText ?? (dueAt ? null : fact.display),
      passed: timing.passed,
      approaching: timing.approaching,
      timingLabel: timing.label,
      source: evidence(fact),
    });
  }
  deadlines.sort((left, right) => Number(right.passed) - Number(left.passed)
    || Number(right.approaching) - Number(left.approaching)
    || (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999")
    || left.id.localeCompare(right.id));

  const meetings: DealMeeting[] = [];
  for (const fact of reviewed) {
    const directive = directives.get(fact.id) ?? null;
    const kind = meetingKind(fact.factType, directive);
    if (!kind) continue;
    const occursAt = instant(directive?.occursAt);
    const timing = meetingTiming(occursAt, now);
    meetings.push({
      id: `meeting:${fact.id}`,
      kind,
      label: fact.display || fact.subject,
      occursAt,
      timing,
      participants: [...fact.participants]
        .sort((left, right) => left.role.localeCompare(right.role) || left.address.localeCompare(right.address))
        .map((participant) => ({
          role: participant.role,
          name: participant.displayName,
          address: participant.address,
        })),
      context: fact.subject,
      priority: timing === "UPCOMING" ? "UPCOMING_MEETING" : null,
      source: evidence(fact),
    });
  }
  meetings.sort((left, right) => (left.occursAt ?? "9999").localeCompare(right.occursAt ?? "9999") || left.id.localeCompare(right.id));

  const outstandingActions = actions.filter((action) => action.status === "OPEN");
  const staleItems = outstandingActions.filter((action) => action.stale);
  const needsYou = outstandingActions.filter(
    (action) => action.responsibleSide === "OUR_SIDE" || action.responsibleSide === "BOTH",
  );
  const discrepancies = [...input.discrepancies].sort((left, right) => left.id.localeCompare(right.id));
  const openTerms = [...input.openTerms].sort((left, right) => left.label.localeCompare(right.label));

  const preparation = meetings
    .filter((meeting) => meeting.timing === "UPCOMING" && meeting.occursAt)
    .map((meeting) => {
      const occurs = new Date(meeting.occursAt!).getTime();
      const start = occurs - ACTION_INTELLIGENCE_THRESHOLDS.preparationLookbackDays * ACTION_DAY_MS;
      return {
        meetingId: meeting.id,
        occursAt: meeting.occursAt!,
        label: meeting.label,
        participants: meeting.participants,
        openTerms,
        discrepancies,
        outstandingActions,
        changes: input.changes
          .filter((change) => {
            const time = new Date(change.timestamp).getTime();
            return time >= start && time < occurs;
          })
          .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id)),
        sources: [meeting.source, ...outstandingActions.map((action) => action.source)],
      };
    });

  const upcoming: DealUpcomingItem[] = [
    ...deadlines.map((deadline) => ({
      id: deadline.id,
      kind: "DEADLINE" as const,
      label: deadline.label,
      at: deadline.dueAt,
      timingLabel: deadline.timingLabel,
      href: deadline.source.href,
      priority: deadline.passed ? "DEADLINE_PASSED" as const : deadline.approaching ? "DEADLINE_APPROACHING" as const : null,
    })),
    ...meetings.filter((meeting) => meeting.timing !== "PAST").map((meeting) => ({
      id: meeting.id,
      kind: "MEETING" as const,
      label: meeting.label,
      at: meeting.occursAt,
      timingLabel: meeting.timing === "UNDATED" ? "Time not specified" : "Upcoming",
      href: meeting.source.href,
      priority: meeting.priority,
    })),
  ];

  const ranked: DealRankedItem[] = [
    ...outstandingActions.map((action) => ({ id: action.id, priority: action.priority, kind: "ACTION" as const })),
    ...meetings.filter((meeting) => meeting.priority === "UPCOMING_MEETING").map((meeting) => ({
      id: meeting.id,
      priority: "UPCOMING_MEETING" as const,
      kind: "MEETING" as const,
    })),
    ...discrepancies.map((item) => ({ id: item.id, priority: item.priority, kind: "DISCREPANCY" as const })),
  ].sort((left, right) => comparePriority(left.priority, right.priority) || left.id.localeCompare(right.id));

  const evidenceRows = new Map<string, ActionEvidence>();
  for (const action of actions) {
    evidenceRows.set(action.source.factId, action.source);
    if (action.fulfillment) evidenceRows.set(action.fulfillment.factId, action.fulfillment);
  }
  for (const deadline of deadlines) evidenceRows.set(deadline.source.factId, deadline.source);
  for (const meeting of meetings) evidenceRows.set(meeting.source.factId, meeting.source);

  return {
    court: courtFrom(actions),
    actions,
    outstandingActions,
    needsYou,
    deadlines,
    meetings,
    upcoming,
    staleItems,
    preparation,
    discrepancies,
    ranked,
    evidence: [...evidenceRows.values()].sort((left, right) => left.factId.localeCompare(right.factId)),
    generatedAt: now.toISOString(),
  };
}

export function compareActionPriority(left: DealActionPriority, right: DealActionPriority): number {
  return comparePriority(left, right);
}
