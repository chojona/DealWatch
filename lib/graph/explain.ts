import type { GraphNodeType } from "./types";

export interface PathFact {
  subject: string;
  /** Canonical verb phrase, such as "works at" or "is the landlord on". */
  predicate: string;
  object: string;
  objectType: GraphNodeType;
}

const PARTICIPATION: Record<string, string> = {
  TENANT: "is the tenant on",
  LANDLORD: "is the landlord on",
  TENANT_BROKER: "represented the tenant on",
  LANDLORD_BROKER: "represented the landlord on",
  TENANT_BROKERAGE: "is the tenant brokerage on",
  LANDLORD_BROKERAGE: "is the landlord brokerage on",
  GUARANTOR: "is the guarantor on",
  LENDER: "is the lender on",
  ATTORNEY: "is counsel on",
  OTHER: "participates on",
};

/**
 * One English clause per canonical edge. Verbs come from the stored
 * relationship type. Nothing is added about acquaintance or introduction.
 */
export function factForRelationship(input: {
  relationshipType: string;
  label: string;
  sourceLabel: string;
  targetLabel: string;
  sourceType: GraphNodeType;
  targetType: GraphNodeType;
}): PathFact {
  const source = input.sourceLabel;
  const target = input.targetLabel;
  if (input.relationshipType === "WORKS_AT") {
    return { subject: source, predicate: "works at", object: target, objectType: input.targetType };
  }
  if (input.relationshipType === "OWNS") {
    return { subject: source, predicate: "owns", object: target, objectType: input.targetType };
  }
  if (input.relationshipType === "MANAGES") {
    return { subject: source, predicate: "manages", object: target, objectType: input.targetType };
  }
  if (input.relationshipType === "OCCUPIES") {
    return { subject: source, predicate: "occupies", object: target, objectType: input.targetType };
  }
  if (input.relationshipType === "DEVELOPED") {
    return { subject: source, predicate: "developed", object: target, objectType: input.targetType };
  }
  if (input.relationshipType === "LENDS_ON") {
    return { subject: source, predicate: "lends on", object: target, objectType: input.targetType };
  }
  if (input.relationshipType === "CONCERNS_PROPERTY") {
    return { subject: source, predicate: "concerns", object: target, objectType: input.targetType };
  }
  if (input.relationshipType === "REPRESENTS_ON_DEAL") {
    return { subject: source, predicate: "represents", object: target, objectType: input.targetType };
  }
  const predicate = PARTICIPATION[input.relationshipType] ?? `is recorded as ${input.label.toLowerCase()} on`;
  return { subject: source, predicate, object: target, objectType: input.targetType };
}

function continuesOnSameObject(previous: PathFact, next: PathFact): boolean {
  return previous.object === next.object && previous.subject !== next.subject;
}

export function explainConnectionFacts(facts: PathFact[]): string {
  if (facts.length === 0) return "";
  let text = `${facts[0].subject} ${facts[0].predicate} ${facts[0].object}`;
  for (let index = 1; index < facts.length; index += 1) {
    const previous = facts[index - 1];
    const next = facts[index];
    if (previous.object === next.subject) {
      const relative = next.subject && previous.objectType === "PERSON" ? "who" : "which";
      text += `, ${relative} ${next.predicate} ${next.object}`;
      continue;
    }
    if (continuesOnSameObject(previous, next)) {
      if (next.predicate.endsWith(" on")) {
        text += `, where ${next.subject} ${next.predicate.slice(0, -3)}`;
      } else {
        text += `, where ${next.subject} ${next.predicate} ${next.object}`;
      }
      continue;
    }
    text += `. ${next.subject} ${next.predicate} ${next.object}`;
  }
  return `${text}.`;
}
