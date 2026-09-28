import { GRAPH_ROOT_TYPES, type GraphNodeType } from "./types";

export class GraphQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphQueryError";
  }
}

export interface ParsedGraphQuery {
  rootType: GraphNodeType;
  rootId: string;
  depth: number;
}

export function assertGraphQuery(input: {
  rootType: string;
  rootId: string;
  depth: number;
}): ParsedGraphQuery {
  if (!GRAPH_ROOT_TYPES.includes(input.rootType as GraphNodeType)) {
    throw new GraphQueryError("rootType must be PERSON, COMPANY, PROPERTY, or DEAL");
  }
  const rootId = input.rootId.trim();
  if (!rootId) throw new GraphQueryError("rootId is required");
  if (!Number.isInteger(input.depth) || input.depth < 1 || input.depth > 2) {
    throw new GraphQueryError("depth must be 1 or 2");
  }
  return { rootType: input.rootType as GraphNodeType, rootId, depth: input.depth };
}

export interface ParsedSearchQuery {
  q: string;
  rootType: GraphNodeType | null;
  rootId: string | null;
}

export interface ParsedPathQuery {
  sourceType: GraphNodeType;
  sourceId: string;
  targetType: GraphNodeType;
  targetId: string;
  maxDepth: number;
}

export class GraphRequestError extends Error {
  readonly status: 400 | 404;

  constructor(message: string, status: 400 | 404) {
    super(message);
    this.name = "GraphRequestError";
    this.status = status;
  }
}

function rejectClientWorkspace(searchParams: { has(name: string): boolean }) {
  if (searchParams.has("workspaceId")) {
    throw new GraphQueryError("workspaceId is not accepted from the client");
  }
}

function parseEntityType(value: string, field: string): GraphNodeType {
  if (!GRAPH_ROOT_TYPES.includes(value as GraphNodeType)) {
    throw new GraphQueryError(`${field} must be PERSON, COMPANY, PROPERTY, or DEAL`);
  }
  return value as GraphNodeType;
}

export function parseSearchQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): ParsedSearchQuery {
  rejectClientWorkspace(searchParams);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) throw new GraphQueryError("q must be at least 2 characters");
  if (q.length > 80) throw new GraphQueryError("q must be at most 80 characters");
  const rootTypeRaw = searchParams.get("rootType");
  const rootIdRaw = searchParams.get("rootId");
  if (Boolean(rootTypeRaw) !== Boolean(rootIdRaw)) {
    throw new GraphQueryError("rootType and rootId are set together");
  }
  return {
    q,
    rootType: rootTypeRaw ? parseEntityType(rootTypeRaw, "rootType") : null,
    rootId: rootIdRaw?.trim() || null,
  };
}

export function parsePathQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): ParsedPathQuery {
  rejectClientWorkspace(searchParams);
  const sourceId = (searchParams.get("sourceId") ?? "").trim();
  const targetId = (searchParams.get("targetId") ?? "").trim();
  if (!sourceId || !targetId) throw new GraphQueryError("sourceId and targetId are required");
  const depthRaw = searchParams.get("maxDepth") ?? "4";
  if (!/^\d+$/.test(depthRaw)) throw new GraphQueryError("maxDepth must be from 1 to 4");
  const maxDepth = Number(depthRaw);
  if (maxDepth < 1 || maxDepth > 4) throw new GraphQueryError("maxDepth must be from 1 to 4");
  return {
    sourceType: parseEntityType(searchParams.get("sourceType") ?? "", "sourceType"),
    sourceId,
    targetType: parseEntityType(searchParams.get("targetType") ?? "", "targetType"),
    targetId,
    maxDepth,
  };
}

export function parseStrengthQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): { assertionType: "Employment" | "PropertyStake" | "DealParticipation" | "DealProperty"; assertionId: string } {
  rejectClientWorkspace(searchParams);
  const assertionType = searchParams.get("assertionType") ?? "";
  const assertionId = (searchParams.get("assertionId") ?? "").trim();
  if (
    assertionType !== "Employment" &&
    assertionType !== "PropertyStake" &&
    assertionType !== "DealParticipation" &&
    assertionType !== "DealProperty"
  ) {
    throw new GraphQueryError("assertionType is not a canonical assertion");
  }
  if (!assertionId) throw new GraphQueryError("assertionId is required");
  return { assertionType, assertionId };
}

export function parseGraphQuery(searchParams: {
  get(name: string): string | null;
  has(name: string): boolean;
}): ParsedGraphQuery {
  if (searchParams.has("workspaceId")) {
    throw new GraphQueryError("workspaceId is derived from the root entity");
  }
  const depthRaw = searchParams.get("depth") ?? "1";
  if (!/^\d+$/.test(depthRaw)) throw new GraphQueryError("depth must be 1 or 2");
  return assertGraphQuery({
    rootType: searchParams.get("rootType") ?? "",
    rootId: searchParams.get("rootId") ?? "",
    depth: Number(depthRaw),
  });
}
