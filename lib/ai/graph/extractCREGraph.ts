import type { PrismaClient } from "@prisma/client";
import {
  hasUsableText,
  MAX_NEGOTIATION_DOCUMENT_CHARS,
  toPageMarkedText,
} from "@/lib/documents/pageText";
import {
  extractGraphWithConfiguredModel,
  graphModelIdentity,
  GraphExtractionConfigurationError,
  GraphExtractionError,
  type GraphModelExtractor,
} from "./extractModel";
import { GRAPH_EXTRACTOR, GRAPH_EXTRACTOR_VERSION } from "./prompt";
import {
  persistGraphObservations,
  recordGraphExtractionFailure,
} from "./persistObservations";
import {
  validateGraphObservations,
  type GraphRejection,
} from "./validateObservations";

export interface GraphExtractionResult {
  status: "SUCCEEDED" | "FAILED";
  idempotent: boolean;
  runId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  entityCount: number;
  relationshipCount: number;
  rejections: GraphRejection[];
  model: string | null;
  extractor: string;
  extractorVersion: string;
}

/**
 * Document pages → model extraction → validation → DealWatch provenance → observations.
 * Stops at EntityObservation and RelationshipObservation.
 */
export async function extractCREGraphObservations(input: {
  prisma: PrismaClient;
  documentId: string;
  extractor?: GraphModelExtractor;
  extractorVersion?: string;
}): Promise<GraphExtractionResult> {
  const extractorVersion = input.extractorVersion ?? GRAPH_EXTRACTOR_VERSION;
  const document = await input.prisma.document.findUnique({
    where: { id: input.documentId },
    include: {
      pages: { orderBy: { pageNumber: "asc" } },
      deal: { select: { id: true, workspaceId: true } },
    },
  });
  if (!document) {
    return {
      status: "FAILED",
      idempotent: false,
      runId: null,
      failureCode: "DOCUMENT_NOT_FOUND",
      failureReason: "Document not found",
      entityCount: 0,
      relationshipCount: 0,
      rejections: [],
      model: null,
      extractor: GRAPH_EXTRACTOR,
      extractorVersion,
    };
  }

  const base = {
    extractor: GRAPH_EXTRACTOR,
    extractorVersion,
    workspaceId: document.deal.workspaceId,
    documentId: document.id,
  };

  if (!hasUsableText(document.pages)) {
    await recordGraphExtractionFailure(input.prisma, {
      ...base,
      model: "unconfigured",
      failureCode: "NO_USABLE_TEXT",
      failureReason: "Graph extraction requires extracted document text.",
    });
    return failed(base, "NO_USABLE_TEXT", "Graph extraction requires extracted document text.");
  }

  const markedText = toPageMarkedText(document.pages);
  if (markedText.length > MAX_NEGOTIATION_DOCUMENT_CHARS) {
    await recordGraphExtractionFailure(input.prisma, {
      ...base,
      model: "unconfigured",
      failureCode: "TEXT_TOO_LARGE",
      failureReason: "The extracted text exceeds the graph analysis limit.",
    });
    return failed(
      base,
      "TEXT_TOO_LARGE",
      "The extracted text exceeds the graph analysis limit."
    );
  }

  const extractor = input.extractor ?? extractGraphWithConfiguredModel;
  const model = graphModelIdentity(extractor);
  const existing = await input.prisma.graphExtractionRun.findUnique({
    where: {
      documentId_extractor_extractorVersion_model: {
        documentId: document.id,
        extractor: GRAPH_EXTRACTOR,
        extractorVersion,
        model,
      },
    },
  });
  if (existing?.status === "SUCCEEDED") {
    return {
      status: "SUCCEEDED",
      idempotent: true,
      runId: existing.id,
      failureCode: null,
      failureReason: null,
      entityCount: existing.entityCount,
      relationshipCount: existing.relationshipCount,
      rejections: [],
      model,
      extractor: GRAPH_EXTRACTOR,
      extractorVersion,
    };
  }

  let extraction: unknown;
  try {
    const response = await extractor({
      documentText: markedText,
      documentName: document.originalFilename,
    });
    extraction = response.extraction;
  } catch (error) {
    const code =
      error instanceof GraphExtractionConfigurationError
        ? "NOT_CONFIGURED"
        : error instanceof GraphExtractionError
          ? "MODEL_FAILED"
          : "MODEL_FAILED";
    const reason =
      error instanceof Error ? error.message : "Graph extraction failed";
    await recordGraphExtractionFailure(input.prisma, {
      ...base,
      model,
      failureCode: code,
      failureReason: reason,
    });
    return failed(base, code, reason);
  }

  const validated = validateGraphObservations({
    modelOutput: extraction,
    pages: document.pages,
  });
  if (validated.responseError) {
    await recordGraphExtractionFailure(input.prisma, {
      ...base,
      model,
      failureCode: "MALFORMED_RESPONSE",
      failureReason: validated.responseError,
      rejections: validated.rejections,
    });
    return {
      ...failed(base, "MALFORMED_RESPONSE", validated.responseError),
      model,
      rejections: validated.rejections,
    };
  }

  try {
    const persisted = await persistGraphObservations(input.prisma, {
      workspaceId: document.deal.workspaceId,
      dealId: document.deal.id,
      documentId: document.id,
      extractorVersion,
      model,
      entities: validated.entities,
      relationships: validated.relationships,
      rejections: validated.rejections,
    });
    return {
      status: "SUCCEEDED",
      idempotent: persisted.idempotent,
      runId: persisted.runId,
      failureCode: null,
      failureReason: null,
      entityCount: persisted.entityCount,
      relationshipCount: persisted.relationshipCount,
      rejections: validated.rejections,
      model,
      extractor: GRAPH_EXTRACTOR,
      extractorVersion,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "Graph observations could not be saved";
    await recordGraphExtractionFailure(input.prisma, {
      ...base,
      model,
      failureCode: "PERSISTENCE_FAILED",
      failureReason: reason,
      rejections: validated.rejections,
    });
    return {
      ...failed(base, "PERSISTENCE_FAILED", reason),
      model,
      rejections: validated.rejections,
    };
  }
}

function failed(
  base: { extractor: string; extractorVersion: string },
  failureCode: string,
  failureReason: string
): GraphExtractionResult {
  return {
    status: "FAILED",
    idempotent: false,
    runId: null,
    failureCode,
    failureReason,
    entityCount: 0,
    relationshipCount: 0,
    rejections: [],
    model: null,
    extractor: base.extractor,
    extractorVersion: base.extractorVersion,
  };
}
