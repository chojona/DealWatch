const BLOCKED_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const BLOCKED_EXTENSION = /\.(docx?|xlsx?|pptx?|png|jpe?g|gif|tiff?|webp|bmp)$/i;

/**
 * Whether the message UI may offer Promote to document.
 * PDF is the only attachment the document pipeline can analyze.
 * Generic MIME plus a .pdf name is allowed because mail clients often
 * label PDFs as application/octet-stream. Bytes are still checked at promotion.
 */
export function isPromotablePdfAttachment(input: {
  filename: string;
  contentType: string | null | undefined;
}): boolean {
  const type = (input.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const name = input.filename.trim();
  if (type.startsWith("image/")) return false;
  if (BLOCKED_TYPES.has(type)) return false;
  if (BLOCKED_EXTENSION.test(name)) return false;
  if (type === "application/pdf") return true;
  if (type === "application/octet-stream" || type === "") return name.toLowerCase().endsWith(".pdf");
  return false;
}
