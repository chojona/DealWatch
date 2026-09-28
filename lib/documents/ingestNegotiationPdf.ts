import { createHash } from "node:crypto";
import type { DocumentType, Prisma, PrismaClient } from "@prisma/client";
import {
  extractTerms as extractNegotiationTerms,
  NegotiationExtractionConfigurationError,
  type ExtractTermsInput,
} from "@/lib/ai/negotiation/extractTerms";
import type { ExtractTermsOutput } from "@/lib/ai/negotiation/schemas";
import { attachEvidenceProvenance } from "@/lib/documents/locateEvidence";
import {
  hasUsableText,
  MAX_NEGOTIATION_DOCUMENT_CHARS,
  toPageMarkedText,
} from "@/lib/documents/pageText";
import { toDocumentDto, type DocumentDto } from "@/lib/documents/dto";
import {
  extractPdfDocument,
  type ExtractedPdf,
} from "@/lib/documents/extractPdf";
import {
  displayFilename,
  sanitizeFilename,
  type DocumentStorage,
} from "@/lib/documents/storage";
import { validatePdfUpload } from "@/lib/documents/validateUpload";
import type { GraphModelExtractor } from "@/lib/ai/graph/extractModel";
import { runDocumentGraphExtraction } from "@/lib/documents/runGraphExtraction";
import { writeNegotiationRound } from "@/lib/negotiation/persistRound";

export type NegotiationTermExtractor = (
  input: ExtractTermsInput
) => Promise<ExtractTermsOutput>;

export class DocumentUploadRejected extends Error {
  constructor(
    readonly code:
      | "DEAL_NOT_FOUND"
      | "EMPTY"
      | "OVERSIZED"
      | "NON_PDF"
      | "INVALID_METADATA",
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
    this.name = "DocumentUploadRejected";
  }
}

export interface IngestResult {
  document: DocumentDto;
  idempotent: boolean;
}

export interface IngestNegotiationPdfInput {
  dealId: string;
  bytes: Buffer;
  filename: string;
  mimeType: string;
  side: "TENANT" | "LANDLORD";
  documentDate: Date;
  documentType: DocumentType;
  storage: DocumentStorage;
  prisma: PrismaClient;
  extractPdf?: (bytes: Buffer) => Promise<ExtractedPdf>;
  extractTerms?: NegotiationTermExtractor;
  /** null skips graph extraction. Omit to use the configured entity model. */
  extractGraph?: GraphModelExtractor | null;
  maxBytes?: number;
  /** extract stops after page text is stored. full also runs negotiation analysis. */
  mode?: "extract" | "full";
}

const documentInclude = {
  pages: { orderBy: { pageNumber: "asc" as const } },
  negotiationRounds: {
    orderBy: { createdAt: "asc" as const },
    include: { _count: { select: { terms: true } } },
  },
} satisfies Prisma.DocumentInclude;

type LoadedDocument = Prisma.DocumentGetPayload<{ include: typeof documentInclude }>;

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

async function loadDocument(
  prisma: PrismaClient,
  id: string
): Promise<LoadedDocument> {
  return prisma.document.findUniqueOrThrow({
    where: { id },
    include: documentInclude,
  });
}

async function markFailed(
  prisma: PrismaClient,
  id: string,
  failureCode: string,
  failureReason: string
): Promise<LoadedDocument> {
  await prisma.document.update({
    where: { id },
    data: {
      ingestionStatus: "FAILED",
      failureCode,
      failureReason,
    },
  });
  return loadDocument(prisma, id);
}

function result(
  document: LoadedDocument,
  idempotent: boolean
): IngestResult {
  return { document: toDocumentDto(document), idempotent };
}

async function ensureStored(
  prisma: PrismaClient,
  document: LoadedDocument,
  bytes: Buffer,
  storage: DocumentStorage
): Promise<LoadedDocument> {
  const storageKey = `${document.id}/${document.filename}`;
  const missing =
    document.storageKey === "pending" ||
    document.storageKey !== storageKey ||
    !(await storage.exists(document.storageKey).catch(() => false));
  if (!missing) return document;

  try {
    const stored = await storage.put({
      documentId: document.id,
      filename: document.filename,
      bytes,
    });
    await prisma.document.update({
      where: { id: document.id },
      data: { storageKey: stored.storageKey, ingestionStatus: "UPLOADED" },
    });
  } catch {
    return markFailed(
      prisma,
      document.id,
      "STORAGE_FAILED",
      "The PDF could not be stored."
    );
  }
  return loadDocument(prisma, document.id);
}

async function extractPages(
  prisma: PrismaClient,
  document: LoadedDocument,
  bytes: Buffer,
  extractPdf: (bytes: Buffer) => Promise<ExtractedPdf>
): Promise<LoadedDocument> {
  await prisma.document.update({
    where: { id: document.id },
    data: {
      ingestionStatus: "EXTRACTING",
      failureCode: null,
      failureReason: null,
    },
  });

  let extracted: ExtractedPdf;
  try {
    extracted = await extractPdf(bytes);
  } catch (error) {
    console.error("[pdf extract]", error);
    return markFailed(
      prisma,
      document.id,
      "EXTRACTION_FAILED",
      "PDF text extraction failed. The document was kept so ingestion can be retried."
    );
  }

  if (!hasUsableText(extracted.pages)) {
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
          ingestionStatus: "FAILED",
          failureCode: "SCANNED_OR_EMPTY",
          failureReason:
            "This PDF has no usable embedded text. Scanned documents are not supported.",
          pageCount: extracted.pageCount,
        },
      });
    });
    return loadDocument(prisma, document.id);
  }

  const marked = toPageMarkedText(extracted.pages);
  await prisma.$transaction(async (tx) => {
    await tx.documentPage.deleteMany({ where: { documentId: document.id } });
    await tx.documentPage.createMany({
      data: extracted.pages.map((page) => ({
        documentId: document.id,
        pageNumber: page.pageNumber,
        text: page.text,
      })),
    });
    await tx.document.update({
      where: { id: document.id },
      data: {
        pageCount: extracted.pageCount,
        ingestionStatus:
          marked.length > MAX_NEGOTIATION_DOCUMENT_CHARS ? "FAILED" : "READY",
        failureCode:
          marked.length > MAX_NEGOTIATION_DOCUMENT_CHARS
            ? "TEXT_TOO_LARGE"
            : null,
        failureReason:
          marked.length > MAX_NEGOTIATION_DOCUMENT_CHARS
            ? "The extracted text exceeds the negotiation analysis limit."
            : null,
      },
    });
  });
  return loadDocument(prisma, document.id);
}

export async function receiveNegotiationPdf(
  input: IngestNegotiationPdfInput
): Promise<IngestResult> {
  const upload = validatePdfUpload({
    bytes: input.bytes,
    mimeType: input.mimeType,
    maxBytes: input.maxBytes,
  });
  if (!upload.ok) {
    throw new DocumentUploadRejected(
      upload.code,
      upload.message,
      upload.httpStatus
    );
  }
  if (!Number.isFinite(input.documentDate.getTime())) {
    throw new DocumentUploadRejected(
      "INVALID_METADATA",
      "Document date must be valid.",
      400
    );
  }

  const deal = await input.prisma.deal.findUnique({
    where: { id: input.dealId },
    select: { id: true },
  });
  if (!deal) {
    throw new DocumentUploadRejected("DEAL_NOT_FOUND", "Deal not found", 404);
  }

  const digest = sha256(input.bytes);
  let document = await input.prisma.document.findUnique({
    where: { dealId_sha256: { dealId: input.dealId, sha256: digest } },
    include: documentInclude,
  });

  if (!document) {
    try {
      document = await input.prisma.document.create({
        data: {
          dealId: input.dealId,
          filename: sanitizeFilename(input.filename),
          originalFilename: displayFilename(input.filename),
          mimeType: "application/pdf",
          sizeBytes: input.bytes.length,
          sha256: digest,
          documentType: input.documentType,
          documentDate: input.documentDate,
          negotiationSide: input.side,
          ingestionStatus: "UPLOADED",
          storageKey: "pending",
        },
        include: documentInclude,
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      document = await input.prisma.document.findUniqueOrThrow({
        where: { dealId_sha256: { dealId: input.dealId, sha256: digest } },
        include: documentInclude,
      });
    }
  }

  if (document.negotiationRounds.length > 0) {
    if (document.ingestionStatus !== "COMPLETE") {
      document = await input.prisma.document.update({
        where: { id: document.id },
        data: { ingestionStatus: "COMPLETE", failureCode: null, failureReason: null },
        include: documentInclude,
      });
    }
    return result(document, true);
  }

  if (
    document.failureCode === "SCANNED_OR_EMPTY" &&
    document.ingestionStatus === "FAILED"
  ) {
    return result(document, true);
  }

  document = await input.prisma.document.update({
    where: { id: document.id },
    data: {
      documentType: input.documentType,
      documentDate: input.documentDate,
      negotiationSide: input.side,
      originalFilename: displayFilename(input.filename),
    },
    include: documentInclude,
  });

  document = await ensureStored(
    input.prisma,
    document,
    input.bytes,
    input.storage
  );
  if (document.failureCode === "STORAGE_FAILED") return result(document, false);

  const needsExtract =
    document.pages.length === 0 ||
    document.failureCode === "EXTRACTION_FAILED" ||
    document.ingestionStatus === "UPLOADED" ||
    document.ingestionStatus === "EXTRACTING";

  if (needsExtract) {
    document = await extractPages(
      input.prisma,
      document,
      input.bytes,
      input.extractPdf ?? extractPdfDocument
    );
  } else if (document.ingestionStatus !== "READY") {
    const marked = toPageMarkedText(document.pages);
    if (marked.length > MAX_NEGOTIATION_DOCUMENT_CHARS) {
      document = await markFailed(
        input.prisma,
        document.id,
        "TEXT_TOO_LARGE",
        "The extracted text exceeds the negotiation analysis limit."
      );
    } else if (hasUsableText(document.pages)) {
      document = await input.prisma.document.update({
        where: { id: document.id },
        data: {
          ingestionStatus: "READY",
          failureCode: null,
          failureReason: null,
        },
        include: documentInclude,
      });
    }
  }

  return result(document, false);
}

export async function analyzeNegotiationDocument(input: {
  documentId: string;
  prisma: PrismaClient;
  extractTerms?: NegotiationTermExtractor;
}): Promise<IngestResult> {
  let document = await loadDocument(input.prisma, input.documentId);
  if (document.negotiationRounds.length > 0) {
    if (document.ingestionStatus !== "COMPLETE") {
      document = await input.prisma.document.update({
        where: { id: document.id },
        data: { ingestionStatus: "COMPLETE", failureCode: null, failureReason: null },
        include: documentInclude,
      });
    }
    return result(document, true);
  }

  if (document.ingestionStatus === "FAILED" && document.failureCode !== "ANALYSIS_FAILED") {
    return result(document, document.failureCode === "SCANNED_OR_EMPTY");
  }

  if (!hasUsableText(document.pages)) {
    document = await markFailed(
      input.prisma,
      document.id,
      "SCANNED_OR_EMPTY",
      "This PDF has no usable embedded text. Scanned documents are not supported."
    );
    return result(document, true);
  }

  const marked = toPageMarkedText(document.pages);
  if (marked.length > MAX_NEGOTIATION_DOCUMENT_CHARS) {
    document = await markFailed(
      input.prisma,
      document.id,
      "TEXT_TOO_LARGE",
      "The extracted text exceeds the negotiation analysis limit."
    );
    return result(document, false);
  }

  if (
    (document.negotiationSide !== "TENANT" &&
      document.negotiationSide !== "LANDLORD") ||
    !document.documentDate
  ) {
    document = await markFailed(
      input.prisma,
      document.id,
      "ANALYSIS_FAILED",
      "Side and document date are required before analysis."
    );
    return result(document, false);
  }

  const side = document.negotiationSide;
  const documentDate = document.documentDate;
  await input.prisma.document.update({
    where: { id: document.id },
    data: {
      ingestionStatus: "ANALYZING",
      failureCode: null,
      failureReason: null,
    },
  });

  const latest = await input.prisma.negotiationRound.findFirst({
    where: { dealId: document.dealId, side },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });
  const extract = input.extractTerms ?? extractNegotiationTerms;

  let extraction: ExtractTermsOutput;
  try {
    extraction = await extract({
      documentText: marked,
      documentName: document.originalFilename,
      documentDate,
      side,
      roundNumber: (latest?.roundNumber ?? 0) + 1,
    });
  } catch (error) {
    console.error("[pdf analyze]", error);
    document = await markFailed(
      input.prisma,
      document.id,
      "ANALYSIS_FAILED",
      "Negotiation analysis failed. The extracted text was kept so analysis can be retried."
    );
    if (error instanceof NegotiationExtractionConfigurationError) throw error;
    return result(document, false);
  }

  const terms = extraction.terms.map((term) =>
    attachEvidenceProvenance(term, document.pages)
  );

  try {
    await input.prisma.$transaction(async (tx) => {
      const current = await tx.document.findUnique({
        where: { id: document.id },
        include: { negotiationRounds: { select: { id: true } } },
      });
      if (current && current.negotiationRounds.length > 0) {
        await tx.document.update({
          where: { id: document.id },
          data: {
            ingestionStatus: "COMPLETE",
            failureCode: null,
            failureReason: null,
          },
        });
        return;
      }
      await writeNegotiationRound(tx, {
        dealId: document.dealId,
        side,
        documentName: document.originalFilename,
        documentText: marked,
        documentDate,
        sourceType: "UPLOADED_PDF",
        documentId: document.id,
        terms,
      });
      await tx.document.update({
        where: { id: document.id },
        data: {
          ingestionStatus: "COMPLETE",
          failureCode: null,
          failureReason: null,
        },
      });
    });
  } catch {
    document = await markFailed(
      input.prisma,
      document.id,
      "ANALYSIS_FAILED",
      "Negotiation analysis could not be saved. Retrying will not duplicate a saved round."
    );
    return result(document, false);
  }

  return result(await loadDocument(input.prisma, document.id), false);
}

export async function ingestNegotiationPdf(
  input: IngestNegotiationPdfInput
): Promise<IngestResult> {
  const received = await receiveNegotiationPdf(input);
  if (input.mode === "extract") return received;

  let negotiationConfigError: unknown = null;
  let analyzed = received;
  if (received.document.ingestionStatus === "READY") {
    try {
      analyzed = await analyzeNegotiationDocument({
        documentId: received.document.id,
        prisma: input.prisma,
        extractTerms: input.extractTerms,
      });
    } catch (error) {
      if (error instanceof NegotiationExtractionConfigurationError) {
        negotiationConfigError = error;
      } else {
        throw error;
      }
    }
  }

  if (input.extractGraph !== null) {
    await runDocumentGraphExtraction({
      prisma: input.prisma,
      documentId: received.document.id,
      extractor: input.extractGraph,
    });
    const document = await loadDocument(input.prisma, received.document.id);
    analyzed = result(document, analyzed.idempotent);
  }

  if (negotiationConfigError) throw negotiationConfigError;
  return analyzed;
}
