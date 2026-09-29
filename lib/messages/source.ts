import type { PrismaClient } from "@prisma/client";
import { getMessageStorage, type MessageStorage } from "./storage";

export async function getOriginalMessageSource(
  db: PrismaClient,
  input: { sourceMessageId: string; expectedWorkspaceId?: string; storage?: MessageStorage }
) {
  const message = await db.sourceMessage.findUnique({
    where: { id: input.sourceMessageId },
    select: { id: true, workspaceId: true, sourceStorageKey: true, originalFilename: true, sourceMimeType: true, sourceSha256: true, deal: { select: { workspaceId: true } } },
  });
  if (!message || message.workspaceId !== message.deal.workspaceId || (input.expectedWorkspaceId && message.workspaceId !== input.expectedWorkspaceId)) return null;
  if (!message.sourceStorageKey) return { ...message, bytes: null };
  const bytes = await (input.storage ?? getMessageStorage()).get(message.sourceStorageKey);
  return { ...message, bytes };
}
