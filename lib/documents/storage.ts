import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";

export interface StoredDocument {
  storageKey: string;
}

export interface DocumentStorage {
  put(input: {
    documentId: string;
    filename: string;
    bytes: Buffer;
  }): Promise<StoredDocument>;
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
}

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class StoragePathError extends Error {
  constructor(message = "Invalid document storage path") {
    super(message);
    this.name = "StoragePathError";
  }
}

/**
 * Display name only. Path separators and control characters are removed.
 * This value is never used as a filesystem path.
 */
export function displayFilename(original: string): string {
  const base = original.split(/[/\\]/).pop() ?? "document.pdf";
  const cleaned = base.replace(/[\u0000-\u001f]/g, "").trim();
  return (cleaned || "document.pdf").slice(0, 240);
}

/**
 * Storage filename. Uploaded names are never trusted as paths.
 */
export function sanitizeFilename(original: string): string {
  const base = displayFilename(original).split(/[/\\]/).pop() ?? "document.pdf";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
  if (!cleaned || cleaned === "." || cleaned === "..") return "document.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

export function assertDocumentId(documentId: string): void {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    throw new StoragePathError("Invalid document id");
  }
}

export function resolveStoragePath(rootDir: string, storageKey: string): string {
  if (!storageKey || storageKey.includes("\0")) {
    throw new StoragePathError();
  }
  if (path.isAbsolute(storageKey)) throw new StoragePathError();
  const segments = storageKey.split(/[/\\]/).filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new StoragePathError();
  }
  const root = path.resolve(rootDir);
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new StoragePathError();
  }
  return full;
}

export class LocalDocumentStorage implements DocumentStorage {
  constructor(private readonly rootDir: string) {}

  async put(input: {
    documentId: string;
    filename: string;
    bytes: Buffer;
  }): Promise<StoredDocument> {
    assertDocumentId(input.documentId);
    const filename = sanitizeFilename(input.filename);
    const storageKey = `${input.documentId}/${filename}`;
    const full = resolveStoragePath(this.rootDir, storageKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.bytes);
    return { storageKey };
  }

  async get(storageKey: string): Promise<Buffer> {
    return readFile(resolveStoragePath(this.rootDir, storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(resolveStoragePath(this.rootDir, storageKey), { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      const info = await stat(resolveStoragePath(this.rootDir, storageKey));
      return info.isFile();
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return false;
      }
      if (error instanceof StoragePathError) throw error;
      return false;
    }
  }
}

export function defaultDocumentStorageRoot(): string {
  return (
    process.env.DOCUMENT_STORAGE_DIR?.trim() ||
    path.join(process.cwd(), "data", "documents")
  );
}

let defaultStorage: LocalDocumentStorage | undefined;

export function getDocumentStorage(): DocumentStorage {
  defaultStorage ??= new LocalDocumentStorage(defaultDocumentStorageRoot());
  return defaultStorage;
}
