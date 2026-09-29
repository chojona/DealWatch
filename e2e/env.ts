import path from "node:path";

export const E2E_PORT = 3100;
/**
 * Relative SQLite URLs are resolved from the Prisma schema directory and
 * opened read-write. An absolute `file:/...` URL is opened read-only.
 */
export const E2E_DATABASE_URL = "file:./e2e.db";
export const E2E_DATABASE_FILE = path.resolve(process.cwd(), "prisma/e2e.db");
export const E2E_FLAGS = {
  DEALWATCH_E2E: "1",
  DEALWATCH_E2E_CONFIRM: "deterministic-analysis",
} as const;
