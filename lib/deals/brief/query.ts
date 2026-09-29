export class DealBriefQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealBriefQueryError";
  }
}

export function parseDealBriefQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): { since?: Date } {
  if (searchParams.has("workspaceId")) {
    throw new DealBriefQueryError("workspaceId is server-controlled");
  }
  const raw = searchParams.get("since");
  if (raw === null) return {};
  const value = raw.trim();
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new DealBriefQueryError("since must be a valid ISO-8601 date-time");
  }
  const since = new Date(value);
  if (!Number.isFinite(since.getTime())) {
    throw new DealBriefQueryError("since must be a valid ISO-8601 date-time");
  }
  return { since };
}
