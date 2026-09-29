import type { PrismaClient } from "@prisma/client";

/** Read-only request scope until authenticated workspace membership exists. */
export async function messageRequestWorkspaceId(db: PrismaClient): Promise<string | null> {
  return (await db.workspace.findFirst({ where: { name: "Default" }, orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ?? null;
}
