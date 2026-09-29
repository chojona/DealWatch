import { CREStructuredPayloadSchema, type CREStructuredPayload } from "@/lib/ai/negotiation/payloads";
import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";
import { readActionDirective, type ActionSpeakerSide } from "./actionDirectives";
import {
  readExplicitFulfillment,
  resolveFulfillmentTarget,
  type FulfillmentTarget,
} from "./fulfillment";
import { applyTemporalNormalization } from "./temporal";
import { locateEvidence, type LocatedEvidence } from "./evidence";
import {
  ACTIVITY_CONTRACT_VERSION,
  ACTIVITY_EXTRACTOR,
  ACTIVITY_EXTRACTOR_VERSION,
  ACTIVITY_EXTRACTION_PROMPT,
  DETERMINISTIC_ACTIVITY_MODEL,
} from "./prompt";
import {
  ActivityExtractionResultSchema,
  ActivityStructuredPayloadSchema,
  type ActivityFactCandidate,
  type ActivityStructuredPayload,
  type StructuredActionDirective,
} from "./schema";

export interface ActivityExtractionMessage {
  bodyText: string;
  subject?: string | null;
  /**
   * Set only when stored canonical participation already establishes the
   * speaker's side. An email address alone is never a side.
   */
  participationSide?: "TENANT" | "LANDLORD" | null;
  /**
   * Explicit speaker direction already established outside this reader.
   * Sender address alone must not be passed here.
   */
  speakerSide?: ActionSpeakerSide | null;
  /**
   * Earlier reviewed facts in this deal. Used only to set fulfillsFactId
   * when the sentence explicitly identifies one of them.
   */
  fulfillment?: {
    workspaceId: string;
    dealId: string;
    timestamp: string;
    targets: FulfillmentTarget[];
  } | null;
}

export interface ExtractedActivityFact extends ActivityFactCandidate, LocatedEvidence {
  action?: StructuredActionDirective;
}

export interface ActivityExtractorIdentity {
  extractor: string;
  extractorVersion: string;
  contractVersion: string;
  model: string;
  extractionMethod: "DETERMINISTIC" | "MODEL";
}

const MONEY = String.raw`\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)`;
const INJECTION = /ignore (?:all |previous |prior )?instructions|you are now|system prompt|developer message|mark rent as/i;

export function deterministicExtractorIdentity(model = DETERMINISTIC_ACTIVITY_MODEL): ActivityExtractorIdentity {
  return {
    extractor: ACTIVITY_EXTRACTOR,
    extractorVersion: ACTIVITY_EXTRACTOR_VERSION,
    contractVersion: ACTIVITY_CONTRACT_VERSION,
    model,
    extractionMethod: "DETERMINISTIC",
  };
}

export function activityExtractionPrompt(): string {
  return ACTIVITY_EXTRACTION_PROMPT;
}

function dollars(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function money(value: string): number {
  return Number(value.replaceAll(",", ""));
}

function sentences(body: string): string[] {
  return body
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function clauses(sentence: string): string[] {
  const parts = sentence
    .split(/\s*,\s*|\s+and\s+|\s+but\s+/i)
    .map((part) => part.trim().replace(/^[.\s]+|[.\s]+$/g, ""))
    .filter(Boolean);
  return parts.length > 0 ? parts : [sentence];
}

function isSignature(line: string): boolean {
  return /^(best|regards|thanks|thank you|sincerely|cheers)\b/i.test(line)
    || /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/.test(line)
    || /^(tenant broker|landlord broker|example brokerage)$/i.test(line);
}

function isDecoy(clause: string): boolean {
  return /\b(budget|construction|purchase price|irrelevant|not proposing|aren't proposing|are not proposing|do not propose|n't proposing)\b/i.test(clause);
}

function isNonProposal(clause: string): boolean {
  return /\b(discussed|mentioned|for illustration|hypothetical)\b/i.test(clause)
    && !/\b(propos(?:e|es|ed|al)|counter(?:ed|s)?|offer(?:s|ed)?)\b/i.test(clause);
}

function assertionStatus(text: string): ActivityFactCandidate["assertionStatus"] {
  if (/\breject(?:ed|s|ion)?\b/i.test(text)) return "REJECTED";
  if (/\bwithdr(?:aw|awn|ew)\b/i.test(text)) return "WITHDRAWN";
  if (/\b(accepts?|accepted|agrees?|agreed)\b/i.test(text)) return "ACCEPTED";
  if (/\b(last month|previously|earlier|historical|used to|old proposal)\b/i.test(text)) return "HISTORICAL";
  if (/\bunresolved\b/i.test(text)) return "UNRESOLVED";
  return "PROPOSED";
}

function sideOf(text: string, participationSide: "TENANT" | "LANDLORD" | null): ActivityFactCandidate["side"] {
  const landlord = /\blandlord(?:'s)?\b/i.test(text);
  const tenant = /\btenant(?:'s)?\b/i.test(text);
  if (landlord && !tenant) return "LANDLORD";
  if (tenant && !landlord) return "TENANT";
  if (/\b(we|our|us)\b/i.test(text) && participationSide) return participationSide;
  return "UNKNOWN";
}

function envelope(input: {
  display: string;
  numeric: number | null;
  unit: string | null;
  negotiation: CREStructuredPayload | null;
}): ActivityStructuredPayload {
  return ActivityStructuredPayloadSchema.parse(input);
}

function readClause(clause: string): {
  canonicalType: CanonicalTermType;
  display: string;
  numeric: number;
  unit: string;
  negotiation: CREStructuredPayload | null;
} | null {
  const free = clause.match(/(\d+(?:\.\d+)?)\s*months?(?:\s+of)?\s+free\s+rent/i);
  if (free) {
    const numeric = Number(free[1]);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const months = Math.round(numeric);
    return {
      canonicalType: "FREE_RENT",
      numeric: months,
      unit: "MONTHS",
      display: `${months} ${months === 1 ? "month" : "months"}`,
      negotiation: CREStructuredPayloadSchema.parse({
        termType: "FREE_RENT",
        abatement: { kind: "contiguous", months, abatementType: "FULL" },
        scope: null,
      }),
    };
  }

  if (/\b(ti|tenant improvement)\b/i.test(clause)) {
    const amount = clause.match(new RegExp(MONEY, "i"));
    if (!amount) return null;
    const numeric = money(amount[1]);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const perRsf = /(?:\/|\bper\b)\s*rsf\b/i.test(clause);
    if (!perRsf && !/\btotal\b/i.test(clause)) return null;
    const unit = perRsf ? "USD_PER_RSF_YEAR" : "USD";
    return {
      canonicalType: "TI_ALLOWANCE",
      numeric,
      unit,
      display: unit === "USD" ? dollars(numeric) : `${dollars(numeric)} / RSF`,
      negotiation: CREStructuredPayloadSchema.parse({
        termType: "TI_ALLOWANCE",
        amount: unit === "USD" ? { amount: numeric, unit: "USD" } : { amount: numeric, unit: "USD_PER_RSF_YEAR" },
        conditions: [],
        drawDeadline: null,
        unusedConversion: null,
      }),
    };
  }

  const term = clause.match(/(\d+(?:\.\d+)?)\s*-\s*year\s+term/i) ?? clause.match(/(\d+(?:\.\d+)?)\s+years?\s+term/i);
  if (term) {
    const years = Number(term[1]);
    if (!Number.isFinite(years) || years <= 0) return null;
    const months = Math.round(years * 12);
    return {
      canonicalType: "LEASE_TERM",
      numeric: months,
      unit: "MONTHS",
      display: `${years} ${years === 1 ? "year" : "years"}`,
      negotiation: null,
    };
  }

  const rent = clause.match(new RegExp(String.raw`${MONEY}\s*(?:\/|\s+per\s+)rsf(?:\s*(?:\/|\s+per\s+)(?:year|yr))?`, "i"));
  if (rent && /\b(rent|propos|counter|offer|accept|reject|rsf)\b/i.test(clause)) {
    const numeric = money(rent[1]);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return {
      canonicalType: "BASE_RENT",
      numeric,
      unit: "USD_PER_RSF_YEAR",
      display: `${dollars(numeric)} / RSF / year`,
      negotiation: CREStructuredPayloadSchema.parse({
        termType: "BASE_RENT",
        rent: { kind: "simple", amountPerRSFYear: numeric },
      }),
    };
  }

  return null;
}

function attachLocation(body: string, fact: ExtractedActivityFact): ExtractedActivityFact | null {
  if (!body.includes(fact.evidenceQuote)) return null;
  const located = locateEvidence(body, fact.evidenceQuote);
  const payload = envelope({
    display: fact.display,
    numeric: fact.numeric,
    unit: fact.unit,
    negotiation: fact.negotiation,
  });
  return {
    ...fact,
    display: payload.display,
    numeric: payload.numeric,
    unit: payload.unit,
    negotiation: payload.negotiation,
    ...located,
    ...(fact.action ? { action: fact.action } : {}),
  };
}

/**
 * Deterministic activity-fact reader.
 * Sender address is not an input. Participation side is used only for
 * first-person wording when the caller already resolved canonical participation.
 */
export function extractActivityFacts(message: ActivityExtractionMessage): ExtractedActivityFact[] {
  const participationSide = message.participationSide ?? null;
  const facts: ExtractedActivityFact[] = [];
  for (const sentence of sentences(message.bodyText)) {
    if (INJECTION.test(sentence) || isSignature(sentence)) continue;
    const status = assertionStatus(sentence);
    const side = sideOf(sentence, participationSide);
    for (const clause of clauses(sentence)) {
      if (INJECTION.test(clause) || isDecoy(clause) || isNonProposal(clause)) continue;
      if (/\bnot\s+propos/i.test(clause)) continue;
      const read = readClause(clause);
      if (!read) continue;
      const cleaned = clause.replace(/^(?:and|but)\s+/i, "");
      const evidenceQuote = message.bodyText.includes(cleaned) ? cleaned : message.bodyText.includes(clause) ? clause : sentence;
      const fact = attachLocation(message.bodyText, {
        factType: "NEGOTIATION_VALUE",
        canonicalType: read.canonicalType,
        side,
        assertionStatus: status,
        evidenceQuote,
        display: read.display,
        numeric: read.numeric,
        unit: read.unit,
        negotiation: read.negotiation,
        provenanceStatus: "UNLOCATED",
        evidenceStartOffset: null,
        evidenceEndOffset: null,
      });
      if (fact) facts.push(fact);
    }
  }
  const directedSentences = new Set<string>();
  for (const sentence of sentences(message.bodyText)) {
    if (INJECTION.test(sentence) || isSignature(sentence)) continue;
    const directive = readActionDirective(sentence, { speakerSide: message.speakerSide ?? null });
    if (!directive) continue;
    directedSentences.add(sentence);
    const fact = attachLocation(message.bodyText, {
      factType: "OTHER",
      canonicalType: null,
      side: sideOf(sentence, message.participationSide ?? null),
      assertionStatus: "PROPOSED",
      evidenceQuote: sentence,
      display: directive.display,
      numeric: null,
      unit: null,
      negotiation: null,
      action: applyTemporalNormalization(directive.action, sentence),
      provenanceStatus: "UNLOCATED",
      evidenceStartOffset: null,
      evidenceEndOffset: null,
    });
    if (fact) facts.push(fact);
  }
  const linkScope = message.fulfillment ?? null;
  for (const sentence of sentences(message.bodyText)) {
    if (directedSentences.has(sentence) || INJECTION.test(sentence) || isSignature(sentence)) continue;
    const explicit = readExplicitFulfillment(sentence);
    if (!explicit) continue;
    const speakerSide = message.speakerSide === "OUR_SIDE" || message.speakerSide === "COUNTERPARTY"
      ? message.speakerSide
      : "UNKNOWN";
    const fact = attachLocation(message.bodyText, {
      factType: explicit.factType,
      canonicalType: null,
      side: sideOf(sentence, participationSide),
      assertionStatus: "ACCEPTED",
      evidenceQuote: sentence,
      display: explicit.display,
      numeric: null,
      unit: null,
      negotiation: null,
      action: {
        kind: "FULFILLMENT",
        responsibleSide: speakerSide,
        responsibleLabel: null,
        counterpartyLabel: null,
        dueAt: null,
        dueText: null,
        occursAt: null,
        fulfillsFactId: linkScope
          ? resolveFulfillmentTarget(explicit, linkScope.targets, {
            workspaceId: linkScope.workspaceId,
            dealId: linkScope.dealId,
            timestamp: linkScope.timestamp,
          })
          : null,
      },
      provenanceStatus: "UNLOCATED",
      evidenceStartOffset: null,
      evidenceEndOffset: null,
    });
    if (fact) facts.push(fact);
  }
  return facts;
}

function injectionQuote(body: string, quote: string): boolean {
  return sentences(body).some((sentence) => sentence.includes(quote) && INJECTION.test(sentence))
    || INJECTION.test(quote);
}

export function validateActivityFacts(body: string, facts: ActivityFactCandidate[]): ExtractedActivityFact[] {
  const accepted: ExtractedActivityFact[] = [];
  for (const fact of facts) {
    if (injectionQuote(body, fact.evidenceQuote)) continue;
    if (isDecoy(fact.evidenceQuote) || isNonProposal(fact.evidenceQuote) || /\bnot\s+propos/i.test(fact.evidenceQuote)) continue;
    if (fact.factType === "NEGOTIATION_VALUE" && !fact.canonicalType) continue;
    if (fact.negotiation && fact.canonicalType && fact.negotiation.termType !== fact.canonicalType) continue;
    const located = locateEvidence(body, fact.evidenceQuote);
    const payload = envelope({
      display: fact.display,
      numeric: fact.numeric,
      unit: fact.unit,
      negotiation: fact.negotiation,
    });
    accepted.push({
      ...fact,
      display: payload.display,
      numeric: payload.numeric,
      unit: payload.unit,
      negotiation: payload.negotiation,
      ...located,
    });
  }
  return accepted;
}

/**
 * Model boundary. The caller supplies the completion. Tests pass fixture JSON.
 * This function does not contact a model provider.
 */
export async function extractActivityFactsWithModel(
  message: ActivityExtractionMessage,
  complete: (prompt: string) => Promise<string>
): Promise<ExtractedActivityFact[]> {
  const prompt = `${activityExtractionPrompt()}\n\nSUBJECT:\n${message.subject ?? ""}\n\nBODY:\n${message.bodyText}`;
  const raw = await complete(prompt);
  const parsed = ActivityExtractionResultSchema.parse(JSON.parse(raw));
  return validateActivityFacts(message.bodyText, parsed.facts);
}

export function payloadFromFact(fact: ExtractedActivityFact): ActivityStructuredPayload {
  return ActivityStructuredPayloadSchema.parse({
    display: fact.display,
    numeric: fact.numeric,
    unit: fact.unit,
    negotiation: fact.negotiation,
    ...(fact.action ? { action: fact.action } : {}),
  });
}
