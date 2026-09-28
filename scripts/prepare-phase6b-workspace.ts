import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Adds Deal.workspaceId and a Default workspace before `prisma db push`
 * so the required column can be backfilled without resetting dev.db.
 * No-op when the database or the Deal table does not exist yet.
 */

function databaseFile(): string | null {
  const envPath = path.resolve(".env");
  if (!existsSync(envPath)) return null;
  const match = readFileSync(envPath, "utf8").match(
    /^DATABASE_URL\s*=\s*"?file:([^"\n]+)"?/m
  );
  if (!match?.[1]) return null;
  const specified = match[1];
  const candidates = [
    path.resolve("prisma", specified.replace(/^\.\//, "")),
    path.resolve(specified.replace(/^file:/, "")),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function query(dbPath: string, sql: string): string {
  return execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim();
}

function main() {
  const dbPath = databaseFile();
  if (!dbPath) {
    console.log("phase6b prepare: no database file, skipping");
    return;
  }
  const dealTable = query(
    dbPath,
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'Deal';"
  );
  if (dealTable !== "1") {
    console.log("phase6b prepare: Deal table missing, skipping");
    return;
  }
  const column = query(
    dbPath,
    "SELECT COUNT(*) FROM pragma_table_info('Deal') WHERE name = 'workspaceId';"
  );
  if (column === "1") {
    console.log("phase6b prepare: Deal.workspaceId already present");
    return;
  }

  const workspaceId = `ws_${randomBytes(12).toString("hex")}`;
  const createdAt = Date.now();
  query(
    dbPath,
    `CREATE TABLE IF NOT EXISTS "Workspace" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "firmCompanyId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`
  );
  query(
    dbPath,
    `INSERT INTO "Workspace" ("id", "name", "firmCompanyId", "createdAt")
     VALUES ('${workspaceId}', 'Default', NULL, ${createdAt});`
  );
  query(dbPath, `ALTER TABLE "Deal" ADD COLUMN "workspaceId" TEXT;`);
  query(
    dbPath,
    `UPDATE "Deal" SET "workspaceId" = '${workspaceId}' WHERE "workspaceId" IS NULL;`
  );
  const missing = query(
    dbPath,
    `SELECT COUNT(*) FROM "Deal" WHERE "workspaceId" IS NULL;`
  );
  if (missing !== "0") {
    throw new Error("phase6b prepare: failed to backfill Deal.workspaceId");
  }
  console.log(`phase6b prepare: backfilled deals onto workspace ${workspaceId}`);
}

main();
