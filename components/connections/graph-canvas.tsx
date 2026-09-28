"use client";

import { useEffect, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useInternalNode,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
} from "@xyflow/react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Building2, Handshake, Landmark, User } from "lucide-react";
import "@xyflow/react/dist/style.css";
import type { GraphNode, GraphNodeType } from "@/lib/graph/types";

export interface FlowEntityData extends Record<string, unknown> {
  label: string;
  subtitle: string | null;
  entityType: GraphNodeType;
  root: boolean;
  highlighted: boolean;
  dimmed: boolean;
  onPath: boolean;
}

type FlowEntityNode = Node<FlowEntityData, "entity">;

interface SimNode extends SimulationNodeDatum {
  id: string;
}

function seededRandom(seed: number) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function layoutNodes(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>,
  existing: Map<string, { x: number; y: number }>
): Map<string, { x: number; y: number }> {
  const radius = 150 + nodes.length * 18;
  const simNodes: SimNode[] = nodes.map((node, index) => {
    const previous = existing.get(node.id);
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    return {
      id: node.id,
      x: previous?.x ?? Math.cos(angle) * radius,
      y: previous?.y ?? Math.sin(angle) * radius,
      fx: previous?.x,
      fy: previous?.y,
    };
  });
  const present = new Set(simNodes.map((node) => node.id));
  const links: SimulationLinkDatum<SimNode>[] = edges
    .filter((edge) => present.has(edge.source) && present.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));
  let seed = 2166136261;
  for (const node of nodes) {
    for (const char of node.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  }
  const simulation = forceSimulation(simNodes)
    .randomSource(seededRandom(seed >>> 0))
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((node) => node.id).distance(210).strength(0.4)
    )
    .force("charge", forceManyBody().strength(-520))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(108))
    .stop();
  const ticks = existing.size === 0 ? 360 : 120;
  for (let tick = 0; tick < ticks; tick += 1) simulation.tick();
  const next = new Map(existing);
  for (const node of simNodes) next.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
  return next;
}

function typeName(entityType: GraphNodeType): string {
  if (entityType === "PERSON") return "Person";
  if (entityType === "COMPANY") return "Company";
  if (entityType === "PROPERTY") return "Property";
  return "Deal";
}

function Mark({ entityType }: { entityType: GraphNodeType }) {
  if (entityType === "PERSON") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-800">
        <User className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (entityType === "COMPANY") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-zinc-900 text-white">
        <Building2 className="h-3.5 w-3.5" aria-hidden />
      </span>
    );
  }
  if (entityType === "PROPERTY") {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">
        <span className="flex h-6 w-6 rotate-45 items-center justify-center border border-zinc-500 bg-[#f4f1ea]">
          <Landmark className="h-3 w-3 -rotate-45 text-zinc-800" aria-hidden />
        </span>
      </span>
    );
  }
  return (
    <span className="relative flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-900 bg-white text-zinc-900">
      <span className="absolute right-0 top-0 h-2 w-2 border-b border-l border-zinc-900 bg-zinc-100" aria-hidden />
      <Handshake className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}

function EntityNode({ data }: NodeProps<FlowEntityNode>) {
  return (
    <div
      className={`relative w-[232px] rounded-sm border bg-white px-2.5 py-2 shadow-[0_1px_0_rgba(24,24,27,0.04)] ${
        data.root ? "border-zinc-900 ring-2 ring-zinc-900 ring-offset-2" : "border-zinc-300"
      } ${data.onPath ? "border-zinc-950" : ""} ${data.highlighted ? "outline outline-2 outline-offset-4 outline-zinc-900" : ""} ${
        data.dimmed ? "opacity-35" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <div className="flex items-center gap-2">
        <Mark entityType={data.entityType} />
        <div className="min-w-0">
          <p className="text-[10px] text-zinc-500">
            {typeName(data.entityType)}
            {data.root ? " · starting point" : ""}
          </p>
          <p className="text-[13px] font-semibold leading-tight text-zinc-950">{data.label}</p>
          {data.subtitle && <p className="text-[11px] leading-tight text-zinc-500">{data.subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function borderPoint(
  node: { x: number; y: number; width: number; height: number },
  toward: { x: number; y: number }
) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy, position: Position.Right };
  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
  const x = cx + dx * scale;
  const y = cy + dy * scale;
  const position =
    Math.abs(dx) / halfWidth > Math.abs(dy) / halfHeight
      ? dx > 0
        ? Position.Right
        : Position.Left
      : dy > 0
        ? Position.Bottom
        : Position.Top;
  return { x, y, position };
}

function FloatingEdge({ id, source, target, markerEnd, style, label, selected, data }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const sourceBox = {
    x: sourceNode.internals.positionAbsolute.x,
    y: sourceNode.internals.positionAbsolute.y,
    width: sourceNode.measured.width ?? 232,
    height: sourceNode.measured.height ?? 64,
  };
  const targetBox = {
    x: targetNode.internals.positionAbsolute.x,
    y: targetNode.internals.positionAbsolute.y,
    width: targetNode.measured.width ?? 232,
    height: targetNode.measured.height ?? 64,
  };
  const sourcePoint = borderPoint(sourceBox, {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  });
  const targetPoint = borderPoint(targetBox, {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  });
  const [path] = getBezierPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition: sourcePoint.position,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition: targetPoint.position,
  });
  const labelX = sourcePoint.x + (targetPoint.x - sourcePoint.x) * 0.38;
  const labelY = sourcePoint.y + (targetPoint.y - sourcePoint.y) * 0.38;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={18} />
      {label ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            data-edge-id={id}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            className={`nodrag nopan pointer-events-auto absolute rounded-sm border px-1.5 py-0.5 text-[10px] leading-none ${
              selected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-[#f7f6f3] text-zinc-700"
            } ${data?.dimmed ? "opacity-35" : ""}`}
            title={
              typeof data?.strengthLabel === "string"
                ? `${label}. Relationship strength ${data.strengthLabel}`
                : String(label ?? "")
            }
            aria-label={`${label}${
              typeof data?.strengthLabel === "string" ? `, relationship strength ${data.strengthLabel}` : ""
            }, ${String(sourceNode.data.label)} to ${String(targetNode.data.label)}`}
          >
            {label}
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { entity: EntityNode };
const edgeTypes = { floating: FloatingEdge };

export function GraphCanvas({
  nodes,
  edges,
  rootId,
  selectedNodeId,
  selectedEdgeId,
  highlightedIds,
  pathNodeIds,
  onSelectNode,
  onSelectEdge,
  onClear,
  focusNodeId,
  focusNodeIds,
}: {
  nodes: GraphNode[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
    strengthLabel?: string;
    dimmed?: boolean;
    emphasized?: boolean;
  }>;
  rootId: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  highlightedIds: string[];
  pathNodeIds: string[] | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClear: () => void;
  focusNodeId: string | null;
  focusNodeIds: string[] | null;
}) {
  return (
    <ReactFlowProvider>
      <GraphSurface
        nodes={nodes}
        edges={edges}
        rootId={rootId}
        selectedNodeId={selectedNodeId}
        selectedEdgeId={selectedEdgeId}
        highlightedIds={highlightedIds}
        pathNodeIds={pathNodeIds}
        onSelectNode={onSelectNode}
        onSelectEdge={onSelectEdge}
        onClear={onClear}
        focusNodeId={focusNodeId}
        focusNodeIds={focusNodeIds}
      />
    </ReactFlowProvider>
  );
}

function GraphSurface(props: {
  nodes: GraphNode[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
    strengthLabel?: string;
    dimmed?: boolean;
    emphasized?: boolean;
  }>;
  rootId: string;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  highlightedIds: string[];
  pathNodeIds: string[] | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onClear: () => void;
  focusNodeId: string | null;
  focusNodeIds: string[] | null;
}) {
  const { fitView } = useReactFlow();
  const structureKey = `${props.nodes.map((node) => node.id).join("\n")}::${props.edges.map((edge) => edge.id).join("\n")}`;
  const [layoutKey, setLayoutKey] = useState("");
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  let placed = positions;
  if (layoutKey !== structureKey) {
    placed = layoutNodes(props.nodes, props.edges, positions);
    setLayoutKey(structureKey);
    setPositions(placed);
  }
  const highlighted = new Set(props.highlightedIds);
  const pathNodes = props.pathNodeIds ? new Set(props.pathNodeIds) : null;
  const flowNodes: FlowEntityNode[] = props.nodes.map((node) => ({
    id: node.id,
    type: "entity",
    position: placed.get(node.id) ?? { x: 0, y: 0 },
    data: {
      label: node.label,
      subtitle: node.subtitle,
      entityType: node.entityType,
      root: node.id === props.rootId,
      highlighted: highlighted.has(node.id),
      dimmed: pathNodes ? !pathNodes.has(node.id) : false,
      onPath: pathNodes ? pathNodes.has(node.id) : false,
    },
    selected: node.id === props.selectedNodeId,
    draggable: true,
    ariaLabel: `${typeName(node.entityType)} ${node.label}`,
  }));
  const flowEdges: Edge[] = props.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
        type: "floating",
    label: edge.label,
    selected: edge.id === props.selectedEdgeId || Boolean(edge.emphasized),
    data: { strengthLabel: edge.strengthLabel, dimmed: Boolean(edge.dimmed) },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 16,
      height: 16,
      color: edge.id === props.selectedEdgeId || edge.emphasized ? "#18181b" : "#a1a1aa",
    },
    style: {
      stroke: edge.id === props.selectedEdgeId || edge.emphasized ? "#18181b" : "#a1a1aa",
      strokeWidth: edge.emphasized ? 2.4 : edge.id === props.selectedEdgeId ? 1.6 : 1,
      opacity: edge.dimmed ? 0.28 : 1,
    },
  }));

  const focusKey = props.focusNodeIds?.join("\n") || props.focusNodeId || "";
  useEffect(() => {
    const ids = focusKey.split("\n").filter(Boolean);
    if (ids.length === 0) return;
    const frame = requestAnimationFrame(() => {
      fitView({ nodes: ids.map((id) => ({ id })), padding: 0.4, duration: 350 });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey, fitView]);

  const onNodesChange = (changes: NodeChange<FlowEntityNode>[]) => {
    setPositions((current) => {
      let moved = false;
      const next = new Map(current);
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          next.set(change.id, change.position);
          moved = true;
        }
      }
      return moved ? next : current;
    });
  };

  return (
    <div
      className="relative h-full w-full bg-[#f3f1ec]"
      onClick={(event) => {
        const edgeId = (event.target as HTMLElement).closest("[data-edge-id]")?.getAttribute("data-edge-id");
        if (edgeId) props.onSelectEdge(edgeId);
      }}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => props.onSelectNode(node.id)}
        onEdgeClick={(_, edge) => props.onSelectEdge(edge.id)}
        onPaneClick={props.onClear}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.25}
        maxZoom={1.6}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={null}
      >
        <Background gap={22} size={1.1} color="#d6d3cb" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <FitButton />
    </div>
  );
}

function FitButton() {
  const { fitView } = useReactFlow();
  return (
    <button
      type="button"
      className="absolute bottom-3 left-12 z-10 rounded-sm border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-800 shadow-sm hover:bg-zinc-50"
      onClick={() => fitView({ padding: 0.18, duration: 300 })}
    >
      Fit
    </button>
  );
}
