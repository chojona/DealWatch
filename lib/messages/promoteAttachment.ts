import { createHash } from "node:crypto";
import { copyFile, link, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { validatePdfUpload } from "@/lib/documents/validateUpload";
import { displayFilename, sanitizeFilename, StoragePathError, type DocumentStorage } from "@/lib/documents/storage";
import type { MessageStorage } from "./storage";

/**
 * Storage behavior:
 * The attachment storage key and SHA stay authoritative. Promotion verifies
 * those bytes, then hard-links that inode into the document storage root at
 * `{documentId}/{filename}`. Document reads keep using document storage.
 * A byte copy happens only when the two roots are on different filesystems
 * and a hard link is impossible. An attachment whose SHA already belongs to
 * a Document on the same deal records the link and stores nothing new.
 * Promotion does not extract text and does not call a model.
 */
export type StorageReuse = "HARDLINK" | "COPY" | "EXISTING_DOCUMENT";

export class AttachmentPromotionError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "MISMATCH"
      | "UNSUPPORTED_TYPE"
      | "SOURCE_MISSING"
      | "SOURCE_INTEGRITY"
      | "UNSAFE_STORAGE"
      | "OVERSIZED",
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "AttachmentPromotionError";
  }
}

export interface PromotionResult {
  documentId: string;
  dealId: string;
  href: string;
  created: boolean;
  storageReuse: StorageReuse;
  sha256: string;
  originalFilename: string;
  ingestionStatus: string;
}

export function rejectPromotionRequest(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  if ("workspaceId" in body) return "workspaceId is server-controlled";
  if ("dealId" in body) return "The document stays on the source message deal.";
  return null;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function errno(error: unknown): string | null {
  if (error instanceof Error && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ?? null;
  }
  return null;
}

export async function promoteAttachmentToDocument(
  db: PrismaClient,
  input: {
    messageId: string;
    attachmentId: string;
    expectedWorkspaceId: string;
    messageStorage: MessageStorage;
    documentStorage: DocumentStorage;
  }
): Promise<PromotionResult> {
  const verified = await verifyAttachment(db, input);
  try {
    const inserted = await insertPromotion(db, verified);
    return finishStorage(db, input.documentStorage, verified, inserted);
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const existing = await db.attachmentDocumentPromotion.findUnique({
      where: { sourceMessageAttachmentId: verified.attachmentId },
      include: { document: { select: { id: true, dealId: true, storageKey: true, ingestionStatus: true, sha256: true, originalFilename: true } } },
    });
    if (!existing) throw error;
    return finishStorage(db, input.documentStorage, verified, {
      created: false,
      promotionId: existing.id,
      documentId: existing.document.id,
      dealId: existing.document.dealId,
      storageKey: existing.document.storageKey,
      storageReuse: existing.storageReuse as StorageReuse,
      ingestionStatus: existing.document.ingestionStatus,
      sha256: existing.document.sha256,
      originalFilename: existing.document.originalFilename,
    });
  }
}

interface VerifiedAttachment {
  attachmentId: string;
  sourceMessageId: string;
  workspaceId: string;
  dealId: string;
  filename: string;
  contentType: string;
  sha256: string;
  sizeBytes: number;
  sourceStorageKey: string;
  sourceAbsolutePath: string;
}

async function verifyAttachment(
  db: PrismaClient,
  input: {
    messageId: string;
    attachmentId: string;
    expectedWorkspaceId: string;
    messageStorage: MessageStorage;
  }
): Promise<VerifiedAttachment> {
  const message = await db.sourceMessage.findFirst({
    where: { id: input.messageId, workspaceId: input.expectedWorkspaceId },
    select: {
      id: true,
      workspaceId: true,
      dealId: true,
      deal: { select: { id: true, workspaceId: true } },
      attachments: { where: { id: input.attachmentId } },
    },
  });
  if (!message || message.deal.id !== message.dealId || message.deal.workspaceId !== message.workspaceId) {
    throw new AttachmentPromotionError("NOT_FOUND", "Attachment not found", 404);
  }
  const attachment = message.attachments[0];
  if (!attachment) {
    const elsewhere = await db.sourceMessageAttachment.findUnique({
      where: { id: input.attachmentId },
      select: { sourceMessage: { select: { workspaceId: true, dealId: true } } },
    });
    if (
      elsewhere &&
      elsewhere.sourceMessage.workspaceId === input.expectedWorkspaceId &&
      elsewhere.sourceMessage.dealId !== message.dealId
    ) {
      throw new AttachmentPromotionError("MISMATCH", "Attachment does not belong to this message.", 409);
    }
    if (elsewhere && elsewhere.sourceMessage.workspaceId === input.expectedWorkspaceId) {
      throw new AttachmentPromotionError("MISMATCH", "Attachment does not belong to this message.", 409);
    }
    throw new AttachmentPromotionError("NOT_FOUND", "Attachment not found", 404);
  }
  if (attachment.sourceMessageId !== message.id) {
    throw new AttachmentPromotionError("MISMATCH", "Attachment does not belong to this message.", 409);
  }
  if (!attachment.storageKey) {
    throw new AttachmentPromotionError("SOURCE_MISSING", "The attachment file is not stored.", 409);
  }

  let sourceAbsolutePath: string;
  try {
    sourceAbsolutePath = input.messageStorage.absolutePath(attachment.storageKey);
  } catch (error) {
    if (error instanceof StoragePathError) {
      throw new AttachmentPromotionError("UNSAFE_STORAGE", "The attachment storage key is not usable.", 409);
    }
    throw error;
  }
  if (!(await input.messageStorage.exists(attachment.storageKey))) {
    throw new AttachmentPromotionError("SOURCE_MISSING", "The attachment file is not stored.", 409);
  }

  const bytes = await input.messageStorage.get(attachment.storageKey);
  if (bytes.length !== attachment.size) {
    throw new AttachmentPromotionError("SOURCE_INTEGRITY", "The stored attachment does not match its recorded size.", 409);
  }
  const digest = sha256(bytes);
  if (attachment.sha256 && attachment.sha256 !== digest) {
    throw new AttachmentPromotionError("SOURCE_INTEGRITY", "The stored attachment does not match its recorded SHA-256.", 409);
  }
  const upload = validatePdfUpload({ bytes, mimeType: attachment.contentType });
  if (!upload.ok) {
    if (upload.code === "NON_PDF") {
      throw new AttachmentPromotionError("UNSUPPORTED_TYPE", "Only PDF attachments can be promoted to documents.", 415);
    }
    if (upload.code === "OVERSIZED") {
      throw new AttachmentPromotionError("OVERSIZED", upload.message, upload.httpStatus);
    }
    throw new AttachmentPromotionError("SOURCE_INTEGRITY", upload.message, 409);
  }

  return {
    attachmentId: attachment.id,
    sourceMessageId: message.id,
    workspaceId: message.workspaceId,
    dealId: message.dealId,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sha256: digest,
    sizeBytes: bytes.length,
    sourceStorageKey: attachment.storageKey,
    sourceAbsolutePath,
  };
}

interface InsertedPromotion {
  created: boolean;
  promotionId: string;
  documentId: string;
  dealId: string;
  storageKey: string;
  storageReuse: StorageReuse | "PENDING";
  ingestionStatus: string;
  sha256: string;
  originalFilename: string;
}

async function insertPromotion(db: PrismaClient, verified: VerifiedAttachment): Promise<InsertedPromotion> {
  return db.$transaction(async (tx) => {
    const existing = await tx.attachmentDocumentPromotion.findUnique({
      where: { sourceMessageAttachmentId: verified.attachmentId },
      include: {
        document: {
          select: {
            id: true,
            dealId: true,
            storageKey: true,
            ingestionStatus: true,
            sha256: true,
            originalFilename: true,
          },
        },
      },
    });
    if (existing) {
      if (existing.dealId !== verified.dealId || existing.document.dealId !== verified.dealId) {
        throw new AttachmentPromotionError("MISMATCH", "Attachment does not belong to this deal.", 409);
      }
      return {
        created: false,
        promotionId: existing.id,
        documentId: existing.document.id,
        dealId: existing.document.dealId,
        storageKey: existing.document.storageKey,
        storageReuse: existing.storageReuse as StorageReuse,
        ingestionStatus: existing.document.ingestionStatus,
        sha256: existing.document.sha256,
        originalFilename: existing.document.originalFilename,
      };
    }

    const sameFile = await tx.document.findUnique({
      where: { dealId_sha256: { dealId: verified.dealId, sha256: verified.sha256 } },
      select: { id: true, dealId: true, storageKey: true, ingestionStatus: true, sha256: true, originalFilename: true },
    });
    const document = sameFile ?? await tx.document.create({
      data: {
        dealId: verified.dealId,
        filename: sanitizeFilename(verified.filename),
        originalFilename: displayFilename(verified.filename),
        mimeType: "application/pdf",
        sizeBytes: verified.sizeBytes,
        sha256: verified.sha256,
        documentType: "OTHER",
        negotiationSide: null,
        documentDate: null,
        ingestionStatus: "UPLOADED",
        storageKey: "pending",
      },
      select: { id: true, dealId: true, storageKey: true, ingestionStatus: true, sha256: true, originalFilename: true },
    });
    const promotion = await tx.attachmentDocumentPromotion.create({
      data: {
        workspaceId: verified.workspaceId,
        dealId: verified.dealId,
        sourceMessageId: verified.sourceMessageId,
        sourceMessageAttachmentId: verified.attachmentId,
        documentId: document.id,
        originalFilename: verified.filename,
        contentType: verified.contentType,
        sha256: verified.sha256,
        sourceStorageKey: verified.sourceStorageKey,
        storageReuse: sameFile ? "EXISTING_DOCUMENT" : "PENDING",
      },
    });
    return {
      created: !sameFile,
      promotionId: promotion.id,
      documentId: document.id,
      dealId: document.dealId,
      storageKey: document.storageKey,
      storageReuse: sameFile ? "EXISTING_DOCUMENT" : "PENDING",
      ingestionStatus: document.ingestionStatus,
      sha256: document.sha256,
      originalFilename: document.originalFilename,
    };
  });
}

async function finishStorage(
  db: PrismaClient,
  documentStorage: DocumentStorage,
  verified: VerifiedAttachment,
  inserted: InsertedPromotion
): Promise<PromotionResult> {
  if (inserted.dealId !== verified.dealId) {
    throw new AttachmentPromotionError("MISMATCH", "Attachment does not belong to this deal.", 409);
  }
  const storageReuse: StorageReuse = inserted.storageReuse === "PENDING" || inserted.storageKey === "pending"
    ? (await linkPromotionBytes(db, documentStorage, verified, inserted)).storageReuse
    : inserted.storageReuse;
  const document = await db.document.findUniqueOrThrow({
    where: { id: inserted.documentId },
    select: { id: true, dealId: true, sha256: true, originalFilename: true, ingestionStatus: true },
  });
  return {
    documentId: document.id,
    dealId: document.dealId,
    href: `/documents/${document.id}/review`,
    created: inserted.created,
    storageReuse,
    sha256: document.sha256,
    originalFilename: document.originalFilename,
    ingestionStatus: document.ingestionStatus,
  };
}

async function linkPromotionBytes(
  db: PrismaClient,
  documentStorage: DocumentStorage,
  verified: VerifiedAttachment,
  inserted: InsertedPromotion
): Promise<{ storageReuse: StorageReuse }> {
  if (inserted.storageReuse === "EXISTING_DOCUMENT") return { storageReuse: "EXISTING_DOCUMENT" };
  const linked = await referenceStoredBytes({
    sourceAbsolutePath: verified.sourceAbsolutePath,
    documentStorage,
    documentId: inserted.documentId,
    filename: verified.filename,
  });
  await db.document.update({
    where: { id: inserted.documentId },
    data: { storageKey: linked.storageKey, filename: sanitizeFilename(verified.filename) },
  });
  await db.attachmentDocumentPromotion.update({
    where: { id: inserted.promotionId },
    data: { storageReuse: linked.storageReuse },
  });
  return { storageReuse: linked.storageReuse };
}

async function referenceStoredBytes(input: {
  sourceAbsolutePath: string;
  documentStorage: DocumentStorage;
  documentId: string;
  filename: string;
}): Promise<{ storageKey: string; storageReuse: "HARDLINK" | "COPY" }> {
  const storageKey = `${input.documentId}/${sanitizeFilename(input.filename)}`;
  let destination: string;
  try {
    destination = input.documentStorage.absolutePath(storageKey);
  } catch (error) {
    if (error instanceof StoragePathError) {
      throw new AttachmentPromotionError("UNSAFE_STORAGE", "The document storage path is not usable.", 409);
    }
    throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const [sourceInfo, destinationInfo] = await Promise.all([
      stat(input.sourceAbsolutePath),
      stat(destination),
    ]);
    if (destinationInfo.isFile() && sourceInfo.ino === destinationInfo.ino && sourceInfo.dev === destinationInfo.dev) {
      return { storageKey, storageReuse: "HARDLINK" };
    }
    if (destinationInfo.isFile() && sourceInfo.size === destinationInfo.size) {
      return { storageKey, storageReuse: "COPY" };
    }
  } catch (error) {
    if (errno(error) !== "ENOENT") {
      throw new AttachmentPromotionError("UNSAFE_STORAGE", "The attachment could not be referenced as a document.", 409);
    }
  }

  try {
    await link(input.sourceAbsolutePath, destination);
    return { storageKey, storageReuse: "HARDLINK" };
  } catch (error) {
    const code = errno(error);
    if (code === "EEXIST") return { storageKey, storageReuse: "HARDLINK" };
    if (code === "EXDEV") {
      await copyFile(input.sourceAbsolutePath, destination);
      return { storageKey, storageReuse: "COPY" };
    }
    throw new AttachmentPromotionError("UNSAFE_STORAGE", "The attachment could not be referenced as a document.", 409);
  }
}
