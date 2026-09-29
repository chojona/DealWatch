import type { ExtractedActivityFact } from "@/lib/ai/activity/extractActivityFacts";
import { CREStructuredPayloadSchema } from "@/lib/ai/negotiation/payloads";
import { shouldFailOnce } from "./failOnce";
import { isE2ETestMode } from "./mode";

const MISREAD = /E2E_MISREAD_BASE_RENT:(\d+(?:\.\d+)?)/;

/** Test-only fail-once gate in front of the deterministic activity reader. */
export function applyE2EActivityGate(bodyText: string): void {
  if (!isE2ETestMode() || !bodyText.includes("E2E_FAIL_ONCE")) return;
  if (shouldFailOnce(`message:${bodyText}`)) {
    throw new Error("E2E message analysis failed once");
  }
}

/**
 * Keeps the deterministic reader, then replaces the base-rent scalar when a
 * fixture asks for an intentional misread. The evidence quote stays the
 * source sentence.
 */
export function rewriteE2EMisread(bodyText: string, facts: ExtractedActivityFact[]): ExtractedActivityFact[] {
  if (!isE2ETestMode()) return facts;
  const match = bodyText.match(MISREAD);
  if (!match) return facts;
  const numeric = Number(match[1]);
  const display = `$${numeric.toFixed(2)} / RSF / year`;
  return facts.map((fact) => {
    if (fact.canonicalType !== "BASE_RENT") return fact;
    return {
      ...fact,
      display,
      numeric,
      negotiation: CREStructuredPayloadSchema.parse({
        termType: "BASE_RENT",
        rent: { kind: "simple", amountPerRSFYear: numeric },
      }),
    };
  });
}
