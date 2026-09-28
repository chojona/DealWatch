import type { Prisma, PrismaClient, Workspace } from "@prisma/client";

export type GraphDb = PrismaClient | Prisma.TransactionClient;

const DEFAULT_WORKSPACE_NAME = "Default";

export async function createWorkspace(
  db: GraphDb,
  input: { name: string }
): Promise<Workspace> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Workspace name is required");
  }
  return db.workspace.create({ data: { name } });
}

export async function ensureDefaultWorkspace(db: GraphDb): Promise<Workspace> {
  const existing = await db.workspace.findFirst({
    where: { name: DEFAULT_WORKSPACE_NAME },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;
  return db.workspace.create({ data: { name: DEFAULT_WORKSPACE_NAME } });
}
