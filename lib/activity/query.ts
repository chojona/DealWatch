import {
  ACTIVITY_FILTERS,
  ACTIVITY_ROOT_TYPES,
  type ActivityCursor,
  type ActivityFilter,
  type ActivityQuery,
  type ActivityRootType,
} from "./types";

export class ActivityQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityQueryError";
  }
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeActivityCursor(value: string): ActivityCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ActivityCursor>;
    if (
      typeof parsed.id !== "string" ||
      !parsed.id ||
      (parsed.occurredAt !== null && (typeof parsed.occurredAt !== "string" || !Number.isFinite(new Date(parsed.occurredAt).getTime()))) ||
      (parsed.recordedAt !== null && (typeof parsed.recordedAt !== "string" || !Number.isFinite(new Date(parsed.recordedAt).getTime())))
    ) {
      throw new Error("invalid cursor payload");
    }
    return { id: parsed.id, occurredAt: parsed.occurredAt ?? null, recordedAt: parsed.recordedAt ?? null };
  } catch {
    throw new ActivityQueryError("cursor is invalid");
  }
}

export function parseActivityQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): ActivityQuery {
  if (searchParams.has("workspaceId")) {
    throw new ActivityQueryError("workspaceId is derived from the canonical root");
  }
  const rootType = searchParams.get("rootType") ?? "";
  const rootId = (searchParams.get("rootId") ?? "").trim();
  const filter = (searchParams.get("filter") ?? "ALL").toUpperCase();
  const limitRaw = searchParams.get("limit") ?? "25";
  const cursor = searchParams.get("cursor");
  if (!ACTIVITY_ROOT_TYPES.includes(rootType as ActivityRootType)) {
    throw new ActivityQueryError("rootType must be PERSON, COMPANY, PROPERTY, or DEAL");
  }
  if (!rootId) throw new ActivityQueryError("rootId is required");
  if (!ACTIVITY_FILTERS.includes(filter as ActivityFilter)) {
    throw new ActivityQueryError("filter must be ALL, NEGOTIATION, DOCUMENTS, or RELATIONSHIPS");
  }
  if (!/^\d+$/.test(limitRaw)) throw new ActivityQueryError("limit must be an integer from 1 to 50");
  const limit = Number(limitRaw);
  if (limit < 1 || limit > 50) throw new ActivityQueryError("limit must be an integer from 1 to 50");
  if (cursor) decodeActivityCursor(cursor);
  return { rootType: rootType as ActivityRootType, rootId, filter: filter as ActivityFilter, limit, cursor };
}
