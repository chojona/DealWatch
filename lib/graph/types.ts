export const GRAPH_ROOT_TYPES = ["PERSON", "COMPANY", "PROPERTY", "DEAL"] as const;

export type GraphNodeType = (typeof GRAPH_ROOT_TYPES)[number];

export type GraphFilterGroup =
  | "employment"
  | "ownership"
  | "management"
  | "deal_participation"
  | "representation";

export type CanonicalAssertionType =
  | "Employment"
  | "PropertyStake"
  | "DealParticipation"
  | "DealProperty";

export interface GraphNode {
  id: string;
  entityType: GraphNodeType;
  entityId: string;
  label: string;
  subtitle: string | null;
  metadata: {
    primaryTitle?: string | null;
    city?: string | null;
    region?: string | null;
    addressLine1?: string | null;
    stage?: string | null;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  label: string;
  canonicalAssertionType: CanonicalAssertionType;
  canonicalAssertionId: string;
  supportCount: number;
}

export interface ConnectionGraphMetadata {
  rootType: GraphNodeType;
  rootId: string;
  nodeId: string;
  workspaceId: string;
  depth: number;
  unresolvedObservationCount: number | null;
  reviewHref: string | null;
}

export interface ConnectionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: ConnectionGraphMetadata;
}

export function graphNodeId(entityType: GraphNodeType, entityId: string): string {
  return `${entityType.toLowerCase()}:${entityId}`;
}
