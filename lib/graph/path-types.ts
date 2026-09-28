import type { EdgeStrength, StrengthLabel } from "./strength";
import type { CanonicalAssertionType, GraphEdge, GraphNode, GraphNodeType } from "./types";

export interface CanonicalSearchHit {
  entityType: GraphNodeType;
  entityId: string;
  nodeId: string;
  label: string;
  subtitle: string | null;
  matchField: "name" | "alias" | "address" | "deal_label";
}

export interface CanonicalSearchResult {
  workspaceId: string;
  /** Null until a reviewer sets Workspace.firmCompanyId. Never inferred. */
  firmCompanyId: string | null;
  firmLabel: string | null;
  results: CanonicalSearchHit[];
}

export interface ConnectionPathEdge extends GraphEdge {
  strengthScore: number;
  strengthLabel: StrengthLabel;
  strengthReasons: string[];
  recency: EdgeStrength["recency"];
}

export interface ConnectionPath {
  hops: number;
  pathScore: number;
  strengthLabel: StrengthLabel;
  explanation: string;
  nodes: GraphNode[];
  edges: ConnectionPathEdge[];
}

export interface ConnectionPathResult {
  workspaceId: string;
  source: { entityType: GraphNodeType; entityId: string; nodeId: string; label: string };
  target: { entityType: GraphNodeType; entityId: string; nodeId: string; label: string };
  maxDepth: number;
  paths: ConnectionPath[];
}

export interface AssertionStrength extends EdgeStrength {
  canonicalAssertionType: CanonicalAssertionType;
  canonicalAssertionId: string;
}

export const NO_DOCUMENTARY_SUPPORT =
  "No documentary support is currently linked to this canonical assertion.";
