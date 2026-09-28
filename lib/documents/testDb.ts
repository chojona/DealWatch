import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export async function createTestDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), "dealwatch-doc-"));
  const databaseUrl = `file:${path.join(dir, "test.db")}`;
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    }
  );
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  return {
    prisma,
    dir,
    async cleanup() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function createTestDeal(prisma: PrismaClient) {
  return prisma.deal.create({
    data: {
      name: "200 Clarendon",
      company: "Acme Corp",
      property: "200 Clarendon Street",
      stage: "Negotiation",
      status: "ACTIVE",
    },
  });
}
