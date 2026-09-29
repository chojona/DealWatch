import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { clearE2EFailOnceState } from "./failOnce";
import { isE2ETestMode } from "./mode";

type Deletable = { deleteMany: () => Promise<unknown> };

function delegates(): Deletable[] {
  return Object.values(Prisma.ModelName).flatMap((model) => {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    const delegate = (prisma as unknown as Record<string, Deletable | undefined>)[key];
    return delegate?.deleteMany ? [delegate] : [];
  });
}

export async function resetE2EDatabase(): Promise<void> {
  if (!isE2ETestMode()) {
    throw new Error("E2E reset is unavailable");
  }
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("e2e")) {
    throw new Error("E2E reset refused because DATABASE_URL is not an e2e database");
  }
  const models = delegates();
  for (let pass = 0; pass < models.length; pass += 1) {
    let blocked = false;
    for (const delegate of models) {
      try {
        await delegate.deleteMany();
      } catch {
        blocked = true;
      }
    }
    if (!blocked) break;
  }
  const remaining = await prisma.deal.count();
  if (remaining !== 0) {
    throw new Error(`E2E reset left ${remaining} deals`);
  }
  clearE2EFailOnceState();
  await ensureDefaultWorkspace(prisma);
}
