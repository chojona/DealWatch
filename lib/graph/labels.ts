import type { GraphFilterGroup } from "./types";

/** Sentence-case relationship names for the map. Not schema identifiers. */
export function relationshipLabel(relationshipType: string, custom?: string | null): string {
  if (relationshipType === "OTHER" && custom?.trim()) return custom.trim();
  if (relationshipType === "REPRESENTS_ON_DEAL") return "Represents";
  if (relationshipType === "CONCERNS_PROPERTY") return "Concerns property";
  const words = relationshipType.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return relationshipType;
  const [first, ...rest] = words;
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${rest.length ? ` ${rest.join(" ")}` : ""}`;
}

export function filterGroupFor(relationshipType: string): GraphFilterGroup {
  if (relationshipType === "WORKS_AT") return "employment";
  if (relationshipType === "MANAGES") return "management";
  if (relationshipType === "REPRESENTS_ON_DEAL") return "representation";
  if (
    relationshipType === "OWNS" ||
    relationshipType === "OCCUPIES" ||
    relationshipType === "DEVELOPED" ||
    relationshipType === "LENDS_ON"
  ) {
    return "ownership";
  }
  return "deal_participation";
}

export function assertionNoun(type: GraphEdgeAssertion): string {
  if (type === "PropertyStake") return "Property stake";
  if (type === "DealParticipation") return "Deal participation";
  if (type === "DealProperty") return "Deal property link";
  return "Employment";
}

type GraphEdgeAssertion = "Employment" | "PropertyStake" | "DealParticipation" | "DealProperty";
