"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { EvidencePanel } from "@/components/knowledge/evidence-panel";

const GraphCanvas = dynamic(
  () => import("@/components/connections/graph-canvas").then((mod) => mod.GraphCanvas),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-canvas" />,
  }
);
import { assertionNoun } from "@/lib/graph/labels";
import { NO_DOCUMENTARY_SUPPORT, type CanonicalSearchHit, type ConnectionPathResult } from "@/lib/graph/path-types";
import {
  defaultGraphFilters,
  inspectNode,
  mergeConnectionGraphs,
  RELATIONSHIP_FILTERS,
  visibleGraphIds,
  type GraphFilterState,
} from "@/lib/graph/project";
import type { EdgeStrength } from "@/lib/graph/strength";
import type { ConnectionGraph, GraphEdge, GraphNode, GraphNodeType } from "@/lib/graph/types";
import type { EvidenceView } from "@/lib/promotion/types";

const NODE_FILTERS: Array<{ id: GraphNodeType; label: string }> = [
  { id: "PERSON", label: "People" },
  { id: "COMPANY", label: "Companies" },
  { id: "PROPERTY", label: "Properties" },
  { id: "DEAL", label: "Deals" },
];

export function ConnectionMap({
  initialGraph,
  firmCompanyId,
  firmLabel,
}: {
  initialGraph: ConnectionGraph;
  firmCompanyId: string | null;
  firmLabel: string | null;
}) {
  const [graph, setGraph] = useState(initialGraph);
  const [filters, setFilters] = useState<GraphFilterState>(defaultGraphFilters);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CanonicalSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mode, setMode] = useState<"explore" | "connect">("explore");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialGraph.metadata.nodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [target, setTarget] = useState<CanonicalSearchHit | null>(null);
  const [pathResult, setPathResult] = useState<ConnectionPathResult | null>(null);
  const [pathIndex, setPathIndex] = useState(0);
  const [pathError, setPathError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);

  const rootNode = graph.nodes.find((node) => node.id === graph.metadata.nodeId) ?? null;
  const activePath = pathResult?.paths[pathIndex] ?? null;
  const pathNodeIds = useMemo(
    () => (mode === "connect" && activePath ? activePath.nodes.map((node) => node.id) : null),
    [mode, activePath]
  );
  const pathEdgeIds = useMemo(
    () => (mode === "connect" && activePath ? new Set(activePath.edges.map((edge) => edge.id)) : null),
    [mode, activePath]
  );
  const searchQuery = query.trim().length >= 2 ? query.trim() : "";
  const visibleHits = useMemo(() => (searchQuery ? hits : []), [searchQuery, hits]);

  useEffect(() => {
    if (!searchQuery) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: searchQuery,
        rootType: graph.metadata.rootType,
        rootId: graph.metadata.rootId,
      });
      setSearching(true);
      fetch(`/api/graph/search?${params.toString()}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("search");
          return (await response.json()) as { results: CanonicalSearchHit[] };
        })
        .then((body) => {
          setHits(body.results);
          setSearchError(null);
        })
        .catch(() => setSearchError("Search could not be read."))
        .finally(() => setSearching(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [searchQuery, graph.metadata.rootId, graph.metadata.rootType]);

  const matches = useMemo(
    () => visibleHits.map((hit) => hit.nodeId).filter((id) => graph.nodes.some((node) => node.id === id)),
    [visibleHits, graph.nodes]
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const visible = useMemo(() => {
    const base = visibleGraphIds(graph, filters, matchSet);
    if (pathNodeIds) for (const id of pathNodeIds) base.nodes.add(id);
    if (pathEdgeIds) for (const id of pathEdgeIds) base.edges.add(id);
    return base;
  }, [graph, filters, matchSet, pathNodeIds, pathEdgeIds]);
  const visibleNodes = graph.nodes.filter((node) => visible.nodes.has(node.id));
  const visibleEdges = graph.edges.filter((edge) => visible.edges.has(edge.id));
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const inspection = selectedNode ? inspectNode(graph, selectedNode.id) : null;
  const focusNodeIds = mode === "connect" && activePath ? activePath.nodes.map((node) => node.id) : null;
  const focusNodeId = mode === "explore" && query.trim() ? matches[0] ?? null : null;

  function absorb(nodes: GraphNode[], edges: GraphEdge[]) {
    setGraph((current) =>
      mergeConnectionGraphs(current, {
        nodes,
        edges,
        metadata: current.metadata,
      })
    );
  }

  async function viewConnections(hit: CanonicalSearchHit) {
    setMode("explore");
    setPathResult(null);
    setTarget(null);
    await expand(hit);
    setSelectedNodeId(hit.nodeId);
    setSelectedEdgeId(null);
  }

  async function findConnection(source: { entityType: GraphNodeType; entityId: string }, nextTarget: CanonicalSearchHit) {
    setMode("connect");
    setTarget(nextTarget);
    setSourceLabel(
      firmCompanyId && source.entityId === firmCompanyId && source.entityType === "COMPANY"
        ? firmLabel
        : rootNode?.label ?? null
    );
    setFinding(true);
    setPathError(null);
    setPathIndex(0);
    try {
      const params = new URLSearchParams({
        sourceType: source.entityType,
        sourceId: source.entityId,
        targetType: nextTarget.entityType,
        targetId: nextTarget.entityId,
        maxDepth: "4",
      });
      const response = await fetch(`/api/graph/paths?${params.toString()}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setPathResult(null);
        setPathError(body?.error ?? "That connection could not be read.");
        return;
      }
      const result = (await response.json()) as ConnectionPathResult;
      setPathResult(result);
      const first = result.paths[0];
      if (first) {
        absorb(first.nodes, first.edges);
        setSelectedEdgeId(first.edges[0]?.id ?? null);
        setSelectedNodeId(null);
      }
    } catch {
      setPathError("That connection could not be read.");
    } finally {
      setFinding(false);
    }
  }

  function showPath(index: number) {
    const next = pathResult?.paths[index];
    if (!next) return;
    setPathIndex(index);
    absorb(next.nodes, next.edges);
    setSelectedEdgeId(next.edges[0]?.id ?? null);
    setSelectedNodeId(null);
  }

  async function expand(node: { entityType: GraphNodeType; entityId: string }) {
    setExpanding(true);
    setExpandError(null);
    try {
      const params = new URLSearchParams({
        rootType: node.entityType,
        rootId: node.entityId,
        depth: "1",
      });
      const response = await fetch(`/api/graph?${params.toString()}`);
      if (!response.ok) {
        setExpandError("Those connections could not be loaded.");
        return;
      }
      const addition = (await response.json()) as ConnectionGraph;
      setGraph((current) => mergeConnectionGraphs(current, addition));
    } catch {
      setExpandError("Those connections could not be loaded.");
    } finally {
      setExpanding(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-18rem)] min-h-[520px] flex-col lg:h-[calc(100dvh-14rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-[#f7f6f3] px-4 py-2">
        <div className="flex items-center gap-1">
          <FilterChip pressed={mode === "explore"} label="Explore" onClick={() => setMode("explore")} />
          <FilterChip pressed={mode === "connect"} label="Find connection" onClick={() => setMode("connect")} />
        </div>
        <div className="relative">
          <label className="sr-only" htmlFor="graph-search">
            Search canonical people, companies, properties, and deals
          </label>
          <input
            id="graph-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the workspace"
            className="h-8 w-56 rounded-sm border border-zinc-300 bg-white px-2 text-xs text-zinc-900 outline-none focus:border-zinc-900"
          />
          {(visibleHits.length > 0 || searchError || searching) && searchQuery && (
            <ul className="absolute left-0 top-9 z-20 max-h-72 w-80 overflow-y-auto rounded-sm border border-zinc-300 bg-white py-1 shadow-md">
              {searching && <li className="px-2 py-1 text-[11px] text-zinc-500">Searching confirmed entities…</li>}
              {searchError && <li className="px-2 py-1 text-[11px] text-red-700">{searchError}</li>}
              {visibleHits.map((hit) => (
                <li key={hit.nodeId} className="border-t border-zinc-100 px-2 py-1.5 first:border-t-0">
                  <p className="text-xs font-medium text-zinc-950">
                    {hit.label}
                    <span className="ml-2 text-[10px] font-normal tracking-wide text-zinc-500">{hit.entityType}</span>
                  </p>
                  {hit.subtitle && <p className="text-[11px] text-zinc-500">{hit.subtitle}</p>}
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded-sm border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-800 hover:bg-zinc-50"
                      onClick={() => viewConnections(hit)}
                    >
                      View connections
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-900 hover:bg-zinc-50"
                      onClick={() => {
                        if (!rootNode) return;
                        findConnection(
                          { entityType: rootNode.entityType, entityId: rootNode.entityId },
                          hit
                        );
                      }}
                    >
                      Find connection from current root
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-zinc-300 px-1.5 py-0.5 text-[11px] text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                      onClick={() => {
                        if (!firmCompanyId) {
                          setMode("connect");
                          setTarget(hit);
                          setSourceLabel(null);
                          return;
                        }
                        findConnection({ entityType: "COMPANY", entityId: firmCompanyId }, hit);
                      }}
                    >
                      How are we connected?
                    </button>
                  </div>
                </li>
              ))}
              {!searching && visibleHits.length === 0 && !searchError && (
                <li className="px-2 py-1 text-[11px] text-zinc-500">No confirmed entities match.</li>
              )}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {NODE_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              pressed={filters.nodeTypes[filter.id]}
              label={filter.label}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  nodeTypes: { ...current.nodeTypes, [filter.id]: !current.nodeTypes[filter.id] },
                }))
              }
            />
          ))}
        </div>
        <div className="hidden h-4 w-px bg-zinc-300 sm:block" />
        <div className="flex flex-wrap items-center gap-1">
          {RELATIONSHIP_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              pressed={filters.groups[filter.id]}
              label={filter.label}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  groups: { ...current.groups, [filter.id]: !current.groups[filter.id] },
                }))
              }
            />
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <GraphCanvas
            nodes={visibleNodes}
            edges={visibleEdges.map((edge) => {
              const onPath = pathEdgeIds?.has(edge.id) ?? false;
              const pathEdge = activePath?.edges.find((item) => item.id === edge.id);
              return {
                ...edge,
                strengthLabel: pathEdge?.strengthLabel,
                emphasized: onPath,
                dimmed: pathEdgeIds ? !onPath : false,
              };
            })}
            rootId={graph.metadata.nodeId}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            highlightedIds={matches}
            pathNodeIds={pathNodeIds}
            focusNodeId={focusNodeId}
            focusNodeIds={focusNodeIds}
            onSelectNode={(id) => {
              setSelectedNodeId(id);
              setSelectedEdgeId(null);
            }}
            onSelectEdge={(id) => {
              setSelectedEdgeId(id);
              setSelectedNodeId(null);
            }}
            onClear={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
          />
          {graph.edges.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-sm rounded-sm border border-zinc-300 bg-white px-4 py-3 shadow-sm">
                <p className="text-sm font-medium text-zinc-900">No confirmed connections yet.</p>
                {graph.metadata.unresolvedObservationCount ? (
                  <p className="mt-1 text-xs text-zinc-600">
                    DealWatch has {graph.metadata.unresolvedObservationCount} unresolved{" "}
                    {graph.metadata.unresolvedObservationCount === 1 ? "observation" : "observations"} for this deal.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-zinc-600">
                    Confirmed employment, ownership, and deal roles will appear here.
                  </p>
                )}
                {graph.metadata.reviewHref && graph.metadata.unresolvedObservationCount ? (
                  <a className="mt-2 inline-block text-xs text-zinc-900 underline" href={graph.metadata.reviewHref}>
                    Review them
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-zinc-200 bg-white">
          {mode === "connect" && (
            <PathPanel
              rootLabel={sourceLabel ?? rootNode?.label ?? "Current root"}
              firmLabel={firmLabel}
              targetLabel={target?.label ?? pathResult?.target.label ?? null}
              finding={finding}
              pathError={pathError}
              paths={pathResult?.paths ?? []}
              pathIndex={pathIndex}
              onSelectPath={showPath}
            />
          )}
          {inspection && selectedNode && (
            <NodeInspector
              inspectionHeadline={inspection.headline}
              label={selectedNode.label}
              entityType={selectedNode.entityType}
              entityId={selectedNode.entityId}
              subtitle={selectedNode.subtitle}
              connectionCount={inspection.connectionCount}
              sections={inspection.sections}
              expanding={expanding}
              expandError={expandError}
              onExpand={() => expand(selectedNode)}
              onOpen={(nodeId) => {
                setSelectedNodeId(nodeId);
                setSelectedEdgeId(null);
              }}
            />
          )}
          {selectedEdge && (
            <EdgeInspector
              key={selectedEdge.id}
              edge={selectedEdge}
              source={graph.nodes.find((node) => node.id === selectedEdge.source) ?? null}
              target={graph.nodes.find((node) => node.id === selectedEdge.target) ?? null}
            />
          )}
          {!inspection && !selectedEdge && (
            <div className="px-4 py-5">
              <p className="text-sm text-zinc-700">Select a name or a relationship.</p>
              <p className="mt-1 text-xs text-zinc-500">
                {graph.nodes.length} loaded {graph.nodes.length === 1 ? "node" : "nodes"}, {graph.edges.length}{" "}
                confirmed {graph.edges.length === 1 ? "relationship" : "relationships"}.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function PathPanel({
  rootLabel,
  firmLabel,
  targetLabel,
  finding,
  pathError,
  paths,
  pathIndex,
  onSelectPath,
}: {
  rootLabel: string;
  firmLabel: string | null;
  targetLabel: string | null;
  finding: boolean;
  pathError: string | null;
  paths: ConnectionPathResult["paths"];
  pathIndex: number;
  onSelectPath: (index: number) => void;
}) {
  const path = paths[pathIndex] ?? null;
  return (
    <div className="border-b border-zinc-200 px-4 py-4">
      <p className="text-[10px] text-zinc-500">Find connection</p>
      <p className="mt-2 text-[11px] text-zinc-500">From</p>
      <p className="text-sm font-medium text-zinc-950">{rootLabel}</p>
      <p className="mt-2 text-[11px] text-zinc-500">To</p>
      <p className="text-sm font-medium text-zinc-950">{targetLabel ?? "Search and choose a target"}</p>
      {!firmLabel && (
        <p className="mt-2 text-xs text-zinc-600">Set your firm before using &apos;How are we connected?&apos;</p>
      )}
      {finding && <p className="mt-2 text-xs text-zinc-500">Finding a confirmed path…</p>}
      {pathError && <p className="mt-2 text-xs text-red-700">{pathError}</p>}
      {path && (
        <div className="mt-3">
          <p className="text-[10px] text-zinc-500">{pathIndex === 0 ? "Best connection" : "Alternative"}</p>
          <ol className="mt-1 space-y-1">
            {path.nodes.map((node, index) => {
              const edge = path.edges[index - 1];
              return (
                <li key={node.id} className="text-xs text-zinc-800">
                  {edge ? <span className="text-zinc-500">{edge.label} · </span> : null}
                  {node.label}
                  <span className="ml-1 text-[10px] text-zinc-400">{node.entityType}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-zinc-700">
            {path.hops} {path.hops === 1 ? "hop" : "hops"}
            <span className="mx-1 text-zinc-300">·</span>
            Path score {path.pathScore.toFixed(2)}
            <span className="mx-1 text-zinc-300">·</span>
            {path.strengthLabel} support
          </p>
          <p className="mt-2 text-xs leading-5 text-zinc-800">{path.explanation}</p>
        </div>
      )}
      {!finding && targetLabel && paths.length === 0 && !pathError && (
        <p className="mt-3 text-xs text-zinc-600">No confirmed connection within 4 hops.</p>
      )}
      {paths.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {paths.map((item, index) => (
            <button
              key={`${item.hops}-${item.pathScore}-${index}`}
              type="button"
              aria-pressed={index === pathIndex}
              className={`rounded-sm border px-2 py-1 text-[11px] ${
                index === pathIndex ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"
              }`}
              onClick={() => onSelectPath(index)}
            >
              {index === 0 ? "Best" : `Path ${index + 1}`} · {item.hops} {item.hops === 1 ? "hop" : "hops"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StrengthBlock({ edge }: { edge: GraphEdge }) {
  const [strength, setStrength] = useState<EdgeStrength | null>(null);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      assertionType: edge.canonicalAssertionType,
      assertionId: edge.canonicalAssertionId,
    });
    fetch(`/api/graph/strength?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("strength");
        return (await response.json()) as EdgeStrength;
      })
      .then((body) => {
        if (!cancelled) setStrength(body);
      })
      .catch(() => {
        if (!cancelled) setStrength(null);
      });
    return () => {
      cancelled = true;
    };
  }, [edge.canonicalAssertionId, edge.canonicalAssertionType]);

  if (!strength) return null;
  return (
    <div className="mt-3">
      <p className="text-xs text-zinc-700">
        Relationship strength <span className="font-medium text-zinc-950">{strength.strengthLabel}</span>
      </p>
      <p className="mt-1 text-xs text-zinc-700">
        Score <span className="font-medium text-zinc-950">{strength.strengthScore.toFixed(2)}</span>
      </p>
      <p className="mt-2 text-[11px] font-medium text-zinc-500">Why</p>
      <ul className="mt-1 space-y-0.5">
        {strength.strengthReasons.map((reason) => (
          <li key={reason} className="text-[11px] text-zinc-700">
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterChip({
  pressed,
  label,
  onClick,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-sm border px-2 py-1 text-[11px] ${
        pressed ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-500"
      }`}
    >
      {label}
    </button>
  );
}

function NodeInspector({
  label,
  entityType,
  entityId,
  subtitle,
  inspectionHeadline,
  connectionCount,
  sections,
  expanding,
  expandError,
  onExpand,
  onOpen,
}: {
  label: string;
  entityType: GraphNodeType;
  entityId: string;
  subtitle: string | null;
  inspectionHeadline: string | null;
  connectionCount: number;
  sections: Array<{ title: string; items: Array<{ label: string; detail: string | null; nodeId: string | null }> }>;
  expanding: boolean;
  expandError: string | null;
  onExpand: () => void;
  onOpen: (nodeId: string) => void;
}) {
  const typeLabel =
    entityType === "PERSON" ? "Person" : entityType === "COMPANY" ? "Company" : entityType === "PROPERTY" ? "Property" : "Deal";
  const base = entityType === "PERSON" ? "people" : entityType === "COMPANY" ? "companies" : entityType === "PROPERTY" ? "properties" : "deals";
  return (
    <div className="px-4 py-4">
      <p className="text-[10px] text-zinc-500">{typeLabel}</p>
      <h2 className="mt-0.5 text-base font-semibold text-zinc-950">{label}</h2>
      {(inspectionHeadline || subtitle) && (
        <p className="mt-0.5 text-xs text-zinc-600">{inspectionHeadline || subtitle}</p>
      )}
      <p className="mt-3 text-xs text-zinc-700">
        Connections <span className="font-medium text-zinc-950">{connectionCount}</span>
      </p>
      <a href={`/${base}/${entityId}`} className="mt-3 inline-block text-xs font-medium text-zinc-900 underline">
        Open intelligence record
      </a>
      <button
        type="button"
        className="mt-3 rounded-sm border border-zinc-900 px-2.5 py-1 text-xs text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
        onClick={onExpand}
        disabled={expanding}
      >
        {expanding ? "Expanding…" : "Expand connections"}
      </button>
      {expandError && <p className="mt-2 text-xs text-red-700">{expandError}</p>}
      <div className="mt-5 space-y-4">
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-xs font-medium text-zinc-500">{section.title}</h3>
            <ul className="mt-1 space-y-1">
              {section.items.map((item) => (
                <li key={`${section.title}-${item.nodeId}-${item.label}`}>
                  {item.nodeId ? (
                    <button type="button" className="text-left text-sm text-zinc-900 underline" onClick={() => onOpen(item.nodeId!)}>
                      {item.label}
                    </button>
                  ) : (
                    <span className="text-sm text-zinc-900">{item.label}</span>
                  )}
                  {item.detail && <span className="ml-1 text-xs text-zinc-500">{item.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {sections.length === 0 && <p className="text-xs text-zinc-500">No confirmed connections in the loaded map.</p>}
      </div>
    </div>
  );
}

function EdgeInspector({
  edge,
  source,
  target,
}: {
  edge: GraphEdge;
  source: { label: string } | null;
  target: { label: string } | null;
}) {
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (edge.canonicalAssertionType === "Employment") params.set("employmentId", edge.canonicalAssertionId);
    if (edge.canonicalAssertionType === "PropertyStake") params.set("propertyStakeId", edge.canonicalAssertionId);
    if (edge.canonicalAssertionType === "DealParticipation") params.set("dealParticipationId", edge.canonicalAssertionId);
    if (edge.canonicalAssertionType === "DealProperty") params.set("dealId", edge.canonicalAssertionId);
    fetch(`/api/evidence?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return (await response.json()) as EvidenceView;
      })
      .then((view) => {
        if (!cancelled) setEvidence(view);
      })
      .catch(() => {
        if (!cancelled) setError("Evidence could not be read.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [edge.id, edge.canonicalAssertionId, edge.canonicalAssertionType]);

  return (
    <div className="px-4 py-4">
      <p className="text-[10px] text-zinc-500">Why DealWatch believes this</p>
      <h2 className="mt-1 text-sm font-semibold text-zinc-950">
        {source?.label ?? "Unknown"}
        <span className="mx-1 font-normal text-zinc-500">{edge.label}</span>
        {target?.label ?? "Unknown"}
      </h2>
      <p className="mt-3 text-xs text-zinc-700">
        Canonical assertion
        <span className="mt-0.5 block font-medium text-zinc-950">
          {assertionNoun(edge.canonicalAssertionType)} {edge.canonicalAssertionId}
        </span>
      </p>
      <StrengthBlock edge={edge} />
      {edge.supportCount === 0 && <p className="mt-2 text-xs text-zinc-600">{NO_DOCUMENTARY_SUPPORT}</p>}
      {loading && <p className="mt-3 text-xs text-zinc-500">Reading evidence…</p>}
      {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
      {evidence && evidence.supportCount > 0 && (
        <div className="mt-3">
          <EvidencePanel evidence={evidence} embedded />
        </div>
      )}
    </div>
  );
}
