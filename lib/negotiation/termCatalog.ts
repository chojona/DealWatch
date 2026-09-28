import type { CanonicalTermType } from "@/lib/ai/negotiation/schemas";

export const TERM_CATALOG: ReadonlyArray<{
  type: CanonicalTermType;
  label: string;
  significance: number;
}> = [
  { type: "BASE_RENT", label: "Base rent", significance: 100 },
  { type: "PREMISES_RSF", label: "Premises / RSF", significance: 95 },
  { type: "LEASE_TERM", label: "Lease term", significance: 90 },
  { type: "TI_ALLOWANCE", label: "TI allowance", significance: 85 },
  { type: "COMMENCEMENT_DATE", label: "Commencement date", significance: 80 },
  { type: "FREE_RENT", label: "Free rent / abatement", significance: 75 },
  { type: "RENT_STRUCTURE", label: "Rent structure", significance: 70 },
  { type: "ANNUAL_ESCALATION", label: "Annual escalation", significance: 65 },
  { type: "OPERATING_EXPENSES", label: "Operating expenses", significance: 60 },
  { type: "SECURITY_DEPOSIT", label: "Security deposit", significance: 55 },
  { type: "TERMINATION_RIGHTS", label: "Termination rights", significance: 50 },
  { type: "RENEWAL_OPTIONS", label: "Renewal options", significance: 45 },
  { type: "EXPANSION_RIGHTS", label: "Expansion rights", significance: 40 },
  { type: "ASSIGNMENT_SUBLETTING", label: "Assignment / subletting", significance: 35 },
  { type: "PARKING", label: "Parking", significance: 30 },
  { type: "DELIVERY_CONDITION", label: "Delivery condition", significance: 25 },
] as const;

export const TERM_LABELS = Object.fromEntries(
  TERM_CATALOG.map((item) => [item.type, item.label])
) as Record<CanonicalTermType, string>;
