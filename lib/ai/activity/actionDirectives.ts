import {
  StructuredActionDirectiveSchema,
  type StructuredActionDirective,
} from "./schema";

export type ActionSpeakerSide = "OUR_SIDE" | "COUNTERPARTY";

export interface ActionDirectiveContext {
  /**
   * Set only when structured message direction already says whether the
   * speaker is our side or the counterparty. An email address, the latest
   * sender, deal stage, and negotiation status are not this value.
   */
  speakerSide?: ActionSpeakerSide | null;
}

const DOCUMENT_NOUN = /\b(?:proposals?|financials?|documents?|leases?|lois?|term sheets?|rent rolls?|budgets?|invoices?|drafts?|redlines?|attachments?|files?|packages?|exhibits?|certificates?|insurance|comps?|plans?|drawings?|spreadsheets?|models?|underwriting)\b/i;
const WEEKDAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const MONTH = "(?:january|february|march|april|may|june|july|august|september|october|november|december)";
const DUE_TEXT = new RegExp(
  String.raw`\b(by\s+(?:close of business|end of (?:the )?(?:day|week|month)|cob|eod|tomorrow|(?:this |next )?${WEEKDAY}|(?:${MONTH})\s+\d{1,2}(?:,\s+\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?))\b`,
  "i",
);

type DirectiveRole = "ADDRESSEE" | "SPEAKER" | "UNASSIGNED";

interface DirectiveMatch {
  kind: StructuredActionDirective["kind"];
  role: DirectiveRole;
  index: number;
  specificity: number;
}

const MATCHERS: Array<{ kind: StructuredActionDirective["kind"]; role: DirectiveRole; specificity: number; pattern: RegExp }> = [
  {
    kind: "COMMITMENT",
    role: "SPEAKER",
    specificity: 80,
    pattern: /\b(?:i|we)(?:'ll| will)\s+(?:send|provide|forward|share|deliver|confirm|respond|reply|follow up|schedule|call|meet)\b/i,
  },
  {
    kind: "COMMITMENT",
    role: "SPEAKER",
    specificity: 80,
    pattern: /\b(?:i'm|i am|we're|we are)\s+going to\s+(?:send|provide|forward|share|deliver|confirm|respond|reply|follow up|schedule|call|meet)\b/i,
  },
  {
    kind: "FOLLOW_UP_REQUESTED",
    role: "ADDRESSEE",
    specificity: 70,
    pattern: /\b(?:please|kindly)\s+follow up\b/i,
  },
  {
    kind: "FOLLOW_UP_REQUESTED",
    role: "ADDRESSEE",
    specificity: 70,
    pattern: /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?follow up\b/i,
  },
  {
    kind: "CALL_REQUESTED",
    role: "UNASSIGNED",
    specificity: 60,
    pattern: /\b(?:can|could|shall)\s+we\s+(?:please\s+)?(?:schedule|set up|arrange|have|hop on|jump on)\s+(?:a\s+)?call\b/i,
  },
  {
    kind: "CALL_REQUESTED",
    role: "UNASSIGNED",
    specificity: 60,
    pattern: /\blet(?:'s| us)\s+(?:schedule|set up|arrange|have)\s+(?:a\s+)?call\b/i,
  },
  {
    kind: "CALL_REQUESTED",
    role: "ADDRESSEE",
    specificity: 60,
    pattern: /\b(?:please|kindly)\s+(?:schedule|set up|arrange)\s+(?:a\s+)?call\b/i,
  },
  {
    kind: "CALL_REQUESTED",
    role: "ADDRESSEE",
    specificity: 60,
    pattern: /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:schedule|set up|arrange)\s+(?:a\s+)?call\b/i,
  },
  {
    kind: "MEETING_REQUESTED",
    role: "UNASSIGNED",
    specificity: 60,
    pattern: /\blet(?:'s| us)\s+meet\b/i,
  },
  {
    kind: "MEETING_REQUESTED",
    role: "UNASSIGNED",
    specificity: 60,
    pattern: /\b(?:can|could|shall)\s+we\s+meet\b/i,
  },
  {
    kind: "MEETING_REQUESTED",
    role: "ADDRESSEE",
    specificity: 60,
    pattern: /\b(?:please|kindly)\s+(?:schedule|set up|arrange)\s+(?:a\s+)?meeting\b/i,
  },
  {
    kind: "MEETING_REQUESTED",
    role: "UNASSIGNED",
    specificity: 60,
    pattern: /\blet(?:'s| us)\s+(?:schedule|set up|arrange)\s+(?:a\s+)?meeting\b/i,
  },
  {
    kind: "INFORMATION_REQUESTED",
    role: "ADDRESSEE",
    specificity: 90,
    pattern: /\b(?:please|kindly)\s+(?:confirm|clarify|advise)\s+(?:whether|if)\b/i,
  },
  {
    kind: "INFORMATION_REQUESTED",
    role: "ADDRESSEE",
    specificity: 90,
    pattern: /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:confirm|clarify|tell us|let us know|advise)\s+(?:whether|if)\b/i,
  },
  {
    kind: "INFORMATION_REQUESTED",
    role: "ADDRESSEE",
    specificity: 50,
    pattern: /\b(?:please|kindly)\s+(?:provide|share)\s+(?:the\s+)?(?:information|details|status|update)\b/i,
  },
  {
    kind: "DOCUMENT_REQUESTED",
    role: "ADDRESSEE",
    specificity: 75,
    pattern: /\b(?:please|kindly)\s+(?:send|forward|share|provide)\b/i,
  },
  {
    kind: "DOCUMENT_REQUESTED",
    role: "ADDRESSEE",
    specificity: 75,
    pattern: /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:send|forward|share|provide)\b/i,
  },
  {
    kind: "DOCUMENT_REQUESTED",
    role: "ADDRESSEE",
    specificity: 75,
    pattern: /\bwould you mind sending\b/i,
  },
  {
    kind: "DOCUMENT_REQUESTED",
    role: "ADDRESSEE",
    specificity: 75,
    pattern: /\bsend\s+(?:us|me)\s+(?:the|a|an|your|our)\b/i,
  },
  {
    kind: "RESPONSE_REQUESTED",
    role: "ADDRESSEE",
    specificity: 40,
    pattern: /\b(?:please|kindly)\s+(?:respond|reply|confirm)\b/i,
  },
  {
    kind: "RESPONSE_REQUESTED",
    role: "ADDRESSEE",
    specificity: 40,
    pattern: /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:respond|reply|confirm)\b/i,
  },
  {
    kind: "NEXT_STEP",
    role: "UNASSIGNED",
    specificity: 30,
    pattern: /\bnext step is to\s+(?:send|provide|forward|share|confirm|respond|reply|follow up|schedule|call|meet)\b/i,
  },
];

const DISPLAY: Record<Exclude<StructuredActionDirective["kind"], "FULFILLMENT" | "SCHEDULED">, string> = {
  RESPONSE_REQUESTED: "Response requested",
  FOLLOW_UP_REQUESTED: "Follow-up requested",
  DOCUMENT_REQUESTED: "Document requested",
  INFORMATION_REQUESTED: "Information requested",
  MEETING_REQUESTED: "Meeting requested",
  CALL_REQUESTED: "Call requested",
  COMMITMENT: "Commitment",
  NEXT_STEP: "Next step",
};

function normalize(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

function blocked(text: string): boolean {
  if (text.length > 600) return true;
  if (/^>/.test(text)) return true;
  if (/\b(?:ignore (?:all |previous |prior )?instructions|you are now|system prompt|developer message)\b/i.test(text)) return true;
  if (/\b(?:last (?:week|month|year|quarter)|previously|earlier|historical|used to|yesterday|\d+\s+(?:days|weeks|months|years) ago)\b/i.test(text)) return true;
  if (/\b(?:discussed|talked about|spoke about|mentioned|conversation about)\b/i.test(text)) return true;
  if (/\b(?:said|wrote|emailed|texted|told|asked|quoted)\b/i.test(text)) return true;
  if (/\b(?:maybe|might|perhaps|possibly|probably|may)\b/i.test(text)) return true;
  if (/\bcould\b/i.test(text) && !/\bcould you\b/i.test(text)) return true;
  if (/\bwould\b/i.test(text) && !/\bwould you\b/i.test(text)) return true;
  if (/\b(?:unless|in case|assuming|provided that|as long as)\b/i.test(text)) return true;
  if (/^\s*if\b/i.test(text)) return true;
  if (/\bif (?:they|he|she|we|i|you|the|ownership|landlord|tenant)\b/i.test(text) && !/\b(?:confirm|clarify|advise) if\b/i.test(text)) return true;
  if (/\b(?:no need to|do not need to|don't need to|not necessary to|no longer)\b/i.test(text)) return true;
  if (/\b(?:wasn't|was not|weren't|were not|isn't|is not|aren't|are not)\b[^.]{0,48}\b(?:requested|needed|required|asking)\b/i.test(text)) return true;
  if (/\b(?:not requested|never requested|n't requested)\b/i.test(text)) return true;
  if (/\b(?:do not|don't|never|not)\s+(?:send|share|provide|forward|schedule|meet|call|follow up|respond|reply|confirm)\b/i.test(text)) return true;
  if (/"[^"]{0,300}\b(?:please|send|we'll|we will|i'll|i will|let's)\b[^"]{0,160}"/i.test(text)) return true;
  return false;
}

function responsibleSide(role: DirectiveRole, speakerSide: ActionSpeakerSide | null): StructuredActionDirective["responsibleSide"] {
  if (!speakerSide || role === "UNASSIGNED") return "UNKNOWN";
  if (role === "SPEAKER") return speakerSide;
  return speakerSide === "OUR_SIDE" ? "COUNTERPARTY" : "OUR_SIDE";
}

function dueText(original: string): string | null {
  return original.match(DUE_TEXT)?.[1] ?? null;
}

/**
 * One explicit current directive from a single sentence, or null.
 * Historical, hypothetical, negated, quoted, conditional, speculative,
 * and descriptive wording produces nothing. Due text is preserved verbatim.
 * dueAt and occursAt stay empty; this reader does not normalize dates.
 */
export function readActionDirective(
  sentence: string,
  context: ActionDirectiveContext = {},
): { action: StructuredActionDirective; display: string } | null {
  const text = normalize(sentence).trim();
  if (!text || blocked(text)) return null;
  let selected: DirectiveMatch | null = null;
  for (const matcher of MATCHERS) {
    const found = matcher.pattern.exec(text);
    if (!found || found.index < 0) continue;
    if (matcher.kind === "DOCUMENT_REQUESTED" && !DOCUMENT_NOUN.test(text)) continue;
    const candidate: DirectiveMatch = {
      kind: matcher.kind,
      role: matcher.role,
      index: found.index,
      specificity: matcher.specificity,
    };
    if (
      !selected
      || candidate.index < selected.index
      || (candidate.index === selected.index && candidate.specificity > selected.specificity)
    ) {
      selected = candidate;
    }
  }
  if (!selected) return null;
  const speakerSide = context.speakerSide ?? null;
  const action = StructuredActionDirectiveSchema.parse({
    kind: selected.kind,
    responsibleSide: responsibleSide(selected.role, speakerSide),
    responsibleLabel: null,
    counterpartyLabel: null,
    dueAt: null,
    dueText: dueText(sentence),
    occursAt: null,
    fulfillsFactId: null,
  });
  return { action, display: DISPLAY[action.kind as keyof typeof DISPLAY] };
}
