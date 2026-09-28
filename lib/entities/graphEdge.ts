import type { GraphDb } from "./workspace";

export type GraphNodeType = "PERSON" | "COMPANY" | "PROPERTY" | "DEAL";

export type GraphEdge = {
  workspaceId: string;
  fromType: GraphNodeType;
  fromId: string;
  toType: GraphNodeType;
  toId: string;
  predicate: string;
  dealId: string | null;
  assertionId: string;
  validFrom: Date | null;
  validTo: Date | null;
};

type GraphEdgeRow = {
  workspace_id: string;
  from_type: GraphNodeType;
  from_id: string;
  to_type: GraphNodeType;
  to_id: string;
  predicate: string;
  deal_id: string | null;
  assertion_id: string;
  valid_from: bigint | number | string | null;
  valid_to: bigint | number | string | null;
};

function toDate(value: bigint | number | string | null): Date | null {
  if (value == null) return null;
  if (typeof value === "bigint") return new Date(Number(value));
  if (typeof value === "number") return new Date(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function listGraphEdges(
  db: GraphDb,
  workspaceId: string
): Promise<GraphEdge[]> {
  const rows = await db.$queryRaw<GraphEdgeRow[]>`
    SELECT
      workspace_id,
      from_type,
      from_id,
      to_type,
      to_id,
      predicate,
      deal_id,
      assertion_id,
      valid_from,
      valid_to
    FROM graph_edge
    WHERE workspace_id = ${workspaceId}
  `;
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    fromType: row.from_type,
    fromId: row.from_id,
    toType: row.to_type,
    toId: row.to_id,
    predicate: row.predicate,
    dealId: row.deal_id,
    assertionId: row.assertion_id,
    validFrom: toDate(row.valid_from),
    validTo: toDate(row.valid_to),
  }));
}
