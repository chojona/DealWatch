import { ActivityStructuredPayloadSchema } from "@/lib/ai/activity/schema";
import type { ReconciliationSide, StructuredReconciliationFact } from "@/lib/deals/reconciliation/types";

export function storedFactValue(payload: unknown): { display: string | null; numeric: number | null; unit: string | null } {
  const parsed = ActivityStructuredPayloadSchema.safeParse(payload);
  if (!parsed.success) return { display: null, numeric: null, unit: null };
  return { display: parsed.data.display, numeric: parsed.data.numeric, unit: parsed.data.unit };
}

export function toStructuredFact(fact: {
  factType: string;
  canonicalType: string | null;
  side: string;
  structuredPayload: unknown;
}): StructuredReconciliationFact {
  const value = storedFactValue(fact.structuredPayload);
  const side: ReconciliationSide = fact.side === "LANDLORD" || fact.side === "TENANT" ? fact.side : "UNKNOWN";
  return {
    factType: fact.factType,
    canonicalType: fact.canonicalType,
    side,
    numeric: value.numeric,
    unit: value.unit,
    display: value.display,
  };
}

export function canonicalLabel(value: string): string {
  return value.toLowerCase().split("_").map((part) => (
    part.length <= 2 ? part.toUpperCase() : part.slice(0, 1).toUpperCase() + part.slice(1)
  )).join(" ");
}

export function activitySideLabel(side: string): string {
  if (side === "LANDLORD") return "Landlord";
  if (side === "TENANT") return "Tenant";
  return "Unknown";
}
