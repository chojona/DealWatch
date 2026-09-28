import type { GraphNodeType } from "@/lib/graph/types";

export function canonicalEntityHref(entityType: GraphNodeType, entityId: string): string {
  const base = entityType === "PERSON" ? "people" : entityType === "COMPANY" ? "companies" : entityType === "PROPERTY" ? "properties" : "deals";
  return `/${base}/${entityId}`;
}
