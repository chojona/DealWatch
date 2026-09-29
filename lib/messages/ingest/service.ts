import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { displayFilename } from "@/lib/documents/storage";
import { getMessageStorage, type MessageStorage } from "@/lib/messages/storage";
import { normalizeRfcMessageId, parseEml, type ParsedAttachment } from "./eml";

export interface NormalizedParticipantInput {
  role: "FROM" | "TO" | "CC" | "BCC";
  displayName?: string | null;
  address: string;
}

export interface NormalizedSourceMessageInput {
  dealId: string;
  sourceType: "MANUAL" | "FIXTURE" | "IMPORTED";
  sourceProvider?: string | null;
  externalMessageId?: string | null;
  rfcMessageId?: string | null;
  threadExternalId?: string | null;
  subject?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  sentAt?: Date | null;
  receivedAt?: Date | null;
  bodyText: string;
  legacyDealEventId?: string | null;
  participants?: NormalizedParticipantInput[];
  originalSource?: { bytes: Buffer; filename: string; mimeType: string } | null;
  attachments?: ParsedAttachment[];
}

function uniqueFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function existingIdentity(db: PrismaClient, workspaceId: string, input: NormalizedSourceMessageInput, sha256: string | null) {
  const provider = input.sourceProvider?.trim().toLowerCase() || null;
  const external = input.externalMessageId?.trim() || null;
  if (provider && external) {
    const found = await db.sourceMessage.findFirst({ where: { workspaceId, sourceProvider: provider, externalMessageId: external }, include: { participants: true, attachments: true } });
    if (found) return found;
  }
  const rfcMessageId = normalizeRfcMessageId(input.rfcMessageId ?? null);
  if (rfcMessageId) {
    const found = await db.sourceMessage.findFirst({ where: { workspaceId, rfcMessageId }, include: { participants: true, attachments: true } });
    if (found) return found;
  }
  if (sha256) {
    return db.sourceMessage.findFirst({ where: { workspaceId, sourceSha256: sha256 }, include: { participants: true, attachments: true } });
  }
  return null;
}

/** Provider-neutral ingestion boundary. It stores source evidence only. */
export async function ingestSourceMessage(
  db: PrismaClient,
  input: NormalizedSourceMessageInput,
  options: { storage?: MessageStorage } = {}
) {
  if (input.bodyText.length > 500_000) throw new Error("Message body exceeds the 500000 character limit");
  if ((input.participants?.length ?? 0) > 500) throw new Error("Message has too many participants");
  const deal = await db.deal.findUnique({ where: { id: input.dealId }, select: { id: true, workspaceId: true } });
  if (!deal) throw new Error("Deal not found");
  if (input.legacyDealEventId) {
    const event = await db.dealEvent.findFirst({ where: { id: input.legacyDealEventId, dealId: deal.id }, select: { deal: { select: { workspaceId: true } } } });
    if (!event || event.deal.workspaceId !== deal.workspaceId) throw new Error("Legacy deal event is not on this deal");
  }
  const sourceSha256 = input.originalSource ? createHash("sha256").update(input.originalSource.bytes).digest("hex") : null;
  const duplicate = await existingIdentity(db, deal.workspaceId, input, sourceSha256);
  if (duplicate) return duplicate;

  const participants = [...(input.participants ?? [])].filter((item) => item.address.trim());
  const sender = input.senderAddress?.trim() || null;
  if (sender && !participants.some((item) => item.role === "FROM" && item.address.trim().toLowerCase() === sender.toLowerCase())) {
    participants.unshift({ role: "FROM", displayName: input.senderName ?? null, address: sender });
  }
  const provider = input.sourceProvider?.trim().toLowerCase() || null;
  const externalMessageId = input.externalMessageId?.trim() || null;
  const rfcMessageId = normalizeRfcMessageId(input.rfcMessageId ?? null);
  let created;
  try {
    created = await db.sourceMessage.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceType: input.sourceType,
        sourceProvider: provider,
        externalMessageId,
        rfcMessageId,
        sourceSha256,
        originalFilename: input.originalSource ? displayFilename(input.originalSource.filename) : null,
        sourceMimeType: input.originalSource?.mimeType ?? null,
        sourceSize: input.originalSource?.bytes.length ?? null,
        threadExternalId: input.threadExternalId ?? null,
        subject: input.subject ?? null,
        senderName: input.senderName ?? null,
        senderAddress: sender,
        sentAt: input.sentAt ?? null,
        receivedAt: input.receivedAt ?? null,
        bodyText: input.bodyText,
        legacyDealEventId: input.legacyDealEventId ?? null,
        participants: { create: participants.map((item) => ({ role: item.role, displayName: item.displayName ?? null, address: item.address.trim() })) },
      },
      include: { participants: true, attachments: true },
    });
  } catch (error) {
    if (!uniqueFailure(error)) throw error;
    const existing = await existingIdentity(db, deal.workspaceId, input, sourceSha256);
    if (existing) return existing;
    throw error;
  }

  if (!input.originalSource) return created;
  const storage = options.storage ?? getMessageStorage();
  try {
    const storedSource = await storage.put({ messageId: created.id, category: "source", filename: input.originalSource.filename, bytes: input.originalSource.bytes });
    const attachmentRows = [];
    for (const attachment of input.attachments ?? []) {
      const row = await db.sourceMessageAttachment.create({
        data: {
          sourceMessageId: created.id,
          filename: displayFilename(attachment.filename),
          contentType: attachment.contentType,
          size: attachment.size,
          contentId: attachment.contentId,
          disposition: attachment.disposition,
          sha256: attachment.sha256,
        },
      });
      const stored = await storage.put({ messageId: created.id, category: "attachment", objectId: row.id, filename: attachment.filename, bytes: attachment.bytes });
      attachmentRows.push(await db.sourceMessageAttachment.update({ where: { id: row.id }, data: { storageKey: stored.storageKey } }));
    }
    return db.sourceMessage.update({
      where: { id: created.id },
      data: { sourceStorageKey: storedSource.storageKey },
      include: { participants: true, attachments: true },
    });
  } catch (error) {
    await db.sourceMessage.delete({ where: { id: created.id } }).catch(() => undefined);
    throw error;
  }
}

export function ingestManualMessage(db: PrismaClient, input: Omit<NormalizedSourceMessageInput, "sourceType" | "originalSource" | "attachments" | "rfcMessageId" | "sourceProvider" | "externalMessageId">) {
  return ingestSourceMessage(db, { ...input, sourceType: "MANUAL" });
}

export async function ingestEmlMessage(
  db: PrismaClient,
  input: { dealId: string; bytes: Buffer; filename: string; mimeType?: string; receivedAt?: Date | null; sourceProvider?: string | null; externalMessageId?: string | null },
  options: { storage?: MessageStorage; maxBytes?: number } = {}
) {
  const parsed = parseEml(input.bytes, { mimeType: input.mimeType, maxBytes: options.maxBytes });
  const participants: NormalizedParticipantInput[] = [
    ...(parsed.from ? [{ role: "FROM" as const, ...parsed.from }] : []),
    ...parsed.to.map((item) => ({ role: "TO" as const, ...item })),
    ...parsed.cc.map((item) => ({ role: "CC" as const, ...item })),
    ...parsed.bcc.map((item) => ({ role: "BCC" as const, ...item })),
  ];
  return ingestSourceMessage(db, {
    dealId: input.dealId,
    sourceType: "IMPORTED",
    sourceProvider: input.sourceProvider,
    externalMessageId: input.externalMessageId,
    rfcMessageId: parsed.rfcMessageId,
    threadExternalId: parsed.threadExternalId,
    subject: parsed.subject,
    senderName: parsed.from?.displayName ?? null,
    senderAddress: parsed.from?.address ?? null,
    sentAt: parsed.sentAt,
    receivedAt: input.receivedAt ?? null,
    bodyText: parsed.bodyText,
    participants,
    originalSource: { bytes: input.bytes, filename: input.filename, mimeType: input.mimeType || "message/rfc822" },
    attachments: parsed.attachments,
  }, options);
}
