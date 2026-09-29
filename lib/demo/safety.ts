import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { DEMO_RESET_CONFIRMATION } from "./identity";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export class DemoSafetyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DemoSafetyError";
  }
}

export interface DemoResetEnvironment {
  nodeEnv: string | undefined;
  confirmation: string | undefined;
  databaseUrl: string;
}

export function demoResetEnvironmentFromProcess(): DemoResetEnvironment {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  return {
    nodeEnv: process.env.NODE_ENV,
    confirmation: process.env.DEALWATCH_DEMO_RESET,
    databaseUrl,
  };
}

export function sqlitePathFromDatabaseUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new DemoSafetyError(
      `Refused: DATABASE_URL must be a local SQLite file URL. Received ${databaseUrl || "(empty)"}.`
    );
  }
  let rest = databaseUrl.slice("file:".length);
  if (rest.startsWith("//")) {
    const slash = rest.indexOf("/", 2);
    rest = slash >= 0 ? rest.slice(slash) : rest;
  }
  if (!rest || rest === ":memory:" || rest.includes("mode=memory")) {
    throw new DemoSafetyError("Refused: in-memory databases are not a canonical demo target.");
  }
  if (path.isAbsolute(rest)) return path.resolve(rest);
  const relative = rest.replace(/^\.\//, "");
  const inPrisma = path.resolve(repoRoot, "prisma", relative);
  const inCwd = path.resolve(process.cwd(), relative);
  if (existsSync(inPrisma)) return inPrisma;
  if (existsSync(inCwd)) return inCwd;
  return inPrisma;
}

function canonicalPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function assertDatabasePathAllowed(filePath: string): void {
  const resolved = canonicalPath(filePath);
  const devDb = canonicalPath(path.join(repoRoot, "prisma", "dev.db"));
  const tempRoot = canonicalPath(tmpdir());
  const inTemp = resolved === tempRoot || resolved.startsWith(tempRoot + path.sep);
  if (resolved === devDb || inTemp) return;
  throw new DemoSafetyError(
    `Refused: database file ${resolved} is not prisma/dev.db and is not under the temporary directory. The demo reset will not open it.`
  );
}

export async function assertCanonicalDemoResetAllowed(
  db: PrismaClient,
  environment: DemoResetEnvironment
): Promise<string> {
  if (environment.nodeEnv === "production") {
    throw new DemoSafetyError("Refused: NODE_ENV is production. Canonical demo reset does not run in production.");
  }
  if (environment.confirmation !== DEMO_RESET_CONFIRMATION) {
    throw new DemoSafetyError(
      `Refused: DEALWATCH_DEMO_RESET must be ${DEMO_RESET_CONFIRMATION}. The npm script sets this. A bare invocation does not.`
    );
  }
  const expected = sqlitePathFromDatabaseUrl(environment.databaseUrl);
  assertDatabasePathAllowed(expected);
  const rows = await db.$queryRawUnsafe<Array<{ file: string | null }>>("PRAGMA database_list");
  const opened = rows.find((row) => row.file)?.file;
  if (!opened) {
    throw new DemoSafetyError("Refused: the connected database has no file path.");
  }
  const openedPath = canonicalPath(opened);
  if (openedPath !== canonicalPath(expected)) {
    throw new DemoSafetyError(
      `Refused: the connected database is ${openedPath}, which does not match DATABASE_URL (${canonicalPath(expected)}).`
    );
  }
  assertDatabasePathAllowed(openedPath);
  return openedPath;
}
