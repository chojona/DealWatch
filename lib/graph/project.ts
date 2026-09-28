import { filterGroupFor } from "./labels";
import type {
  ConnectionGraph,
  GraphEdge,
  GraphFilterGroup,
  GraphNode,
  GraphNodeType,
} from "./types";

export interface GraphFilterState {
  nodeTypes: Record<GraphNodeType, boolean>;
  groups: Record<GraphFilterGroup, boolean>;
}

export const RELATIONSHIP_FILTERS: Array<{ id: GraphFilterGroup; label: string }> = [
  { id: "employment", label: "Employment" },
  { id: "ownership", label: "Ownership" },
  { id: "management", label: "Management" },
  { id: "deal_participation", label: "Deal participation" },
  { id: "representation", label: "Representation" },
];

export function defaultGraphFilters(): GraphFilterState {
  return {
    nodeTypes: { PERSON: true, COMPANY: true, PROPERTY: true, DEAL: true },
    groups: {
      employment: true,
      ownership: true,
      management: true,
      deal_participation: true,
      representation: true,
    },
  };
}

export function mergeConnectionGraphs(current: ConnectionGraph, addition: ConnectionGraph): ConnectionGraph {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  for (const node of addition.nodes) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }
  const edges = new Map(current.edges.map((edge) => [edge.id, edge]));
  for (const edge of addition.edges) {
    if (!edges.has(edge.id)) edges.set(edge.id, edge);
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    metadata: current.metadata,
  };
}

export function matchingNodeIds(nodes: GraphNode[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return nodes
    .filter((node) => {
      const subtitle = node.subtitle?.toLowerCase() ?? "";
      return node.label.toLowerCase().includes(needle) || subtitle.includes(needle);
    })
    .map((node) => node.id);
}

export function visibleGraphIds(
  graph: ConnectionGraph,
  filters: GraphFilterState,
  searchMatchIds: ReadonlySet<string>
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  for (const node of graph.nodes) {
    if (
      node.id === graph.metadata.nodeId ||
      filters.nodeTypes[node.entityType] ||
      searchMatchIds.has(node.id)
    ) {
      nodes.add(node.id);
    }
  }
  const edges = new Set<string>();
  for (const edge of graph.edges) {
    if (!filters.groups[filterGroupFor(edge.relationshipType)]) continue;
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    edges.add(edge.id);
  }
  return { nodes, edges };
}

export interface InspectionItem {
  label: string;
  detail: string | null;
  nodeId: string | null;
}

export interface InspectionSection {
  title: string;
  items: InspectionItem[];
}

export interface NodeInspection {
  node: GraphNode;
  connectionCount: number;
  headline: string | null;
  sections: InspectionSection[];
}

function nodesById(graph: ConnectionGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function otherNode(edge: GraphEdge, nodeId: string, index: Map<string, GraphNode>): GraphNode | null {
  const otherId = edge.source === nodeId ? edge.target : edge.source;
  return index.get(otherId) ?? null;
}

function item(node: GraphNode | null, detail: string | null): InspectionItem {
  return {
    label: node?.label ?? "Unknown",
    detail,
    nodeId: node?.id ?? null,
  };
}

export function inspectNode(graph: ConnectionGraph, nodeId: string): NodeInspection | null {
  const index = nodesById(graph);
  const node = index.get(nodeId);
  if (!node) return null;
  const incident = graph.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
  const sections: InspectionSection[] = [];

  const push = (title: string, rows: InspectionItem[]) => {
    if (rows.length) sections.push({ title, items: rows });
  };

  if (node.entityType === "PERSON") {
    push(
      "Works at",
      incident
        .filter((edge) => edge.relationshipType === "WORKS_AT")
        .map((edge) => item(otherNode(edge, nodeId, index), null))
    );
    push(
      "Deals",
      incident
        .filter((edge) => edge.canonicalAssertionType === "DealParticipation" && edge.relationshipType !== "REPRESENTS_ON_DEAL")
        .map((edge) => item(otherNode(edge, nodeId, index), edge.label))
    );
    push(
      "Represents",
      incident
        .filter((edge) => edge.relationshipType === "REPRESENTS_ON_DEAL")
        .map((edge) => item(otherNode(edge, nodeId, index), null))
    );
  } else if (node.entityType === "COMPANY") {
    push(
      "People",
      incident
        .filter((edge) => edge.relationshipType === "WORKS_AT")
        .map((edge) => item(otherNode(edge, nodeId, index), null))
    );
    push(
      "Deals",
      incident
        .filter((edge) => edge.target.startsWith("deal:") || edge.source.startsWith("deal:"))
        .filter((edge) => edge.relationshipType !== "CONCERNS_PROPERTY")
        .map((edge) => item(otherNode(edge, nodeId, index), edge.label))
    );
    push(
      "Properties",
      incident
        .filter((edge) => edge.canonicalAssertionType === "PropertyStake")
        .map((edge) => item(otherNode(edge, nodeId, index), edge.label))
    );
  } else if (node.entityType === "PROPERTY") {
    const stake = (type: string) =>
      incident
        .filter((edge) => edge.relationshipType === type)
        .map((edge) => item(otherNode(edge, nodeId, index), null));
    push("Owner", stake("OWNS"));
    push("Manager", stake("MANAGES"));
    push(
      "Other interests",
      incident
        .filter((edge) => ["OCCUPIES", "DEVELOPED", "LENDS_ON"].includes(edge.relationshipType))
        .map((edge) => item(otherNode(edge, nodeId, index), edge.label))
    );
    push(
      "Deals",
      incident
        .filter((edge) => edge.relationshipType === "CONCERNS_PROPERTY")
        .map((edge) => item(otherNode(edge, nodeId, index), null))
    );
  } else {
    const role = (types: string[]) =>
      incident
        .filter((edge) => types.includes(edge.relationshipType))
        .map((edge) => item(otherNode(edge, nodeId, index), null));
    push("Tenant", role(["TENANT"]));
    push("Landlord", role(["LANDLORD"]));
    push(
      "Brokers",
      role(["TENANT_BROKER", "LANDLORD_BROKER", "TENANT_BROKERAGE", "LANDLORD_BROKERAGE"])
    );
    push(
      "Property",
      incident
        .filter((edge) => edge.relationshipType === "CONCERNS_PROPERTY")
        .map((edge) => item(otherNode(edge, nodeId, index), null))
    );
    const shown = new Set([
      "TENANT",
      "LANDLORD",
      "TENANT_BROKER",
      "LANDLORD_BROKER",
      "TENANT_BROKERAGE",
      "LANDLORD_BROKERAGE",
      "CONCERNS_PROPERTY",
      "REPRESENTS_ON_DEAL",
    ]);
    push(
      "Other participants",
      incident
        .filter((edge) => edge.canonicalAssertionType === "DealParticipation" && !shown.has(edge.relationshipType))
        .map((edge) => item(otherNode(edge, nodeId, index), edge.label))
    );
  }

  const roleHeadline =
    node.entityType === "PERSON"
      ? incident
          .filter((edge) => edge.canonicalAssertionType === "DealParticipation" && edge.relationshipType !== "REPRESENTS_ON_DEAL")
          .map((edge) => edge.label)
          .filter((label, index, all) => all.indexOf(label) === index)
          .join(", ")
      : null;

  return {
    node,
    connectionCount: incident.length,
    headline: roleHeadline || node.subtitle,
    sections,
  };
}
