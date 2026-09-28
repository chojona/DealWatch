import { extractText, getDocumentProxy } from "unpdf";
import { normalizePageText } from "./pageText";

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedPdf {
  pageCount: number;
  pages: ExtractedPdfPage[];
  fullText: string;
}

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

/**
 * Extracts embedded PDF text and keeps page boundaries.
 * Image-only pages come back empty. This function does not perform OCR.
 */
export async function extractPdfDocument(bytes: Buffer): Promise<ExtractedPdf> {
  try {
    const document = await getDocumentProxy(new Uint8Array(bytes));
    try {
      const result = await extractText(document, { mergePages: false });
      const texts = Array.isArray(result.text) ? result.text : [result.text];
      const pageCount = Math.max(result.totalPages, texts.length);
      const pages: ExtractedPdfPage[] = [];
      for (let index = 0; index < pageCount; index += 1) {
        pages.push({
          pageNumber: index + 1,
          text: normalizePageText(texts[index] ?? ""),
        });
      }
      return {
        pageCount,
        pages,
        fullText: pages.map((page) => page.text).filter(Boolean).join("\n\n"),
      };
    } finally {
      const destroy = (document as { destroy?: () => Promise<void> | void }).destroy;
      if (typeof destroy === "function") {
        await destroy.call(document);
      }
    }
  } catch (error) {
    if (error instanceof PdfExtractionError) throw error;
    throw new PdfExtractionError(
      error instanceof Error ? error.message : "PDF text extraction failed"
    );
  }
}
