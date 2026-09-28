import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export function phase6bSqlPath(): string {
  return path.join(repoRoot, "prisma/sql/phase6b.sql");
}

function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.replace(/--[^\n]*/g, "").trim().length > 0);
}

/** Reapplies the graph_edge view and partial unique indexes after db push. */
export async function applyPhase6bSql(db: PrismaClient): Promise<void> {
  const sql = readFileSync(phase6bSqlPath(), "utf8");
  for (const statement of statements(sql)) {
    await db.$executeRawUnsafe(statement);
  }
}
