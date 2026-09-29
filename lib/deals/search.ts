import type { PrismaClient } from "@prisma/client";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const DEAL_SEARCH_DEFAULT_LIMIT = 25;
const DEAL_SEARCH_MAX_LIMIT = 50;
const DEAL_SEARCH_MAX_QUERY = 200;

export class DealSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DealSearchError";
  }
}

export interface DealSearchHit {
  id: string;
  name: string;
  company: string;
  property: string;
  stage: string;
  status: string;
  href: string;
}

export interface DealSearchResponse {
  workspaceId: string | null;
  query: string;
  results: DealSearchHit[];
  truncated: boolean;
}

/** Trim and collapse whitespace. Case is preserved for the database match. */
export function normalizeDealSearchQuery(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function parseDealSearchRequest(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): { q: string } {
  if (searchParams.has("workspaceId")) {
    throw new DealSearchError("workspaceId is server-controlled");
  }
  const q = normalizeDealSearchQuery(searchParams.get("q") ?? "");
  if (q.length > DEAL_SEARCH_MAX_QUERY) {
    throw new DealSearchError("q must be at most 200 characters");
  }
  return { q };
}

function resultLimit(value: number | undefined): number {
  if (value == null || !Number.isInteger(value) || value < 1) return DEAL_SEARCH_DEFAULT_LIMIT;
  return Math.min(value, DEAL_SEARCH_MAX_LIMIT);
}

function toHit(deal: {
  id: string;
  name: string;
  company: string;
  property: string;
  stage: string;
  status: string;
}): DealSearchHit {
  return {
    id: deal.id,
    name: deal.name,
    company: deal.company,
    property: deal.property,
    stage: deal.stage,
    status: deal.status,
    href: `/deals/${deal.id}`,
  };
}

/**
 * Workspace-scoped discovery over Deal name, company, and property.
 * An omitted workspace id uses the server default workspace. A blank query
 * returns that workspace's deals, still bounded and ordered.
 */
export async function searchDeals(
  db: PrismaClient,
  input: { q?: string; workspaceId?: string | null; limit?: number } = {}
): Promise<DealSearchResponse> {
  const query = normalizeDealSearchQuery(input.q ?? "");
  if (query.length > DEAL_SEARCH_MAX_QUERY) {
    throw new DealSearchError("q must be at most 200 characters");
  }
  const limit = resultLimit(input.limit);
  const workspaceId = input.workspaceId === undefined
    ? await messageRequestWorkspaceId(db)
    : input.workspaceId;
  if (!workspaceId) {
    return { workspaceId: null, query, results: [], truncated: false };
  }

  // name, company, and property are unindexed. The workspaceId index bounds the
  // scan to one firm. A leading-wildcard match would not use a btree index on
  // those text columns, so no extra index is added for the current dataset.
  const rows = await db.deal.findMany({
    where: {
      workspaceId,
      ...(query
        ? {
            OR: [
              { name: { contains: query } },
              { company: { contains: query } },
              { property: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      name: true,
      company: true,
      property: true,
      stage: true,
      status: true,
    },
  });
  return {
    workspaceId,
    query,
    results: rows.slice(0, limit).map(toHit),
    truncated: rows.length > limit,
  };
}
