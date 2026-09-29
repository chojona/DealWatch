import { StoragePathError, type DocumentStorage } from "./storage";

export const SOURCE_FILE_STATES = ["AVAILABLE", "MISSING", "UNAVAILABLE"] as const;
export type SourceFileState = (typeof SOURCE_FILE_STATES)[number];

/**
 * A storage key of "pending" is the pre-store placeholder written by ingestion.
 * It is not a path, and it must not be treated as a file that can be opened.
 */
export function isPlaceholderStorageKey(storageKey: string | null | undefined): boolean {
  if (!storageKey) return true;
  return storageKey === "pending" || storageKey.startsWith("pending-") || storageKey.startsWith("pending/");
}

export async function inspectSourceFile(
  storage: DocumentStorage,
  storageKey: string | null | undefined
): Promise<SourceFileState> {
  if (isPlaceholderStorageKey(storageKey)) return "MISSING";
  try {
    return (await storage.exists(storageKey!)) ? "AVAILABLE" : "MISSING";
  } catch (error) {
    if (error instanceof StoragePathError) return "UNAVAILABLE";
    return "UNAVAILABLE";
  }
}
