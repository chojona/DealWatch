import { StructuredActionDirectiveSchema } from "./schema";

/**
 * Deterministic explicit fulfillment.
 * A sentence qualifies only when it both reports current delivery and
 * explicitly refers to a prior request. Similarity, a shared noun alone,
 * a shared date, proximity, and "the only open action" do not qualify.
 * The link stays empty when the reference matches more than one earlier fact.
 */

export interface ExplicitFulfillment {
  factType: "DOCUMENT_SENT" | "DOCUMENT_RECEIVED" | "OTHER";
  display: string;
  referents: Array<{ noun: string; modifier: string | null }>;
}

export interface FulfillmentTarget {
  id: string;
  workspaceId: string;
  dealId: string;
  timestamp: string;
  assertionStatus: string;
  evidenceQuote: string;
  provenanceStatus: string;
  reviewed: boolean;
  actionKind: string | null;
}

export interface FulfillmentScope {
  workspaceId: string;
  dealId: string;
  timestamp: string;
}

const REFERENCE = /\b(?:you requested|you asked for|as requested|per your request|following up on your request)\b/i;
const SENDING = /\b(?:attached|enclosed|here(?:'s| is| are)|sending|please find|forwarding)\b|\b(?:i|we)\s+(?:have\s+)?sent\b/i;
const RECEIVING = /\b(?:i|we)\s+(?:have\s+)?received\b|\breceipt of\b|\bwe received\b|\bi received\b/i;
const MODIFIER_SOURCE = "revised|updated|latest|current|final|redlined|executed|signed";

const REQUEST_KINDS = new Set([
  "DOCUMENT_REQUESTED",
  "INFORMATION_REQUESTED",
  "RESPONSE_REQUESTED",
  "FOLLOW_UP_REQUESTED",
  "MEETING_REQUESTED",
  "CALL_REQUESTED",
]);

const TRUSTED_ASSERTIONS = new Set(["PROPOSED", "ACCEPTED", "UNRESOLVED"]);

const NOUNS: Array<{ stem: string; pattern: RegExp }> = [
  { stem: "term sheet", pattern: /\bterm sheets?\b/gi },
  { stem: "rent roll", pattern: /\brent rolls?\b/gi },
  { stem: "proposal", pattern: /\bproposals?\b/gi },
  { stem: "financial", pattern: /\bfinancials?\b/gi },
  { stem: "document", pattern: /\bdocuments?\b/gi },
  { stem: "certificate", pattern: /\bcertificates?\b/gi },
  { stem: "spreadsheet", pattern: /\bspreadsheets?\b/gi },
  { stem: "underwriting", pattern: /\bunderwriting\b/gi },
  { stem: "attachment", pattern: /\battachments?\b/gi },
  { stem: "insurance", pattern: /\binsurance\b/gi },
  { stem: "redline", pattern: /\bredlines?\b/gi },
  { stem: "invoice", pattern: /\binvoices?\b/gi },
  { stem: "package", pattern: /\bpackages?\b/gi },
  { stem: "exhibit", pattern: /\bexhibits?\b/gi },
  { stem: "drawing", pattern: /\bdrawings?\b/gi },
  { stem: "budget", pattern: /\bbudgets?\b/gi },
  { stem: "lease", pattern: /\bleases?\b/gi },
  { stem: "draft", pattern: /\bdrafts?\b/gi },
  { stem: "model", pattern: /\bmodels?\b/gi },
  { stem: "file", pattern: /\bfiles?\b/gi },
  { stem: "plan", pattern: /\bplans?\b/gi },
  { stem: "comp", pattern: /\bcomps?\b/gi },
  { stem: "loi", pattern: /\blois?\b/gi },
];

function normalize(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

function blocked(text: string): boolean {
  if (text.length > 600) return true;
  if (/^>/.test(text)) return true;
  if (/\b(?:ignore (?:all |previous |prior )?instructions|you are now|system prompt|developer message)\b/i.test(text)) return true;
  if (/\b(?:last (?:week|month|year|quarter)|previously|earlier|historical|used to|yesterday|\d+\s+(?:days|weeks|months|years) ago)\b/i.test(text)) return true;
  if (/\b(?:was|were|had been)\s+sent\b/i.test(text)) return true;
  if (/\b(?:said|wrote|emailed|texted|told|quoted|according to)\b/i.test(text)) return true;
  if (/["'][^"']{0,400}\b(?:attached|enclosed|here is|here are|as requested|you requested|per your request)\b[^"']{0,200}["']/i.test(text)) return true;
  if (/\b(?:maybe|might|perhaps|possibly|probably|may)\b/i.test(text)) return true;
  if (/\b(?:unless|in case|assuming|provided that|as long as)\b/i.test(text)) return true;
  if (/^\s*if\b/i.test(text) || /\bif (?:they|he|she|we|i|you|the|ownership|landlord|tenant)\b/i.test(text)) return true;
  if (/\b(?:no|not|never|n't)\b/i.test(text) && /\b(?:sent|send|attached|enclosed|delivered|sending|forwarded|received|fulfilled)\b/i.test(text)) return true;
  if (/\?\s*$/.test(text)) return true;
  if (/^(?:did|do|does|have|has|is|are|was|were|can|could|would|will|shall)\b/i.test(text)) return true;
  return false;
}

function referents(text: string): ExplicitFulfillment["referents"] {
  const found: Array<{ noun: string; modifier: string | null; index: number }> = [];
  for (const noun of NOUNS) {
    const pattern = new RegExp(noun.pattern.source, "gi");
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? -1;
      if (index < 0) continue;
      const before = text.slice(Math.max(0, index - 48), index);
      const tail = before.split(/\s+/).slice(-5).join(" ");
      const modifiers = [...tail.matchAll(new RegExp(`\\b(${MODIFIER_SOURCE})\\b`, "gi"))];
      found.push({
        noun: noun.stem,
        modifier: modifiers.at(-1)?.[1]?.toLowerCase() ?? null,
        index,
      });
    }
  }
  found.sort((left, right) => left.index - right.index || left.noun.localeCompare(right.noun));
  const kept: ExplicitFulfillment["referents"] = [];
  let occupiedUntil = -1;
  for (const item of found) {
    if (item.index < occupiedUntil) continue;
    kept.push({ noun: item.noun, modifier: item.modifier });
    occupiedUntil = item.index + 1;
  }
  return kept;
}

/**
 * Current delivery plus an explicit back-reference, or null.
 * This function does not choose an earlier fact.
 */
export function readExplicitFulfillment(sentence: string): ExplicitFulfillment | null {
  const text = normalize(sentence).trim();
  if (!text || blocked(text) || !REFERENCE.test(text)) return null;
  const receiving = RECEIVING.test(text);
  const sending = SENDING.test(text);
  if (!receiving && !sending) return null;
  const names = referents(text);
  if (receiving && !sending) {
    return {
      factType: names.length > 0 ? "DOCUMENT_RECEIVED" : "OTHER",
      display: names.length > 0 ? "Document received" : "Fulfillment",
      referents: names,
    };
  }
  return {
    factType: names.length > 0 ? "DOCUMENT_SENT" : "OTHER",
    display: names.length > 0 ? "Document sent" : "Fulfillment",
    referents: names,
  };
}

function matchesReferent(quote: string, referent: ExplicitFulfillment["referents"][number]): boolean {
  const noun = NOUNS.find((item) => item.stem === referent.noun);
  if (!noun || !new RegExp(noun.pattern.source, "i").test(quote)) return false;
  if (!referent.modifier) return true;
  return new RegExp(`\\b${referent.modifier}\\b`, "i").test(quote);
}

function eligible(target: FulfillmentTarget, scope: FulfillmentScope): boolean {
  if (target.workspaceId !== scope.workspaceId || target.dealId !== scope.dealId) return false;
  if (!target.reviewed || target.provenanceStatus !== "EXACT" || !target.evidenceQuote.trim()) return false;
  if (!TRUSTED_ASSERTIONS.has(target.assertionStatus)) return false;
  if (!target.actionKind || !REQUEST_KINDS.has(target.actionKind)) return false;
  const targetTime = Date.parse(target.timestamp);
  const currentTime = Date.parse(scope.timestamp);
  if (Number.isNaN(targetTime) || Number.isNaN(currentTime) || targetTime >= currentTime) return false;
  return true;
}

/**
 * One earlier reviewed request, or null when the reference is missing, ambiguous, or ineligible.
 * An empty candidate list never becomes "the newest" or "the only" action.
 */
export function resolveFulfillmentTarget(
  fulfillment: ExplicitFulfillment,
  targets: FulfillmentTarget[],
  scope: FulfillmentScope,
): string | null {
  const pool = targets.filter((target) => eligible(target, scope));
  const matched = fulfillment.referents.length === 0
    ? pool
    : pool.filter((target) => fulfillment.referents.some((referent) => matchesReferent(target.evidenceQuote, referent)));
  return matched.length === 1 ? matched[0]!.id : null;
}

export function fulfillmentTargetFromPayload(input: {
  id: string;
  workspaceId: string;
  dealId: string;
  timestamp: string;
  assertionStatus: string;
  evidenceQuote: string;
  provenanceStatus: string;
  reviewed: boolean;
  payload: unknown;
}): FulfillmentTarget {
  let actionKind: string | null = null;
  if (input.payload && typeof input.payload === "object" && "action" in input.payload) {
    const parsed = StructuredActionDirectiveSchema.safeParse((input.payload as { action?: unknown }).action);
    if (parsed.success) actionKind = parsed.data.kind;
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    dealId: input.dealId,
    timestamp: input.timestamp,
    assertionStatus: input.assertionStatus,
    evidenceQuote: input.evidenceQuote,
    provenanceStatus: input.provenanceStatus,
    reviewed: input.reviewed,
    actionKind,
  };
}
