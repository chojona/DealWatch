export const DEFAULT_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export type UploadRejectionCode = "EMPTY" | "OVERSIZED" | "NON_PDF";

export interface UploadRejection {
  ok: false;
  code: UploadRejectionCode;
  message: string;
  httpStatus: number;
}

export function maxDocumentBytes(): number {
  const configured = Number(process.env.DOCUMENT_MAX_BYTES);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return DEFAULT_MAX_DOCUMENT_BYTES;
}

export function validatePdfUpload(input: {
  bytes: Buffer;
  mimeType: string;
  maxBytes?: number;
}): { ok: true } | UploadRejection {
  const maxBytes = input.maxBytes ?? maxDocumentBytes();
  if (input.bytes.length === 0) {
    return {
      ok: false,
      code: "EMPTY",
      message: "The uploaded file is empty.",
      httpStatus: 400,
    };
  }
  if (input.bytes.length > maxBytes) {
    return {
      ok: false,
      code: "OVERSIZED",
      message: `PDF exceeds the ${maxBytes} byte limit.`,
      httpStatus: 413,
    };
  }

  const mime = input.mimeType.trim().toLowerCase();
  const mimeAllowed =
    mime === "application/pdf" ||
    mime === "application/octet-stream" ||
    mime === "";
  const header = input.bytes.subarray(0, 5).toString("latin1");
  if (!mimeAllowed || header !== "%PDF-") {
    return {
      ok: false,
      code: "NON_PDF",
      message: "Only text-based PDF negotiation documents are supported.",
      httpStatus: 415,
    };
  }
  return { ok: true };
}
