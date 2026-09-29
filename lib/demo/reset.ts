import { unlink } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import type { DocumentStorage } from "@/lib/documents/storage";
import type { MessageStorage } from "@/lib/messages/storage";
import { buildCanonicalDemo, type CanonicalDemoBuildInput } from "./build";
import { CANONICAL_DEMO_DEAL_ID, CANONICAL_DEMO_DEAL_NAME } from "./identity";
import {
  assertCanonicalDemoResetAllowed,
  demoResetEnvironmentFromProcess,
  type DemoResetEnvironment,
} from "./safety";

export interface CanonicalDemoResetInput extends CanonicalDemoBuildInput {
  environment?: DemoResetEnvironment;
}

async function removeStored(storageKey: string | null, remove: (key: string) => Promise<void>) {
  if (!storageKey) return;
  try {
    await remove(storageKey);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : null;
    if (code === "ENOENT") return;
    throw error;
  }
}

/**
 * Deletes only the canonical demo deal, then rebuilds it.
 * Other deals, including 200 Clarendon, are not queried for deletion.
 */
export async function resetCanonicalDemo(db: PrismaClient, input: CanonicalDemoResetInput) {
  const environment = input.environment ?? demoResetEnvironmentFromProcess();
  const databaseFile = await assertCanonicalDemoResetAllowed(db, environment);

  const named = await db.deal.findFirst({
    where: { name: CANONICAL_DEMO_DEAL_NAME, NOT: { id: CANONICAL_DEMO_DEAL_ID } },
    select: { id: true },
  });
  if (named) {
    throw new Error(
      `Refused: ${CANONICAL_DEMO_DEAL_NAME} already exists as ${named.id}. Reset deletes only ${CANONICAL_DEMO_DEAL_ID}.`
    );
  }

  const existing = await db.deal.findUnique({
    where: { id: CANONICAL_DEMO_DEAL_ID },
    select: { id: true, name: true },
  });
  if (existing && existing.name !== CANONICAL_DEMO_DEAL_NAME) {
    throw new Error(
      `Refused: ${CANONICAL_DEMO_DEAL_ID} is named ${existing.name}. Reset will not delete a deal that is not the canonical demo.`
    );
  }

  if (existing) {
    const documents = await db.document.findMany({
      where: { dealId: CANONICAL_DEMO_DEAL_ID },
      select: { storageKey: true },
    });
    const messages = await db.sourceMessage.findMany({
      where: { dealId: CANONICAL_DEMO_DEAL_ID },
      select: {
        sourceStorageKey: true,
        attachments: { select: { storageKey: true } },
      },
    });
    for (const document of documents) {
      await removeStored(document.storageKey, (key) => input.documentStorage.delete(key));
    }
    for (const message of messages) {
      await removeStored(message.sourceStorageKey, async (key) => {
        await unlink(input.messageStorage.absolutePath(key));
      });
      for (const attachment of message.attachments) {
        await removeStored(attachment.storageKey, async (key) => {
          await unlink(input.messageStorage.absolutePath(key));
        });
      }
    }
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("PRAGMA defer_foreign_keys = ON");
      await tx.attachmentDocumentPromotion.deleteMany({ where: { dealId: CANONICAL_DEMO_DEAL_ID } });
      await tx.deal.delete({ where: { id: CANONICAL_DEMO_DEAL_ID } });
    });
  }

  const built = await buildCanonicalDemo(db, input);
  return { databaseFile, ...built };
}

export type { DocumentStorage, MessageStorage };
