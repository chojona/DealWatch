import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { extractPdfDocument } from "./extractPdf";
import { hasUsableText, MAX_NEGOTIATION_DOCUMENT_CHARS, toPageMarkedText } from "./pageText";
import { displayFilename, sanitizeFilename, type DocumentStorage } from "./storage";
import { validatePdfUpload } from "./validateUpload";

export class SourceReplacementError extends Error {
  constructor(
    readonly code: "PRODUCTION" | "NOT_FOUND" | "INVALID_PDF" | "SHA_TAKEN" | "EVIDENCE_BOUND",
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "SourceReplacementError";
  }
}

/**
 * Development-only source repair.
 *
 * Same SHA: store the bytes on the existing Document and keep page text,
 * observations, and rounds. This restores a missing file. It does not
 * invent one.
 *
 * Different SHA with negotiation rounds, graph observations, or evidence
 * corrections: refuse. Those records are bound to the extracted page text.
 * A different file has to be uploaded as a new Document through the normal
 * pipeline. The 200 Clarendon LOI is in this state: its page text and
 * graph observations exist, and its storage key is the placeholder "pending".
 *
 * Different SHA with none of those dependents: keep the Document id, replace
 * the hash and storage key, and re-extract pages with the existing extractor.
 */
export async function replaceDevelopmentSourceFile(
  prisma: PrismaClient,
  input: {
    documentId: string;
    bytes: Buffer;
    filename: string;
    mimeType: string;
    storage: DocumentStorage;
  }
) {
  if (process.env.NODE_ENV === "production") {
    throw new SourceReplacementError(
      "PRODUCTION",
      "Source replacement is a development repair. Production uploads go through document ingestion.",
      403
    );
  }

  const upload = validatePdfUpload({
    bytes: input.bytes,
    mimeType: input.mimeType,
  });
  if (!upload.ok) {
    throw new SourceReplacementError("INVALID_PDF", upload.message, upload.httpStatus);
  }

  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    select: {
      id: true,
      dealId: true,
      sha256: true,
      storageKey: true,
      filename: true,
    },
  });
  if (!document) {
    throw new SourceReplacementError("NOT_FOUND", "Document not found", 404);
  }

  const digest = createHash("sha256").update(input.bytes).digest("hex");
  if (digest !== document.sha256) {
    const collision = await prisma.document.findUnique({
      where: { dealId_sha256: { dealId: document.dealId, sha256: digest } },
      select: { id: true },
    });
    if (collision && collision.id !== document.id) {
      throw new SourceReplacementError(
        "SHA_TAKEN",
        "This deal already has a document for that file. Open that document instead of replacing this one.",
        409
      );
    }
    const [rounds, entities, relationships, corrections] = await Promise.all([
      prisma.negotiationRound.count({ where: { documentId: document.id } }),
      prisma.entityObservation.count({ where: { documentId: document.id } }),
      prisma.relationshipObservation.count({ where: { documentId: document.id } }),
      prisma.evidenceCorrection.count({ where: { documentId: document.id } }),
    ]);
    if (rounds + entities + relationships + corrections > 0) {
      throw new SourceReplacementError(
        "EVIDENCE_BOUND",
        "This document already has extracted page text bound to observations or negotiation records. A different PDF cannot replace it in place. Upload the file as a new document.",
        409
      );
    }
    return reextractInPlace(prisma, document, input, digest);
  }

  const stored = await input.storage.put({
    documentId: document.id,
    filename: document.filename,
    bytes: input.bytes,
  });
  return prisma.document.update({
    where: { id: document.id },
    data: { storageKey: stored.storageKey },
    select: { id: true, sha256: true, storageKey: true, ingestionStatus: true },
  });
}

async function reextractInPlace(
  prisma: PrismaClient,
  document: { id: string; filename: string },
  input: {
    bytes: Buffer;
    filename: string;
    storage: DocumentStorage;
  },
  digest: string
) {
  const stored = await input.storage.put({
    documentId: document.id,
    filename: sanitizeFilename(input.filename),
    bytes: input.bytes,
  });
  let extracted;
  try {
    extracted = await extractPdfDocument(input.bytes);
  } catch {
    await prisma.document.update({
      where: { id: document.id },
      data: {
        sha256: digest,
        filename: sanitizeFilename(input.filename),
        originalFilename: displayFilename(input.filename),
        sizeBytes: input.bytes.length,
        mimeType: "application/pdf",
        storageKey: stored.storageKey,
        ingestionStatus: "FAILED",
        failureCode: "EXTRACTION_FAILED",
        failureReason: "PDF text extraction failed. The document was kept so ingestion can be retried.",
      },
    });
    throw new SourceReplacementError("INVALID_PDF", "PDF text extraction failed.", 422);
  }

  const usable = hasUsableText(extracted.pages);
  const marked = toPageMarkedText(extracted.pages);
  const tooLarge = marked.length > MAX_NEGOTIATION_DOCUMENT_CHARS;
  await prisma.$transaction(async (tx) => {
    await tx.documentPage.deleteMany({ where: { documentId: document.id } });
    if (extracted.pages.length > 0) {
      await tx.documentPage.createMany({
        data: extracted.pages.map((page) => ({
          documentId: document.id,
          pageNumber: page.pageNumber,
          text: page.text,
        })),
      });
    }
    await tx.document.update({
      where: { id: document.id },
      data: {
        sha256: digest,
        filename: sanitizeFilename(input.filename),
        originalFilename: displayFilename(input.filename),
        sizeBytes: input.bytes.length,
        mimeType: "application/pdf",
        storageKey: stored.storageKey,
        pageCount: extracted.pageCount,
        ingestionStatus: !usable || tooLarge ? "FAILED" : "READY",
        failureCode: !usable ? "SCANNED_OR_EMPTY" : tooLarge ? "TEXT_TOO_LARGE" : null,
        failureReason: !usable
          ? "This PDF has no usable embedded text. Scanned documents are not supported."
          : tooLarge
            ? "The extracted text exceeds the negotiation analysis limit."
            : null,
      },
    });
  });
  return prisma.document.findUniqueOrThrow({
    where: { id: document.id },
    select: { id: true, sha256: true, storageKey: true, ingestionStatus: true },
  });
}
