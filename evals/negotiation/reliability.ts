import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { zodResponseFormat } from "openai/helpers/zod";
import type { NegotiationExtractorResult } from "@/lib/ai/negotiation/extractTerms";
import { NEGOTIATION_EXTRACTION_PROMPT } from "@/lib/ai/negotiation/prompt";
import { NegotiationExtractionSchema } from "@/lib/ai/negotiation/schemas";
import type { EvaluationDocument } from "./types";

const CACHE_VERSION = 1;

export const DEFAULT_EVALUATION_CACHE_DIR =
  "artifacts/negotiation-eval-cache";

export interface CacheIdentity {
  fixtureId: string;
  documentId: string;
  provider: string;
  model: string;
  extractionContractHash: string;
  documentContentHash: string;
}

interface CacheEntry {
  cacheVersion: typeof CACHE_VERSION;
  key: CacheIdentity;
  result: NegotiationExtractorResult;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function getExtractionContractHash() {
  const responseFormat = zodResponseFormat(
    NegotiationExtractionSchema,
    "dealwatch_negotiation_terms"
  );
  return sha256(
    JSON.stringify({
      prompt: NEGOTIATION_EXTRACTION_PROMPT,
      schema: responseFormat.json_schema.schema,
    })
  );
}

export function createCacheIdentity({
  fixtureId,
  document,
  provider,
  model,
  extractionContractHash,
}: {
  fixtureId: string;
  document: EvaluationDocument;
  provider: string;
  model: string;
  extractionContractHash: string;
}): CacheIdentity {
  return {
    fixtureId,
    documentId: document.id,
    provider,
    model,
    extractionContractHash,
    documentContentHash: sha256(document.text),
  };
}

function cacheFilename(key: CacheIdentity) {
  const readable = (key.fixtureId + "--" + key.documentId).replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );
  return readable + "--" + sha256(JSON.stringify(key)) + ".json";
}

function sameIdentity(actual: unknown, expected: CacheIdentity) {
  if (!actual || typeof actual !== "object") return false;
  return (Object.keys(expected) as Array<keyof CacheIdentity>).every(
    (key) => (actual as Record<string, unknown>)[key] === expected[key]
  );
}

export class EvaluationCache {
  readonly directory: string;

  constructor(directory = DEFAULT_EVALUATION_CACHE_DIR) {
    this.directory = resolve(directory);
  }

  private pathFor(key: CacheIdentity) {
    return resolve(this.directory, cacheFilename(key));
  }

  async load(key: CacheIdentity): Promise<NegotiationExtractorResult | null> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.pathFor(key), "utf8")
      );
      if (!parsed || typeof parsed !== "object") return null;
      const entry = parsed as Partial<CacheEntry>;
      if (
        entry.cacheVersion !== CACHE_VERSION ||
        !sameIdentity(entry.key, key) ||
        !entry.result ||
        entry.result.model !== key.model
      ) {
        return null;
      }
      const extraction = NegotiationExtractionSchema.safeParse(
        entry.result.extraction
      );
      return extraction.success
        ? { model: entry.result.model, extraction: extraction.data }
        : null;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async save(key: CacheIdentity, result: NegotiationExtractorResult) {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(key);
    const temporaryPath = path + "." + randomUUID() + ".tmp";
    const entry: CacheEntry = { cacheVersion: CACHE_VERSION, key, result };
    await writeFile(temporaryPath, JSON.stringify(entry, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function getHttpStatus(error: unknown): number | undefined {
  const value = record(error)?.status;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}

function header(error: unknown, name: string) {
  const headers = record(error)?.headers;
  if (headers instanceof Headers) return headers.get(name);
  const values = record(headers);
  if (!values) return null;
  const entry = Object.entries(values).find(
    ([key]) => key.toLowerCase() === name.toLowerCase()
  );
  return typeof entry?.[1] === "string" ? entry[1] : null;
}

function parseDuration(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value * 1000;
  }
  if (typeof value !== "string") {
    const duration = record(value);
    const seconds = duration?.seconds;
    const nanos = duration?.nanos;
    if (typeof seconds === "number" || typeof nanos === "number") {
      return Math.max(
        0,
        (typeof seconds === "number" ? seconds * 1000 : 0) +
          (typeof nanos === "number" ? nanos / 1_000_000 : 0)
      );
    }
    return undefined;
  }
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m|h)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[
    match[2]!.toLowerCase() as "ms" | "s" | "m" | "h"
  ];
  return amount * multiplier;
}

function retryDelays(value: unknown, seen = new Set<unknown>()): number[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const delays: number[] = [];
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (key.toLowerCase() === "retrydelay") {
      const delay = parseDuration(nested);
      if (delay !== undefined) delays.push(delay);
    }
    delays.push(...retryDelays(nested, seen));
  }
  return delays;
}

export function getRetryAfterMs(error: unknown, now = Date.now()) {
  const retryAfterMs = header(error, "retry-after-ms");
  if (retryAfterMs !== null) {
    const milliseconds = Number(retryAfterMs);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  }
  const retryAfter = header(error, "retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const delays = retryDelays(error);
  return delays.length ? Math.max(...delays) : undefined;
}

function searchableError(error: unknown) {
  const values: string[] = [];
  if (error instanceof Error) values.push(error.message);
  try {
    values.push(JSON.stringify(error));
  } catch {
    // The error message is still available for cyclic error objects.
  }
  return values.join(" ");
}

export function isDailyQuotaError(error: unknown) {
  if (getHttpStatus(error) !== 429) return false;
  return /per[\s_-]*day|requests?[^\n]{0,60}day|daily quota/i.test(
    searchableError(error)
  );
}

export function isRetryableError(error: unknown) {
  const status = getHttpStatus(error);
  return status === 429 || status === 503;
}

export function isAuthenticationError(error: unknown) {
  const status = getHttpStatus(error);
  return status === 401 || status === 403;
}

export function parseRequestInterval(value: string | undefined) {
  if (value === undefined || value.trim() === "") return 0;
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval < 0) {
    throw new Error(
      "DEALWATCH_EVAL_REQUEST_INTERVAL_MS must be a non-negative number"
    );
  }
  return interval;
}
