import type { ActionEvidenceReviewState, MessageReviewState } from "./state";

export function messageReviewLabel(state: string): string {
  const value = state as MessageReviewState;
  if (value === "REVIEWED") return "Message reviewed";
  if (value === "REVIEW_REQUIRED") return "Message review required";
  if (value === "NEEDS_FOLLOW_UP") return "Message needs follow-up";
  return "Message not reviewed";
}

export function actionEvidenceReviewLabel(state: string): string {
  const value = state as ActionEvidenceReviewState;
  if (value === "PENDING") return "Action evidence pending";
  if (value === "REVIEWED") return "Action evidence reviewed";
  return "No action evidence";
}

export function speakerSideLabel(side: string | null): string {
  if (side === "OUR_SIDE") return "Our side";
  if (side === "COUNTERPARTY") return "Counterparty";
  if (side === "UNKNOWN") return "Unknown";
  return "Not recorded";
}
