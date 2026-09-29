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

/**
 * Splits SQL on semicolons that are outside comments and BEGIN/END blocks.
 * Trigger bodies contain semicolons, and those must stay in one statement.
 */
function statements(sql: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    if (sql.startsWith("--", index)) {
      const lineEnd = sql.indexOf("\n", index);
      const comment = lineEnd === -1 ? sql.slice(index) : sql.slice(index, lineEnd + 1);
      current += comment;
      index += comment.length - 1;
      continue;
    }
    const word = /^[A-Za-z]+/.exec(sql.slice(index))?.[0];
    const boundaryBefore = index === 0 || /\s/.test(sql[index - 1] ?? "");
    if (word && boundaryBefore) {
      const boundaryAfter = sql[index + word.length];
      if (boundaryAfter === undefined || /[\s;]/.test(boundaryAfter)) {
        if (/^begin$/i.test(word)) depth += 1;
        if (/^end$/i.test(word)) depth = Math.max(0, depth - 1);
      }
    }
    if (sql[index] === ";" && depth === 0) {
      pushStatement(result, current);
      current = "";
      continue;
    }
    current += sql[index];
  }
  pushStatement(result, current);
  return result;
}

function pushStatement(result: string[], statement: string) {
  const trimmed = statement.trim();
  if (trimmed.replace(/--[^\n]*/g, "").trim().length > 0) result.push(trimmed);
}

/** Reapplies the graph view, partial indexes, and deal-delete trigger after db push. */
export async function applyPhase6bSql(db: PrismaClient): Promise<void> {
  const sql = readFileSync(phase6bSqlPath(), "utf8");
  for (const statement of statements(sql)) {
    await db.$executeRawUnsafe(statement);
  }
}
