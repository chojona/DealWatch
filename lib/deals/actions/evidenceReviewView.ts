import {
  STRUCTURED_ACTION_KINDS,
  STRUCTURED_RESPONSIBLE_SIDES,
  type StructuredActionDirective,
} from "@/lib/ai/activity/schema";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const STORED_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export const ACTION_KIND_LABELS: Record<StructuredActionDirective["kind"], string> = {
  RESPONSE_REQUESTED: "Response requested",
  FOLLOW_UP_REQUESTED: "Follow-up requested",
  DOCUMENT_REQUESTED: "Document requested",
  INFORMATION_REQUESTED: "Information requested",
  MEETING_REQUESTED: "Meeting requested",
  CALL_REQUESTED: "Call requested",
  COMMITMENT: "Commitment",
  NEXT_STEP: "Next step",
  FULFILLMENT: "Fulfillment",
  SCHEDULED: "Scheduled",
};

export const RESPONSIBLE_SIDE_LABELS: Record<StructuredActionDirective["responsibleSide"], string> = {
  OUR_SIDE: "Our side",
  COUNTERPARTY: "Counterparty",
  BOTH: "Both",
  UNKNOWN: "Unknown",
};

const CORRECTABLE_KINDS = STRUCTURED_ACTION_KINDS.filter((kind) => kind !== "FULFILLMENT" && kind !== "SCHEDULED");

export interface ActionEvidenceChoice {
  factId: string;
  evidenceQuote: string;
  href: string;
  whenLabel: string;
  senderLabel: string | null;
}

export interface ActionEvidenceReviewItem {
  factId: string;
  messageId: string;
  href: string;
  headline: "ACTION DETECTED" | "FULFILLMENT DETECTED" | "FULFILLMENT NEEDS REVIEW";
  title: string;
  kindLabel: string;
  kindValue: StructuredActionDirective["kind"];
  responsibleSideLabel: string;
  responsibleSideValue: StructuredActionDirective["responsibleSide"];
  dueAtLabel: string | null;
  occursAtLabel: string | null;
  dueText: string | null;
  evidenceQuote: string;
  sourceTimestampLabel: string;
  senderLabel: string | null;
  linkedRequest: ActionEvidenceChoice | null;
  sentLabel: string | null;
  choices: ActionEvidenceChoice[];
  requiresTargetChoice: boolean;
  canCorrectInterpretation: boolean;
  canDiscardNormalizedInstant: boolean;
  kindOptions: Array<{ value: StructuredActionDirective["kind"]; label: string }>;
  sideOptions: Array<{ value: StructuredActionDirective["responsibleSide"]; label: string }>;
}

export function actionKindLabel(kind: string): string {
  if (kind in ACTION_KIND_LABELS) return ACTION_KIND_LABELS[kind as StructuredActionDirective["kind"]];
  return "Action";
}

export function responsibleSideLabel(side: string): string {
  if (side in RESPONSIBLE_SIDE_LABELS) return RESPONSIBLE_SIDE_LABELS[side as StructuredActionDirective["responsibleSide"]];
  return "Not specified";
}

/**
 * Display the wall time already stored on the instant.
 * The offset in the value is shown as stored. No timezone is inferred.
 */
export function formatStoredInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = STORED_INSTANT.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour24 = Number(match[4]);
  const minute = match[5] ?? "00";
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour24 > 23) return null;
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const zone = match[6] === "Z" ? "UTC" : match[6];
  return `${MONTHS[month - 1]} ${day}, ${year} · ${hour12}:${minute} ${suffix} ${zone}`;
}

export function formatSourceTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

export function formatSourceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function presentActionEvidence(input: {
  directive: StructuredActionDirective;
  factId: string;
  messageId: string;
  evidenceQuote: string;
  timestamp: string;
  senderLabel: string | null;
  linkedRequest: ActionEvidenceChoice | null;
  choices: ActionEvidenceChoice[];
}): ActionEvidenceReviewItem {
  const fulfillment = input.directive.kind === "FULFILLMENT";
  const dueAtLabel = formatStoredInstant(input.directive.dueAt);
  const occursAtLabel = formatStoredInstant(input.directive.occursAt);
  const needsChoice = fulfillment && !input.directive.fulfillsFactId && input.choices.length > 0;
  const undetermined = fulfillment && !input.linkedRequest && !input.directive.fulfillsFactId;
  return {
    factId: input.factId,
    messageId: input.messageId,
    href: `/messages/${input.messageId}`,
    headline: !fulfillment
      ? "ACTION DETECTED"
      : needsChoice || undetermined
        ? "FULFILLMENT NEEDS REVIEW"
        : "FULFILLMENT DETECTED",
    title: actionKindLabel(input.directive.kind),
    kindLabel: actionKindLabel(input.directive.kind),
    kindValue: input.directive.kind,
    responsibleSideLabel: responsibleSideLabel(input.directive.responsibleSide),
    responsibleSideValue: input.directive.responsibleSide,
    dueAtLabel,
    occursAtLabel,
    dueText: input.directive.dueText,
    evidenceQuote: input.evidenceQuote,
    sourceTimestampLabel: formatSourceTimestamp(input.timestamp),
    senderLabel: input.senderLabel,
    linkedRequest: input.linkedRequest,
    sentLabel: fulfillment ? formatSourceDate(input.timestamp) : null,
    choices: fulfillment ? input.choices : [],
    requiresTargetChoice: needsChoice,
    canCorrectInterpretation: !fulfillment,
    canDiscardNormalizedInstant: !fulfillment && Boolean(dueAtLabel || occursAtLabel),
    kindOptions: CORRECTABLE_KINDS.map((kind) => ({ value: kind, label: ACTION_KIND_LABELS[kind] })),
    sideOptions: STRUCTURED_RESPONSIBLE_SIDES.map((side) => ({ value: side, label: RESPONSIBLE_SIDE_LABELS[side] })),
  };
}
