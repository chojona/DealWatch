import type { DocumentType, PrismaClient } from "@prisma/client";
import { displayFilename } from "./storage";

export class DocumentMetadataError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "INVALID" | "LOCKED",
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "DocumentMetadataError";
  }
}

export interface DocumentMetadataPatch {
  documentType?: DocumentType;
  negotiationSide?: "TENANT" | "LANDLORD";
  documentDate?: Date;
  originalFilename?: string;
}

const DOCUMENT_TYPES = new Set<DocumentType>([
  "LOI",
  "PROPOSAL",
  "COUNTERPROPOSAL",
  "TERM_SHEET",
  "AMENDMENT",
  "RENEWAL_PROPOSAL",
  "OTHER",
]);

/**
 * Human-controlled document metadata. Storage identity, hashes, page text,
 * and model output are not writable here.
 *
 * Side and date are locked once a negotiation round exists so the stored
 * round keeps the values analysis actually used.
 */
export async function updateDocumentMetadata(
  prisma: PrismaClient,
  documentId: string,
  patch: DocumentMetadataPatch
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      dealId: true,
      negotiationRounds: { select: { id: true }, take: 1 },
    },
  });
  if (!document) {
    throw new DocumentMetadataError("NOT_FOUND", "Document not found", 404);
  }

  const data: {
    documentType?: DocumentType;
    negotiationSide?: "TENANT" | "LANDLORD";
    documentDate?: Date;
    originalFilename?: string;
  } = {};

  if (patch.documentType !== undefined) {
    if (!DOCUMENT_TYPES.has(patch.documentType)) {
      throw new DocumentMetadataError("INVALID", "Document type is not supported.", 400);
    }
    data.documentType = patch.documentType;
  }
  if (patch.originalFilename !== undefined) {
    const filename = displayFilename(patch.originalFilename);
    if (!filename) {
      throw new DocumentMetadataError("INVALID", "Display filename is required.", 400);
    }
    data.originalFilename = filename;
  }
  if (patch.negotiationSide !== undefined || patch.documentDate !== undefined) {
    if (document.negotiationRounds.length > 0) {
      throw new DocumentMetadataError(
        "LOCKED",
        "Authoring side and document date stay with the analyzed round. They cannot be rewritten after analysis.",
        409
      );
    }
    if (patch.negotiationSide !== undefined) {
      if (patch.negotiationSide !== "TENANT" && patch.negotiationSide !== "LANDLORD") {
        throw new DocumentMetadataError("INVALID", "Authoring side must be tenant or landlord.", 400);
      }
      data.negotiationSide = patch.negotiationSide;
    }
    if (patch.documentDate !== undefined) {
      if (!(patch.documentDate instanceof Date) || !Number.isFinite(patch.documentDate.getTime())) {
        throw new DocumentMetadataError("INVALID", "Document date must be valid.", 400);
      }
      data.documentDate = patch.documentDate;
    }
  }

  if (Object.keys(data).length === 0) {
    throw new DocumentMetadataError("INVALID", "No editable metadata was provided.", 400);
  }

  return prisma.document.update({
    where: { id: document.id },
    data,
    select: {
      id: true,
      dealId: true,
      documentType: true,
      negotiationSide: true,
      documentDate: true,
      originalFilename: true,
      sha256: true,
      storageKey: true,
    },
  });
}
