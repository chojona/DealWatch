import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LocalDocumentStorage,
  resolveStoragePath,
  sanitizeFilename,
  StoragePathError,
} from "./storage";

test("malicious filenames cannot escape the storage directory", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "dealwatch-storage-"));
  try {
    const storage = new LocalDocumentStorage(root);
    const stored = await storage.put({
      documentId: "doc_123",
      filename: "../../etc/passwd",
      bytes: Buffer.from("%PDF-1.4\n"),
    });
    assert.equal(stored.storageKey.includes(".."), false);
    assert.equal(sanitizeFilename("../../etc/passwd"), "passwd.pdf");
    const full = resolveStoragePath(root, stored.storageKey);
    assert.equal(full.startsWith(path.resolve(root) + path.sep), true);
    assert.equal(path.basename(path.dirname(full)), "doc_123");

    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const child = path.join(dir, entry);
        if (statSync(child).isDirectory()) walk(child);
        else files.push(child);
      }
    }
    walk(root);
    assert.equal(files.length, 1);
    assert.equal(
      files.every((file) => file.startsWith(path.resolve(root) + path.sep)),
      true
    );

    assert.throws(
      () => resolveStoragePath(root, "../escape.pdf"),
      StoragePathError
    );
    assert.throws(
      () => resolveStoragePath(root, "/etc/passwd"),
      StoragePathError
    );
    await assert.rejects(
      () => storage.get("../../etc/passwd"),
      StoragePathError
    );
    assert.equal(await storage.exists(stored.storageKey), true);
    const bytes = await storage.get(stored.storageKey);
    assert.equal(bytes.toString(), "%PDF-1.4\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("document ids with path segments are rejected", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "dealwatch-storage-"));
  try {
    const storage = new LocalDocumentStorage(root);
    await assert.rejects(
      () =>
        storage.put({
          documentId: "../escape",
          filename: "loi.pdf",
          bytes: Buffer.from("x"),
        }),
      StoragePathError
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
