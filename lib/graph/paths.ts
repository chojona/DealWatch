import type { GraphDb } from "@/lib/entities/workspace";
import { factForRelationship, explainConnectionFacts, type PathFact } from "./explain";
import type { AssertionStrength, ConnectionPath, ConnectionPathEdge, ConnectionPathResult } from "./path-types";
import { GraphRequestError } from "./query";
import { relationshipLabel } from "./labels";
import {
  scoreConnectionPath,
  scoreEdgeStrength,
  pathStrengthSummary,
  type EdgeStrength,
} from "./strength";
import {
  graphNodeId,
  type CanonicalAssertionType,
  type GraphNode,
  type GraphNodeType,
} from "./types";

const SUPPORT_SELECT = {
  documentId: true,
  messageId: true,
  dealId: true,
  contextDealId: true,
  createdAt: true,
  provenanceStatus: true,
} as const;

type SupportObservation = {
  documentId: string | null;
  messageId: string | null;
  dealId: string | null;
  contextDealId: string | null;
  createdAt: Date;
  provenanceStatus: string | null;
};

interface MeasuredEdge {
  id: string;
  sourceKey: string;
  targetKey: string;
  relationshipType: string;
  label: string;
  canonicalAssertionType: CanonicalAssertionType;
  canonicalAssertionId: string;
  supportCount: number;
  strength: EdgeStrength;
}

interface EndpointSets {
  personIds: string[];
  companyIds: string[];
  propertyIds: string[];
  dealIds: string[];
}

function emptySets(): EndpointSets {
  return { personIds: [], companyIds: [], propertyIds: [], dealIds: [] };
}

function addEndpoint(sets: EndpointSets, key: string) {
  const [type, id] = key.split(":") as [string, string];
  if (!id) return;
  if (type === "person") sets.personIds.push(id);
  else if (type === "company") sets.companyIds.push(id);
  else if (type === "property") sets.propertyIds.push(id);
  else if (type === "deal") sets.dealIds.push(id);
}

function measureSupports(input: {
  supports: SupportObservation[];
  assertionSource: "OBSERVATION" | "MANUAL";
  open: boolean;
  baseDealId?: string | null;
  now: Date;
}): EdgeStrength {
  const documents = new Set<string>();
  const messages = new Set<string>();
  const deals = new Set<string>();
  if (input.baseDealId) deals.add(input.baseDealId);
  let newest: Date | null = null;
  let exact = false;
  for (const row of input.supports) {
    if (row.documentId) documents.add(row.documentId);
    if (row.messageId) messages.add(row.messageId);
    const dealId = row.dealId ?? row.contextDealId;
    if (dealId) deals.add(dealId);
    if (!newest || row.createdAt > newest) newest = row.createdAt;
    if (row.provenanceStatus === "EXACT") exact = true;
  }
  return scoreEdgeStrength({
    observationCount: input.supports.length,
    distinctDocumentCount: documents.size,
    distinctMessageCount: messages.size,
    sharedDealCount: deals.size,
    newestEvidenceAt: newest,
    open: input.open,
    assertionSource: input.assertionSource,
    hasExactProvenance: exact,
    now: input.now,
  });
}

function isOpen(validTo: Date | null, now: Date): boolean {
  return validTo == null || validTo.getTime() >= now.getTime();
}

function edge(input: {
  id: string;
  sourceKey: string;
  targetKey: string;
  relationshipType: string;
  customLabel?: string | null;
  canonicalAssertionType: CanonicalAssertionType;
  canonicalAssertionId: string;
  strength: EdgeStrength;
}): MeasuredEdge | null {
  if (input.sourceKey === input.targetKey) return null;
  return {
    id: input.id,
    sourceKey: input.sourceKey,
    targetKey: input.targetKey,
    relationshipType: input.relationshipType,
    label: relationshipLabel(input.relationshipType, input.customLabel),
    canonicalAssertionType: input.canonicalAssertionType,
    canonicalAssertionId: input.canonicalAssertionId,
    supportCount: input.strength.observationCount,
    strength: input.strength,
  };
}

/**
 * Canonical assertions that touch the given entities. Observations are not edges.
 * Reads only. Depth and the caller bound how many entities are requested.
 */
async function loadTouching(
  db: GraphDb,
  workspaceId: string,
  endpoints: EndpointSets,
  now: Date
): Promise<MeasuredEdge[]> {
  const { personIds, companyIds, propertyIds, dealIds } = endpoints;
  const employmentOr = [
    ...(personIds.length ? [{ personId: { in: personIds } }] : []),
    ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
  ];
  const stakeOr = [
    ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
    ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : []),
  ];
  const participationOr = [
    ...(dealIds.length ? [{ dealId: { in: dealIds } }] : []),
    ...(personIds.length ? [{ personId: { in: personIds } }] : []),
    ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
    ...(companyIds.length ? [{ representsCompanyId: { in: companyIds } }] : []),
  ];

  const [employments, stakes, participations, dealsById, dealsByProperty] = await Promise.all([
    employmentOr.length
      ? db.employment.findMany({
          where: { workspaceId, status: "ASSERTED", OR: employmentOr },
          include: { supports: { include: { relationshipObservation: { select: SUPPORT_SELECT } } } },
        })
      : [],
    stakeOr.length
      ? db.propertyStake.findMany({
          where: { workspaceId, status: "ASSERTED", OR: stakeOr },
          include: { supports: { include: { relationshipObservation: { select: SUPPORT_SELECT } } } },
        })
      : [],
    participationOr.length
      ? db.dealParticipation.findMany({
          where: { workspaceId, status: "ASSERTED", OR: participationOr },
          include: { supports: { include: { relationshipObservation: { select: SUPPORT_SELECT } } } },
        })
      : [],
    dealIds.length
      ? db.deal.findMany({
          where: { workspaceId, id: { in: dealIds }, propertyId: { not: null } },
          select: { id: true, propertyId: true, workspaceId: true },
        })
      : [],
    propertyIds.length
      ? db.deal.findMany({
          where: { workspaceId, propertyId: { in: propertyIds } },
          select: { id: true, propertyId: true, workspaceId: true },
        })
      : [],
  ]);

  const linkedDeals = new Map<string, { id: string; propertyId: string }>();
  for (const deal of [...dealsById, ...dealsByProperty]) {
    if (deal.propertyId && deal.workspaceId === workspaceId) linkedDeals.set(deal.id, { id: deal.id, propertyId: deal.propertyId });
  }
  const linkedIds = [...linkedDeals.keys()];
  const promotions = linkedIds.length
    ? await db.relationshipPromotion.findMany({
        where: { workspaceId, decision: "APPROVED", linkedDealId: { in: linkedIds } },
        select: { linkedDealId: true, relationshipObservation: { select: SUPPORT_SELECT } },
      })
    : [];
  const promotionByDeal = new Map<string, SupportObservation[]>();
  for (const promotion of promotions) {
    if (!promotion.linkedDealId) continue;
    const list = promotionByDeal.get(promotion.linkedDealId) ?? [];
    list.push(promotion.relationshipObservation);
    promotionByDeal.set(promotion.linkedDealId, list);
  }

  const edges: MeasuredEdge[] = [];
  const push = (row: MeasuredEdge | null) => {
    if (row) edges.push(row);
  };

  for (const row of employments) {
    if (row.workspaceId !== workspaceId) continue;
    const strength = measureSupports({
      supports: row.supports.map((support) => support.relationshipObservation),
      assertionSource: row.assertionSource,
      open: isOpen(row.validTo, now),
      now,
    });
    push(
      edge({
        id: `employment:${row.id}`,
        sourceKey: graphNodeId("PERSON", row.personId),
        targetKey: graphNodeId("COMPANY", row.companyId),
        relationshipType: "WORKS_AT",
        canonicalAssertionType: "Employment",
        canonicalAssertionId: row.id,
        strength,
      })
    );
  }

  for (const row of stakes) {
    if (row.workspaceId !== workspaceId) continue;
    const strength = measureSupports({
      supports: row.supports.map((support) => support.relationshipObservation),
      assertionSource: row.assertionSource,
      open: isOpen(row.validTo, now),
      now,
    });
    push(
      edge({
        id: `stake:${row.id}`,
        sourceKey: graphNodeId("COMPANY", row.companyId),
        targetKey: graphNodeId("PROPERTY", row.propertyId),
        relationshipType: row.predicate,
        canonicalAssertionType: "PropertyStake",
        canonicalAssertionId: row.id,
        strength,
      })
    );
  }

  for (const row of participations) {
    if (row.workspaceId !== workspaceId) continue;
    const actorType: GraphNodeType | null = row.personId ? "PERSON" : row.companyId ? "COMPANY" : null;
    const actorId = row.personId ?? row.companyId;
    if (!actorType || !actorId) continue;
    const strength = measureSupports({
      supports: row.supports.map((support) => support.relationshipObservation),
      assertionSource: row.assertionSource,
      open: isOpen(row.validTo, now),
      baseDealId: row.dealId,
      now,
    });
    push(
      edge({
        id: `participation:${row.id}`,
        sourceKey: graphNodeId(actorType, actorId),
        targetKey: graphNodeId("DEAL", row.dealId),
        relationshipType: row.role,
        customLabel: row.roleLabel,
        canonicalAssertionType: "DealParticipation",
        canonicalAssertionId: row.id,
        strength,
      })
    );
    if (row.representsCompanyId) {
      push(
        edge({
          id: `participation:${row.id}:represents`,
          sourceKey: graphNodeId(actorType, actorId),
          targetKey: graphNodeId("COMPANY", row.representsCompanyId),
          relationshipType: "REPRESENTS_ON_DEAL",
          canonicalAssertionType: "DealParticipation",
          canonicalAssertionId: row.id,
          strength,
        })
      );
    }
  }

  for (const deal of linkedDeals.values()) {
    const supports = promotionByDeal.get(deal.id) ?? [];
    const strength = measureSupports({
      supports,
      assertionSource: supports.length ? "OBSERVATION" : "MANUAL",
      open: true,
      baseDealId: deal.id,
      now,
    });
    push(
      edge({
        id: `deal-property:${deal.id}`,
        sourceKey: graphNodeId("DEAL", deal.id),
        targetKey: graphNodeId("PROPERTY", deal.propertyId),
        relationshipType: "CONCERNS_PROPERTY",
        canonicalAssertionType: "DealProperty",
        canonicalAssertionId: deal.id,
        strength,
      })
    );
  }

  return edges;
}

function betterEdge(candidate: MeasuredEdge, current: MeasuredEdge): boolean {
  if (candidate.strength.strengthScore !== current.strength.strengthScore) {
    return candidate.strength.strengthScore > current.strength.strengthScore;
  }
  if (candidate.supportCount !== current.supportCount) return candidate.supportCount > current.supportCount;
  return candidate.id < current.id;
}

function neighborsOf(edges: MeasuredEdge[], fromKey: string): MeasuredEdge[] {
  const best = new Map<string, MeasuredEdge>();
  for (const row of edges) {
    const other = row.sourceKey === fromKey ? row.targetKey : row.sourceKey;
    if (other === fromKey) continue;
    const current = best.get(other);
    if (!current || betterEdge(row, current)) best.set(other, row);
  }
  return [...best.values()];
}

async function loadNodes(db: GraphDb, workspaceId: string, keys: string[]): Promise<Map<string, GraphNode>> {
  const sets = emptySets();
  for (const key of keys) addEndpoint(sets, key);
  const [people, companies, properties, deals] = await Promise.all([
    sets.personIds.length
      ? db.person.findMany({
          where: { workspaceId, id: { in: sets.personIds } },
          select: { id: true, canonicalName: true, primaryTitle: true },
        })
      : [],
    sets.companyIds.length
      ? db.company.findMany({
          where: { workspaceId, id: { in: sets.companyIds } },
          select: { id: true, canonicalName: true },
        })
      : [],
    sets.propertyIds.length
      ? db.property.findMany({
          where: { workspaceId, id: { in: sets.propertyIds } },
          select: { id: true, canonicalName: true, addressLine1: true, city: true, region: true },
        })
      : [],
    sets.dealIds.length
      ? db.deal.findMany({
          where: { workspaceId, id: { in: sets.dealIds } },
          select: {
            id: true,
            name: true,
            company: true,
            property: true,
            stage: true,
            canonicalProperty: { select: { canonicalName: true, workspaceId: true } },
          },
        })
      : [],
  ]);
  const nodes = new Map<string, GraphNode>();
  for (const person of people) {
    const id = graphNodeId("PERSON", person.id);
    nodes.set(id, {
      id,
      entityType: "PERSON",
      entityId: person.id,
      label: person.canonicalName,
      subtitle: person.primaryTitle,
      metadata: { primaryTitle: person.primaryTitle },
    });
  }
  for (const company of companies) {
    const id = graphNodeId("COMPANY", company.id);
    nodes.set(id, {
      id,
      entityType: "COMPANY",
      entityId: company.id,
      label: company.canonicalName,
      subtitle: null,
      metadata: {},
    });
  }
  for (const property of properties) {
    const id = graphNodeId("PROPERTY", property.id);
    nodes.set(id, {
      id,
      entityType: "PROPERTY",
      entityId: property.id,
      label: property.canonicalName,
      subtitle: [property.city, property.region].filter(Boolean).join(", ") || null,
      metadata: { city: property.city, region: property.region, addressLine1: property.addressLine1 },
    });
  }
  for (const deal of deals) {
    const propertyName =
      deal.canonicalProperty && deal.canonicalProperty.workspaceId === workspaceId
        ? deal.canonicalProperty.canonicalName
        : null;
    const place = propertyName || deal.property;
    const id = graphNodeId("DEAL", deal.id);
    nodes.set(id, {
      id,
      entityType: "DEAL",
      entityId: deal.id,
      label: deal.company && place ? `${deal.company} — ${place}` : deal.name,
      subtitle: null,
      metadata: { stage: deal.stage },
    });
  }
  return nodes;
}

async function locate(
  db: GraphDb,
  entityType: GraphNodeType,
  entityId: string
): Promise<{ workspaceId: string; label: string } | null> {
  if (entityType === "PERSON") {
    const row = await db.person.findFirst({
      where: { id: entityId },
      select: { workspaceId: true, canonicalName: true },
    });
    return row ? { workspaceId: row.workspaceId, label: row.canonicalName } : null;
  }
  if (entityType === "COMPANY") {
    const row = await db.company.findFirst({
      where: { id: entityId },
      select: { workspaceId: true, canonicalName: true },
    });
    return row ? { workspaceId: row.workspaceId, label: row.canonicalName } : null;
  }
  if (entityType === "PROPERTY") {
    const row = await db.property.findFirst({
      where: { id: entityId },
      select: { workspaceId: true, canonicalName: true },
    });
    return row ? { workspaceId: row.workspaceId, label: row.canonicalName } : null;
  }
  const row = await db.deal.findFirst({
    where: { id: entityId },
    select: { workspaceId: true, name: true, company: true, property: true },
  });
  if (!row) return null;
  const label = row.company && row.property ? `${row.company} — ${row.property}` : row.name;
  return { workspaceId: row.workspaceId, label };
}

function toPathEdge(row: MeasuredEdge): ConnectionPathEdge {
  return {
    id: row.id,
    source: row.sourceKey,
    target: row.targetKey,
    relationshipType: row.relationshipType,
    label: row.label,
    canonicalAssertionType: row.canonicalAssertionType,
    canonicalAssertionId: row.canonicalAssertionId,
    supportCount: row.supportCount,
    strengthScore: row.strength.strengthScore,
    strengthLabel: row.strength.strengthLabel,
    strengthReasons: row.strength.strengthReasons,
    recency: row.strength.recency,
  };
}

/**
 * Bounded breadth-first search over canonical assertions.
 * Stops after the first depth that has produced 3 paths, or at maxDepth.
 * Does not revisit a node on the same path. Parallel edges between the same
 * pair collapse to the stronger edge so trivial duplicates are not returned.
 */
export async function findConnectionPaths(
  db: GraphDb,
  input: {
    sourceType: GraphNodeType;
    sourceId: string;
    targetType: GraphNodeType;
    targetId: string;
    maxDepth: number;
    now?: Date;
  }
): Promise<ConnectionPathResult> {
  if (input.maxDepth < 1 || input.maxDepth > 4 || !Number.isInteger(input.maxDepth)) {
    throw new GraphRequestError("maxDepth must be from 1 to 4", 400);
  }
  const source = await locate(db, input.sourceType, input.sourceId);
  const target = await locate(db, input.targetType, input.targetId);
  if (!source || !target) throw new GraphRequestError("Entity not found", 404);
  if (source.workspaceId !== target.workspaceId) {
    throw new GraphRequestError("Cross-workspace paths are not available", 400);
  }
  const workspaceId = source.workspaceId;
  const now = input.now ?? new Date();
  const sourceKey = graphNodeId(input.sourceType, input.sourceId);
  const targetKey = graphNodeId(input.targetType, input.targetId);
  const base = {
    workspaceId,
    source: { entityType: input.sourceType, entityId: input.sourceId, nodeId: sourceKey, label: source.label },
    target: { entityType: input.targetType, entityId: input.targetId, nodeId: targetKey, label: target.label },
    maxDepth: input.maxDepth,
  };
  if (sourceKey === targetKey) return { ...base, paths: [] };

  const cache = new Map<string, MeasuredEdge[]>();
  const byId = new Map<string, MeasuredEdge>();
  const loaded = new Set<string>();

  async function hydrate(keys: string[]) {
    const missing = [...new Set(keys)].filter((key) => !loaded.has(key));
    if (missing.length === 0) return;
    const sets = emptySets();
    for (const key of missing) addEndpoint(sets, key);
    const edges = await loadTouching(db, workspaceId, sets, now);
    for (const row of edges) byId.set(row.id, row);
    for (const key of missing) {
      cache.set(
        key,
        edges.filter((row) => row.sourceKey === key || row.targetKey === key)
      );
      loaded.add(key);
    }
  }

  interface Trail {
    key: string;
    keys: string[];
    edgeIds: string[];
  }

  let frontier: Trail[] = [{ key: sourceKey, keys: [sourceKey], edgeIds: [] }];
  const found: Trail[] = [];
  const signatures = new Set<string>();

  for (let depth = 1; depth <= input.maxDepth; depth += 1) {
    await hydrate(frontier.map((state) => state.key));
    const next: Trail[] = [];
    for (const state of frontier) {
      for (const row of neighborsOf(cache.get(state.key) ?? [], state.key)) {
        const other = row.sourceKey === state.key ? row.targetKey : row.sourceKey;
        if (state.keys.includes(other)) continue;
        const trail: Trail = { key: other, keys: [...state.keys, other], edgeIds: [...state.edgeIds, row.id] };
        if (other === targetKey) {
          const signature = trail.keys.join(">");
          if (signatures.has(signature)) continue;
          signatures.add(signature);
          found.push(trail);
        } else {
          next.push(trail);
        }
      }
    }
    if (found.length >= 3) break;
    frontier = next.slice(0, 300);
    if (frontier.length === 0) break;
  }

  const nodeKeys = new Set<string>([sourceKey, targetKey]);
  for (const trail of found) for (const key of trail.keys) nodeKeys.add(key);
  const nodes = await loadNodes(db, workspaceId, [...nodeKeys]);

  const paths: ConnectionPath[] = found.flatMap((trail) => {
    const edges = trail.edgeIds.map((id) => byId.get(id)).filter((row): row is MeasuredEdge => Boolean(row));
    if (edges.length !== trail.edgeIds.length) return [];
    const pathNodes = trail.keys.map((key) => nodes.get(key)).filter((node): node is GraphNode => Boolean(node));
    if (pathNodes.length !== trail.keys.length) return [];
    const facts: PathFact[] = edges.map((row) => {
      const sourceNode = nodes.get(row.sourceKey);
      const targetNode = nodes.get(row.targetKey);
      return factForRelationship({
        relationshipType: row.relationshipType,
        label: row.label,
        sourceLabel: sourceNode?.label ?? "Unknown",
        targetLabel: targetNode?.label ?? "Unknown",
        sourceType: sourceNode?.entityType ?? "DEAL",
        targetType: targetNode?.entityType ?? "DEAL",
      });
    });
    const pathEdges = edges.map(toPathEdge);
    return [
      {
        hops: pathEdges.length,
        pathScore: scoreConnectionPath(pathEdges),
        strengthLabel: pathStrengthSummary(pathEdges),
        explanation: explainConnectionFacts(facts),
        nodes: pathNodes,
        edges: pathEdges,
      },
    ];
  });

  paths.sort((a, b) => b.pathScore - a.pathScore || a.hops - b.hops || a.explanation.localeCompare(b.explanation));
  return { ...base, paths: paths.slice(0, 3) };
}

export async function getAssertionStrength(
  db: GraphDb,
  input: { assertionType: CanonicalAssertionType; assertionId: string; now?: Date }
): Promise<AssertionStrength | null> {
  const now = input.now ?? new Date();
  const sets = emptySets();
  if (input.assertionType === "Employment") {
    const row = await db.employment.findUnique({ where: { id: input.assertionId }, select: { personId: true, workspaceId: true } });
    if (!row) return null;
    sets.personIds.push(row.personId);
    const edges = await loadTouching(db, row.workspaceId, sets, now);
    const match = edges.find((item) => item.canonicalAssertionType === "Employment" && item.canonicalAssertionId === input.assertionId);
    return match ? { ...match.strength, canonicalAssertionType: "Employment", canonicalAssertionId: input.assertionId } : null;
  }
  if (input.assertionType === "PropertyStake") {
    const row = await db.propertyStake.findUnique({
      where: { id: input.assertionId },
      select: { companyId: true, workspaceId: true },
    });
    if (!row) return null;
    sets.companyIds.push(row.companyId);
    const edges = await loadTouching(db, row.workspaceId, sets, now);
    const match = edges.find((item) => item.id === `stake:${input.assertionId}`);
    return match ? { ...match.strength, canonicalAssertionType: "PropertyStake", canonicalAssertionId: input.assertionId } : null;
  }
  if (input.assertionType === "DealParticipation") {
    const row = await db.dealParticipation.findUnique({
      where: { id: input.assertionId },
      select: { dealId: true, workspaceId: true },
    });
    if (!row) return null;
    sets.dealIds.push(row.dealId);
    const edges = await loadTouching(db, row.workspaceId, sets, now);
    const match = edges.find((item) => item.id === `participation:${input.assertionId}`);
    return match
      ? { ...match.strength, canonicalAssertionType: "DealParticipation", canonicalAssertionId: input.assertionId }
      : null;
  }
  const deal = await db.deal.findUnique({
    where: { id: input.assertionId },
    select: { id: true, workspaceId: true, propertyId: true },
  });
  if (!deal?.propertyId) return null;
  sets.dealIds.push(deal.id);
  const edges = await loadTouching(db, deal.workspaceId, sets, now);
  const match = edges.find((item) => item.id === `deal-property:${deal.id}`);
  return match ? { ...match.strength, canonicalAssertionType: "DealProperty", canonicalAssertionId: deal.id } : null;
}
