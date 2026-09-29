import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_FILE, E2E_DATABASE_URL } from "./env";

export default async function globalSetup() {
  const databaseFile = E2E_DATABASE_FILE;
  rmSync(`${databaseFile}-journal`, { force: true });
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--accept-data-loss"],
    {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    }
  );
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } });
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Workspace'"
    );
    if (rows[0]?.name !== "Workspace") {
      throw new Error(`E2E database was not created at ${databaseFile}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
