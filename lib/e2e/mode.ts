/**
 * Deterministic browser analysis is off unless every condition holds.
 * Next.js sets NODE_ENV itself (`development` for `next dev`, `production`
 * for `next start`), so production exclusion is the hard gate and the two
 * explicit flags are the opt-in. Setting the flags in production does nothing.
 */
const E2E_CONFIRMATION = "deterministic-analysis";

export function isE2ETestMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEALWATCH_E2E === "1"
    && process.env.DEALWATCH_E2E_CONFIRM === E2E_CONFIRMATION;
}
