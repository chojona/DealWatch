export type DealCourt = "OUR_SIDE" | "COUNTERPARTY" | "BOTH" | "NONE" | "UNKNOWN";

export type DealActionKind =
  | "RESPONSE_REQUESTED"
  | "FOLLOW_UP_REQUESTED"
  | "DOCUMENT_REQUESTED"
  | "INFORMATION_REQUESTED"
  | "MEETING_REQUESTED"
  | "CALL_REQUESTED"
  | "COMMITMENT"
  | "NEXT_STEP";

export type DealResponsibleSide = "OUR_SIDE" | "COUNTERPARTY" | "BOTH" | "UNKNOWN";

export type DealActionStatus = "OPEN" | "CLOSED";

export type DealActionConfidence = "REVIEWED";

export type DealActionPriority =
  | "DEADLINE_PASSED"
  | "DEADLINE_APPROACHING"
  | "OUR_SIDE_RESPONSE"
  | "UPCOMING_MEETING"
  | "PAPER_COMMUNICATION_DISCREPANCY"
  | "STALE_OUTSTANDING"
  | "OTHER_NEXT_STEP";

export interface ActionEvidence {
  factId: string;
  messageId: string;
  href: string;
  label: string;
  evidenceQuote: string;
  timestamp: string;
}

export interface DealCourtDetermination {
  value: DealCourt;
  evidence: ActionEvidence[];
}

export interface DealAction {
  id: string;
  kind: DealActionKind;
  description: string;
  responsibleSide: DealResponsibleSide;
  responsibleLabel: string | null;
  counterpartyLabel: string | null;
  dueAt: string | null;
  dueText: string | null;
  sourceTimestamp: string;
  confidence: DealActionConfidence;
  status: DealActionStatus;
  priority: DealActionPriority;
  timingLabel: string;
  stale: boolean;
  ageDays: number | null;
  source: ActionEvidence;
  fulfillment: ActionEvidence | null;
}

export type DealDeadlineKind = "HARD_DEADLINE" | "RESPONSE_DUE";

export interface DealDeadline {
  id: string;
  kind: DealDeadlineKind;
  label: string;
  dueAt: string | null;
  dueText: string | null;
  passed: boolean;
  approaching: boolean;
  timingLabel: string;
  source: ActionEvidence;
}

export type DealMeetingKind = "MEETING" | "CALL" | "TOUR";
export type DealMeetingTiming = "UPCOMING" | "UNDATED" | "PAST";

export interface DealMeetingParticipant {
  role: string;
  name: string | null;
  address: string;
}

export interface DealMeeting {
  id: string;
  kind: DealMeetingKind;
  label: string;
  occursAt: string | null;
  timing: DealMeetingTiming;
  participants: DealMeetingParticipant[];
  context: string;
  priority: DealActionPriority | null;
  source: ActionEvidence;
}

export interface DealPreparationTerm {
  canonicalType: string;
  label: string;
  status: string;
  summary: string;
  href: string | null;
}

export interface DealPreparationChange {
  id: string;
  timestamp: string;
  label: string;
  href: string | null;
}

export interface DealDiscrepancySignal {
  id: string;
  canonicalType: string;
  label: string;
  formalValue: string | null;
  communicationValue: string;
  href: string | null;
  priority: "PAPER_COMMUNICATION_DISCREPANCY";
}

export interface DealPreparation {
  meetingId: string;
  occursAt: string;
  label: string;
  participants: DealMeetingParticipant[];
  openTerms: DealPreparationTerm[];
  discrepancies: DealDiscrepancySignal[];
  outstandingActions: DealAction[];
  changes: DealPreparationChange[];
  sources: ActionEvidence[];
}

export interface DealRankedItem {
  id: string;
  priority: DealActionPriority;
  kind: "ACTION" | "MEETING" | "DISCREPANCY";
}

export interface DealUpcomingItem {
  id: string;
  kind: "DEADLINE" | "MEETING";
  label: string;
  at: string | null;
  timingLabel: string;
  href: string;
  priority: DealActionPriority | null;
}

export interface DealActionState {
  court: DealCourtDetermination;
  actions: DealAction[];
  outstandingActions: DealAction[];
  needsYou: DealAction[];
  deadlines: DealDeadline[];
  meetings: DealMeeting[];
  upcoming: DealUpcomingItem[];
  staleItems: DealAction[];
  preparation: DealPreparation[];
  discrepancies: DealDiscrepancySignal[];
  ranked: DealRankedItem[];
  evidence: ActionEvidence[];
  generatedAt: string;
}
