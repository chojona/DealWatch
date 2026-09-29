import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { displayFilename, resolveStoragePath, StoragePathError } from "@/lib/documents/storage";

export interface MessageStorage {
  put(input: { messageId: string; category: "source" | "attachment"; objectId?: string; filename: string; bytes: Buffer }): Promise<{ storageKey: string }>;
  get(storageKey: string): Promise<Buffer>;
  exists(storageKey: string): Promise<boolean>;
  absolutePath(storageKey: string): string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function sanitizeMessageFilename(filename: string, fallback = "message.eml"): string {
  const shown = displayFilename(filename || fallback);
  const safe = shown.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 180);
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

export class LocalMessageStorage implements MessageStorage {
  constructor(private readonly rootDir: string) {}

  async put(input: { messageId: string; category: "source" | "attachment"; objectId?: string; filename: string; bytes: Buffer }) {
    if (!SAFE_ID.test(input.messageId) || (input.objectId && !SAFE_ID.test(input.objectId))) {
      throw new StoragePathError("Invalid message storage id");
    }
    const name = sanitizeMessageFilename(input.filename, input.category === "source" ? "message.eml" : "attachment.bin");
    const storageKey = input.category === "source"
      ? `${input.messageId}/source/${name}`
      : `${input.messageId}/attachments/${input.objectId ?? "unknown"}/${name}`;
    const full = resolveStoragePath(this.rootDir, storageKey);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.bytes);
    return { storageKey };
  }

  get(storageKey: string) {
    return readFile(resolveStoragePath(this.rootDir, storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      return (await stat(resolveStoragePath(this.rootDir, storageKey))).isFile();
    } catch (error) {
      if (error instanceof StoragePathError) throw error;
      return false;
    }
  }

  absolutePath(storageKey: string): string {
    return resolveStoragePath(this.rootDir, storageKey);
  }
}

export function defaultMessageStorageRoot(): string {
  return process.env.MESSAGE_STORAGE_DIR?.trim() || path.join(process.cwd(), "data", "messages");
}

let defaultStorage: MessageStorage | undefined;
export function getMessageStorage(): MessageStorage {
  defaultStorage ??= new LocalMessageStorage(defaultMessageStorageRoot());
  return defaultStorage;
}
