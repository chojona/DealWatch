import type { PrismaClient } from "@prisma/client";
import {
  extractCREGraphObservations,
  type GraphExtractionResult,
} from "@/lib/ai/graph/extractCREGraph";
import type { GraphModelExtractor } from "@/lib/ai/graph/extractModel";

/**
 * Graph extraction never changes negotiation ingestion status.
 * Failures are stored on the document graph status and the extraction run.
 */
export async function runDocumentGraphExtraction(input: {
  prisma: PrismaClient;
  documentId: string;
  extractor?: GraphModelExtractor | null;
  extractorVersion?: string;
}): Promise<GraphExtractionResult | null> {
  if (input.extractor === null) return null;
  try {
    return await extractCREGraphObservations({
      prisma: input.prisma,
      documentId: input.documentId,
      extractor: input.extractor,
      extractorVersion: input.extractorVersion,
    });
  } catch (error) {
    console.error("[graph extraction]", error);
    return null;
  }
}
