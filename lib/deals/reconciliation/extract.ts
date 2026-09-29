import type { ReconciliationSide } from "./types";

export interface ExtractedFact {
  canonicalType: string;
  numeric: number;
  unit: string;
  display: string;
}

export interface ActivityReading {
  side: ReconciliationSide;
  facts: ExtractedFact[];
  /** Set only when the text names a term without a parseable value. */
  qualitativeType: "BASE_RENT" | "TI_ALLOWANCE" | "FREE_RENT" | null;
}

const MONEY = String.raw`\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)`;
const RSF = String.raw`(?:\/|\bper\b)\s*(?:rsf|rentable square foot|rentable square feet)\b`;

function money(value: string): number {
  return Number(value.replaceAll(",", ""));
}

function dollars(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function explicitSide(text: string): ReconciliationSide {
  const withoutAllowance = text.replace(/\btenant improvements?\b/gi, "ti");
  const landlord = /\blandlord\s+(issued|proposed|countered|submitted|offers|offered)\b/i.test(withoutAllowance)
    || /\blandlord(?:'s)?\s+(?:rent\s+)?(?:counter|proposal|position)\b/i.test(withoutAllowance);
  const tenant = /\btenant\s+(issued|proposed|countered|submitted|offers|offered)\b/i.test(withoutAllowance)
    || /\btenant(?:'s)?\s+(?:rent\s+)?(?:counter|proposal|position)\b/i.test(withoutAllowance);
  if (landlord === tenant) return "UNKNOWN";
  return landlord ? "LANDLORD" : "TENANT";
}

function clauses(text: string): string[] {
  return text
    .split(/\n+|;\s*|,\s*(?=\$|\d)/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function factFromClause(clause: string): ExtractedFact | null {
  const free = clause.match(new RegExp(String.raw`(\d+(?:\.\d+)?)\s*mo(?:nths?)?\s+free\s+rent`, "i"))
    ?? clause.match(new RegExp(String.raw`free\s+rent\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*mo(?:nths?)?`, "i"));
  if (free && /\bfree\s+rent\b/i.test(clause)) {
    const numeric = Number(free[1]);
    if (!Number.isFinite(numeric)) return null;
    return {
      canonicalType: "FREE_RENT",
      numeric,
      unit: "MONTHS",
      display: `${numeric} ${numeric === 1 ? "month" : "months"}`,
    };
  }

  const tiAmount = clause.match(new RegExp(String.raw`${MONEY}\s*(?:${RSF}\s*)?(?:ti\b|tenant improvement)`, "i"))
    ?? clause.match(new RegExp(String.raw`(?:ti|tenant improvement)(?:\s+allowance)?\s*[:\-]?\s*${MONEY}`, "i"));
  if (tiAmount && /\b(ti|tenant improvement)\b/i.test(clause)) {
    const numeric = money(tiAmount[1]);
    if (!Number.isFinite(numeric)) return null;
    const perRsf = new RegExp(RSF, "i").test(clause);
    const total = /\btotal\b/i.test(clause);
    if (!perRsf && !total) return null;
    const unit = perRsf ? "USD_PER_RSF_YEAR" : "USD";
    return {
      canonicalType: "TI_ALLOWANCE",
      numeric,
      unit,
      display: unit === "USD" ? dollars(numeric) : `${dollars(numeric)} / RSF`,
    };
  }

  const monthly = clause.match(new RegExp(String.raw`${MONEY}\s+total\s+monthly(?:\s+rent)?`, "i"))
    ?? clause.match(new RegExp(String.raw`${MONEY}\s*(?:\/|\bper\b)\s*month\b`, "i"));
  if (monthly && !new RegExp(RSF, "i").test(clause)) {
    const numeric = money(monthly[1]);
    if (!Number.isFinite(numeric)) return null;
    return {
      canonicalType: "BASE_RENT",
      numeric,
      unit: "USD_PER_MONTH",
      display: `${dollars(numeric)} total monthly`,
    };
  }

  const rent = clause.match(new RegExp(String.raw`${MONEY}\s*${RSF}`, "i"));
  if (rent) {
    const numeric = money(rent[1]);
    if (!Number.isFinite(numeric)) return null;
    return {
      canonicalType: "BASE_RENT",
      numeric,
      unit: "USD_PER_RSF_YEAR",
      display: `${dollars(numeric)} / RSF / year`,
    };
  }

  return null;
}

function qualitativeType(text: string): ActivityReading["qualitativeType"] {
  const moved = /\b(came down|came up|reduced|increased|moved|countered)\b/i.test(text);
  if (!moved) return null;
  if (/\bfree\s+rent\b/i.test(text)) return "FREE_RENT";
  if (/\b(ti|tenant improvement|allowance)\b/i.test(text)) return "TI_ALLOWANCE";
  if (/\brent\b/i.test(text)) return "BASE_RENT";
  return null;
}

/**
 * Reads only explicit stored amounts and actor phrases.
 * A message sender is never consulted.
 */
export function readActivityText(description: string, evidenceQuote: string): ActivityReading {
  const text = `${description}\n${evidenceQuote}`;
  const facts = clauses(text)
    .map(factFromClause)
    .filter((fact): fact is ExtractedFact => fact !== null);
  const unique = new Map<string, ExtractedFact>();
  for (const fact of facts) {
    unique.set(`${fact.canonicalType}:${fact.unit}:${fact.numeric}`, fact);
  }
  const parsed = [...unique.values()];
  return {
    side: explicitSide(text),
    facts: parsed,
    qualitativeType: parsed.length === 0 ? qualitativeType(text) : null,
  };
}
