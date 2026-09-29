import { createHash } from "node:crypto";

export const DEFAULT_MAX_EML_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_BODY_CHARS = 500_000;

export interface ParsedAddress { displayName: string | null; address: string }
export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  disposition: string | null;
  sha256: string;
  bytes: Buffer;
}
export interface ParsedEml {
  rfcMessageId: string | null;
  threadExternalId: string | null;
  subject: string | null;
  from: ParsedAddress | null;
  to: ParsedAddress[];
  cc: ParsedAddress[];
  bcc: ParsedAddress[];
  sentAt: Date | null;
  bodyText: string;
  bodySource: "PLAIN" | "HTML" | "EMPTY";
  attachments: ParsedAttachment[];
}

export class EmlValidationError extends Error {
  constructor(public readonly code: "EMPTY" | "OVERSIZED" | "INVALID_EML", message: string) {
    super(message);
    this.name = "EmlValidationError";
  }
}

function decodeQuotedPrintable(value: string): Buffer {
  const joined = value.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let index = 0; index < joined.length; index += 1) {
    if (joined[index] === "=" && /^[0-9a-f]{2}$/i.test(joined.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(joined.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(joined.charCodeAt(index) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_all, charset: string, encoding: string, data: string) => {
    try {
      const bytes = encoding.toLowerCase() === "b"
        ? Buffer.from(data, "base64")
        : decodeQuotedPrintable(data.replaceAll("_", " "));
      return bytes.toString(charset.toLowerCase().includes("ascii") ? "ascii" : "utf8");
    } catch {
      return data;
    }
  });
}

function headerBlock(raw: string): { headers: Map<string, string[]>; body: string } {
  const boundary = raw.search(/\r?\n\r?\n/);
  if (boundary < 0) throw new EmlValidationError("INVALID_EML", "Email headers are malformed.");
  const separator = raw.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
  const lines = raw.slice(0, boundary).replace(/\r\n/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    else unfolded.push(line);
  }
  const headers = new Map<string, string[]>();
  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const values = headers.get(name) ?? [];
    values.push(line.slice(colon + 1).trim());
    headers.set(name, values);
  }
  if (headers.size === 0) throw new EmlValidationError("INVALID_EML", "Email headers are missing.");
  return { headers, body: raw.slice(boundary + separator.length) };
}

function header(headers: Map<string, string[]>, name: string): string | null {
  const values = headers.get(name.toLowerCase());
  return values?.length ? decodeWords(values.join(", ")) : null;
}

function parameterized(value: string | null, fallback: string) {
  const [kind = fallback, ...parts] = (value ?? fallback).split(";");
  const parameters = new Map<string, string>();
  for (const part of parts) {
    const match = part.match(/^\s*([^=]+)=\s*(?:"([^"]*)"|([^;]*))\s*$/);
    if (match) parameters.set(match[1].trim().toLowerCase(), decodeWords((match[2] ?? match[3] ?? "").trim()));
  }
  return { kind: kind.trim().toLowerCase(), parameters };
}

function decodedBody(body: string, transfer: string | null): Buffer {
  const encoding = transfer?.trim().toLowerCase();
  if (encoding === "base64") return Buffer.from(body.replace(/\s/g, ""), "base64");
  if (encoding === "quoted-printable") return decodeQuotedPrintable(body);
  return Buffer.from(body, "utf8");
}

function splitAddresses(value: string | null): string[] {
  if (!value) return [];
  const result: string[] = [];
  let quoted = false;
  let angle = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"' && value[index - 1] !== "\\") quoted = !quoted;
    if (!quoted && char === "<") angle += 1;
    if (!quoted && char === ">") angle = Math.max(0, angle - 1);
    if (!quoted && angle === 0 && char === ",") {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  result.push(value.slice(start));
  return result;
}

export function parseAddresses(value: string | null): ParsedAddress[] {
  return splitAddresses(value).flatMap((part) => {
    const trimmed = part.trim();
    if (!trimmed) return [];
    const angle = trimmed.match(/^(.*?)<([^<>]+)>$/);
    const address = (angle?.[2] ?? trimmed).trim().replace(/^mailto:/i, "");
    if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address)) return [];
    const display = angle?.[1]?.trim().replace(/^"|"$/g, "") || null;
    return [{ displayName: display ? decodeWords(display) : null, address }];
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function htmlToSafeText(html: string): string {
  const withoutActive = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const withBreaks = withoutActive
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n");
  return withBreaks
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_all, entity: string) => {
      if (entity[0] === "#") {
        const hex = entity[1]?.toLowerCase() === "x";
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[entity.toLowerCase()] ?? " ";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface Leaf { contentType: string; disposition: string | null; filename: string | null; contentId: string | null; bytes: Buffer }
function leaves(raw: string, depth = 0): Leaf[] {
  if (depth > 12) throw new EmlValidationError("INVALID_EML", "Email MIME nesting is too deep.");
  const { headers, body } = headerBlock(raw);
  const contentType = parameterized(header(headers, "content-type"), "text/plain");
  const disposition = parameterized(header(headers, "content-disposition"), "");
  if (contentType.kind.startsWith("multipart/")) {
    const boundary = contentType.parameters.get("boundary");
    if (!boundary) throw new EmlValidationError("INVALID_EML", "Multipart email is missing its boundary.");
    const marker = `--${boundary}`;
    const parts = body.split(marker).slice(1).filter((part) => !part.trimStart().startsWith("--"));
    if (parts.length > 100) throw new EmlValidationError("INVALID_EML", "Email contains too many MIME parts.");
    return parts.flatMap((part) => leaves(part.replace(/^\r?\n/, "").replace(/\r?\n$/, ""), depth + 1));
  }
  const filename = disposition.parameters.get("filename") ?? contentType.parameters.get("name") ?? null;
  return [{
    contentType: contentType.kind,
    disposition: disposition.kind || null,
    filename,
    contentId: header(headers, "content-id")?.replace(/^<|>$/g, "") ?? null,
    bytes: decodedBody(body, header(headers, "content-transfer-encoding")),
  }];
}

export function normalizeRfcMessageId(value: string | null): string | null {
  const normalized = value?.trim().replace(/^<|>$/g, "").trim().toLowerCase() ?? "";
  return normalized || null;
}

export function validateEmlUpload(input: { bytes: Buffer; mimeType?: string; maxBytes?: number }): void {
  const max = input.maxBytes ?? DEFAULT_MAX_EML_BYTES;
  if (input.bytes.length === 0) throw new EmlValidationError("EMPTY", "The uploaded email is empty.");
  if (input.bytes.length > max) throw new EmlValidationError("OVERSIZED", `Email exceeds the ${max} byte limit.`);
  const mime = (input.mimeType ?? "").trim().toLowerCase();
  if (mime && !["message/rfc822", "application/octet-stream", "text/plain"].includes(mime)) {
    throw new EmlValidationError("INVALID_EML", "Only .eml (message/rfc822) files are supported.");
  }
}

export function parseEml(bytes: Buffer, options: { mimeType?: string; maxBytes?: number; maxBodyChars?: number } = {}): ParsedEml {
  validateEmlUpload({ bytes, mimeType: options.mimeType, maxBytes: options.maxBytes });
  const raw = bytes.toString("utf8");
  const root = headerBlock(raw);
  const parts = leaves(raw);
  const attachmentLeaves = parts.filter((part) => part.filename || part.disposition === "attachment");
  const bodyParts = parts.filter((part) => !attachmentLeaves.includes(part));
  const plain = bodyParts.find((part) => part.contentType === "text/plain");
  const html = bodyParts.find((part) => part.contentType === "text/html");
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
  const bodyText = (plain ? plain.bytes.toString("utf8").trim() : html ? htmlToSafeText(html.bytes.toString("utf8")) : "").slice(0, maxBodyChars);
  const references = `${header(root.headers, "in-reply-to") ?? ""} ${header(root.headers, "references") ?? ""}`
    .match(/<[^<>]+>/g)?.map((value) => normalizeRfcMessageId(value)).filter((value): value is string => Boolean(value)) ?? [];
  const dateHeader = header(root.headers, "date");
  const parsedDate = dateHeader ? new Date(dateHeader) : null;
  return {
    rfcMessageId: normalizeRfcMessageId(header(root.headers, "message-id")),
    threadExternalId: references.at(-1) ?? null,
    subject: header(root.headers, "subject"),
    from: parseAddresses(header(root.headers, "from"))[0] ?? null,
    to: parseAddresses(header(root.headers, "to")),
    cc: parseAddresses(header(root.headers, "cc")),
    bcc: parseAddresses(header(root.headers, "bcc")),
    sentAt: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null,
    bodyText,
    bodySource: plain ? "PLAIN" : html ? "HTML" : "EMPTY",
    attachments: attachmentLeaves.map((part, index) => ({
      filename: part.filename || `attachment-${index + 1}`,
      contentType: part.contentType || "application/octet-stream",
      size: part.bytes.length,
      contentId: part.contentId,
      disposition: part.disposition,
      sha256: createHash("sha256").update(part.bytes).digest("hex"),
      bytes: part.bytes,
    })),
  };
}
