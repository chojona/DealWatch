import type { GraphDb } from "@/lib/entities/workspace";
import { relationshipLabel } from "./labels";
import { assertGraphQuery } from "./query";
import {
  graphNodeId,
  type CanonicalAssertionType,
  type ConnectionGraph,
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
} from "./types";

const personSelect = {
  id: true,
  workspaceId: true,
  canonicalName: true,
  primaryTitle: true,
  status: true,
  mergedIntoPersonId: true,
} as const;

const companySelect = {
  id: true,
  workspaceId: true,
  canonicalName: true,
  status: true,
  mergedIntoCompanyId: true,
} as const;

const propertySelect = {
  id: true,
  workspaceId: true,
  canonicalName: true,
  addressLine1: true,
  city: true,
  region: true,
  status: true,
  mergedIntoPropertyId: true,
} as const;

const dealSelect = {
  id: true,
  workspaceId: true,
  name: true,
  company: true,
  property: true,
  propertyId: true,
  stage: true,
} as const;

type PersonRow = {
  id: string;
  workspaceId: string;
  canonicalName: string;
  primaryTitle: string | null;
};
type CompanyRow = { id: string; workspaceId: string; canonicalName: string };
type PropertyRow = {
  id: string;
  workspaceId: string;
  canonicalName: string;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
};
type DealRow = {
  id: string;
  workspaceId: string;
  name: string;
  company: string;
  property: string;
  propertyId: string | null;
  stage: string;
};

function personNode(person: PersonRow): GraphNode {
  return {
    id: graphNodeId("PERSON", person.id),
    entityType: "PERSON",
    entityId: person.id,
    label: person.canonicalName,
    subtitle: person.primaryTitle,
    metadata: { primaryTitle: person.primaryTitle },
  };
}

function companyNode(company: CompanyRow): GraphNode {
  return {
    id: graphNodeId("COMPANY", company.id),
    entityType: "COMPANY",
    entityId: company.id,
    label: company.canonicalName,
    subtitle: null,
    metadata: {},
  };
}

function propertyNode(property: PropertyRow): GraphNode {
  const subtitle = [property.city, property.region].filter(Boolean).join(", ") || null;
  return {
    id: graphNodeId("PROPERTY", property.id),
    entityType: "PROPERTY",
    entityId: property.id,
    label: property.canonicalName,
    subtitle,
    metadata: {
      city: property.city,
      region: property.region,
      addressLine1: property.addressLine1,
    },
  };
}

function dealNode(deal: DealRow, propertyName: string | null): GraphNode {
  const place = propertyName || deal.property;
  const label = deal.company && place ? `${deal.company} — ${place}` : deal.name;
  return {
    id: graphNodeId("DEAL", deal.id),
    entityType: "DEAL",
    entityId: deal.id,
    label,
    subtitle: null,
    metadata: { stage: deal.stage },
  };
}

function makeEdge(input: {
  id: string;
  source: string;
  target: string;
  relationshipType: string;
  customLabel?: string | null;
  canonicalAssertionType: CanonicalAssertionType;
  canonicalAssertionId: string;
  supportCount: number;
}): GraphEdge | null {
  if (input.source === input.target) return null;
  return {
    id: input.id,
    source: input.source,
    target: input.target,
    relationshipType: input.relationshipType,
    label: relationshipLabel(input.relationshipType, input.customLabel),
    canonicalAssertionType: input.canonicalAssertionType,
    canonicalAssertionId: input.canonicalAssertionId,
    supportCount: input.supportCount,
  };
}

async function loadRoot(
  db: GraphDb,
  rootType: GraphNodeType,
  rootId: string
): Promise<{ node: GraphNode; workspaceId: string } | null> {
  if (rootType === "PERSON") {
    const person = await db.person.findFirst({ where: { id: rootId, status: "ACTIVE", mergedIntoPersonId: null }, select: personSelect });
    if (!person) return null;
    return { node: personNode(person), workspaceId: person.workspaceId };
  }
  if (rootType === "COMPANY") {
    const company = await db.company.findFirst({ where: { id: rootId, status: "ACTIVE", mergedIntoCompanyId: null }, select: companySelect });
    if (!company) return null;
    return { node: companyNode(company), workspaceId: company.workspaceId };
  }
  if (rootType === "PROPERTY") {
    const property = await db.property.findFirst({ where: { id: rootId, status: "ACTIVE", mergedIntoPropertyId: null }, select: propertySelect });
    if (!property) return null;
    return { node: propertyNode(property), workspaceId: property.workspaceId };
  }
  const deal = await db.deal.findFirst({
    where: { id: rootId },
    select: { ...dealSelect, canonicalProperty: { select: propertySelect } },
  });
  if (!deal) return null;
  const property =
    deal.canonicalProperty && deal.canonicalProperty.workspaceId === deal.workspaceId && deal.canonicalProperty.status === "ACTIVE" && !deal.canonicalProperty.mergedIntoPropertyId
      ? deal.canonicalProperty
      : null;
  return {
    node: dealNode(deal, property?.canonicalName ?? null),
    workspaceId: deal.workspaceId,
  };
}

async function unresolvedObservationCount(db: GraphDb, workspaceId: string, dealId: string): Promise<number> {
  const [entities, relationships] = await Promise.all([
    db.entityObservation.count({
      where: {
        workspaceId,
        dealId,
        resolutionLinks: { none: { status: "ACCEPTED" } },
        dispositions: { none: { disposition: "REJECTED" } },
      },
    }),
    db.relationshipObservation.count({
      where: {
        workspaceId,
        OR: [{ dealId }, { contextDealId: dealId }],
        promotion: { is: null },
      },
    }),
  ]);
  return entities + relationships;
}

function idsOf(frontier: GraphNode[], entityType: GraphNodeType): string[] {
  return frontier.filter((node) => node.entityType === entityType).map((node) => node.entityId);
}

async function loadIncident(
  db: GraphDb,
  workspaceId: string,
  frontier: GraphNode[]
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const personIds = idsOf(frontier, "PERSON");
  const companyIds = idsOf(frontier, "COMPANY");
  const propertyIds = idsOf(frontier, "PROPERTY");
  const dealIds = idsOf(frontier, "DEAL");

  const employmentWhere =
    personIds.length || companyIds.length
      ? {
          workspaceId,
          status: "ASSERTED" as const,
          OR: [
            ...(personIds.length ? [{ personId: { in: personIds } }] : []),
            ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
          ],
        }
      : null;
  const stakeWhere =
    companyIds.length || propertyIds.length
      ? {
          workspaceId,
          status: "ASSERTED" as const,
          OR: [
            ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
            ...(propertyIds.length ? [{ propertyId: { in: propertyIds } }] : []),
          ],
        }
      : null;
  const participationWhere =
    dealIds.length || personIds.length || companyIds.length
      ? {
          workspaceId,
          status: "ASSERTED" as const,
          OR: [
            ...(dealIds.length ? [{ dealId: { in: dealIds } }] : []),
            ...(personIds.length ? [{ personId: { in: personIds } }] : []),
            ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
            ...(companyIds.length ? [{ representsCompanyId: { in: companyIds } }] : []),
          ],
        }
      : null;

  const [employments, stakes, participations, dealsById, dealsByProperty] = await Promise.all([
    employmentWhere
      ? db.employment.findMany({
          where: employmentWhere,
          include: { _count: { select: { supports: true } } },
        })
      : [],
    stakeWhere
      ? db.propertyStake.findMany({
          where: stakeWhere,
          include: { _count: { select: { supports: true } } },
        })
      : [],
    participationWhere
      ? db.dealParticipation.findMany({
          where: participationWhere,
          include: { _count: { select: { supports: true } } },
        })
      : [],
    dealIds.length
      ? db.deal.findMany({ where: { workspaceId, id: { in: dealIds } }, select: dealSelect })
      : [],
    propertyIds.length
      ? db.deal.findMany({
          where: { workspaceId, propertyId: { in: propertyIds } },
          select: dealSelect,
        })
      : [],
  ]);

  const deals = new Map<string, DealRow>();
  for (const deal of [...dealsById, ...dealsByProperty]) deals.set(deal.id, deal);

  const personIdSet = new Set<string>(personIds);
  const companyIdSet = new Set<string>(companyIds);
  const propertyIdSet = new Set<string>(propertyIds);
  const dealIdSet = new Set<string>(deals.keys());
  for (const row of employments) {
    personIdSet.add(row.personId);
    companyIdSet.add(row.companyId);
  }
  for (const row of stakes) {
    companyIdSet.add(row.companyId);
    propertyIdSet.add(row.propertyId);
  }
  for (const row of participations) {
    if (row.personId) personIdSet.add(row.personId);
    if (row.companyId) companyIdSet.add(row.companyId);
    if (row.representsCompanyId) companyIdSet.add(row.representsCompanyId);
    dealIdSet.add(row.dealId);
  }
  for (const deal of deals.values()) {
    if (deal.propertyId) propertyIdSet.add(deal.propertyId);
  }

  const linkedDealIds = [...deals.values()].filter((deal) => deal.propertyId).map((deal) => deal.id);
  const [people, companies, properties, promotionGroups, missingDeals] = await Promise.all([
    personIdSet.size
      ? db.person.findMany({
          where: { workspaceId, id: { in: [...personIdSet] }, status: "ACTIVE", mergedIntoPersonId: null },
          select: personSelect,
        })
      : [],
    companyIdSet.size
      ? db.company.findMany({
          where: { workspaceId, id: { in: [...companyIdSet] }, status: "ACTIVE", mergedIntoCompanyId: null },
          select: companySelect,
        })
      : [],
    propertyIdSet.size
      ? db.property.findMany({
          where: { workspaceId, id: { in: [...propertyIdSet] }, status: "ACTIVE", mergedIntoPropertyId: null },
          select: propertySelect,
        })
      : [],
    linkedDealIds.length
      ? db.relationshipPromotion.groupBy({
          by: ["linkedDealId"],
          where: {
            workspaceId,
            decision: "APPROVED",
            linkedDealId: { in: linkedDealIds },
          },
          _count: { _all: true },
        })
      : [],
    (() => {
      const missing = [...dealIdSet].filter((id) => !deals.has(id));
      return missing.length
        ? db.deal.findMany({ where: { workspaceId, id: { in: missing } }, select: dealSelect })
        : [];
    })(),
  ]);

  for (const deal of missingDeals) deals.set(deal.id, deal);

  const peopleById = new Map(people.map((row) => [row.id, row]));
  const companiesById = new Map(companies.map((row) => [row.id, row]));
  const propertiesById = new Map(properties.map((row) => [row.id, row]));
  const supportByDeal = new Map<string, number>();
  for (const group of promotionGroups) {
    if (group.linkedDealId) supportByDeal.set(group.linkedDealId, group._count._all);
  }

  const nodes = new Map<string, GraphNode>();
  const remember = (node: GraphNode | null) => {
    if (node) nodes.set(node.id, node);
    return node;
  };
  const personOf = (id: string | null) => {
    if (!id) return null;
    const row = peopleById.get(id);
    return row ? remember(personNode(row)) : null;
  };
  const companyOf = (id: string | null) => {
    if (!id) return null;
    const row = companiesById.get(id);
    return row ? remember(companyNode(row)) : null;
  };
  const propertyOf = (id: string | null) => {
    if (!id) return null;
    const row = propertiesById.get(id);
    return row ? remember(propertyNode(row)) : null;
  };
  const dealOf = (id: string) => {
    const row = deals.get(id);
    if (!row || row.workspaceId !== workspaceId) return null;
    const property = row.propertyId ? propertiesById.get(row.propertyId) : undefined;
    return remember(dealNode(row, property?.canonicalName ?? null));
  };

  const edges: GraphEdge[] = [];
  const push = (edge: GraphEdge | null) => {
    if (edge) edges.push(edge);
  };

  for (const row of employments) {
    if (row.workspaceId !== workspaceId) continue;
    const person = personOf(row.personId);
    const company = companyOf(row.companyId);
    if (!person || !company) continue;
    push(
      makeEdge({
        id: `employment:${row.id}`,
        source: person.id,
        target: company.id,
        relationshipType: "WORKS_AT",
        canonicalAssertionType: "Employment",
        canonicalAssertionId: row.id,
        supportCount: row._count.supports,
      })
    );
  }

  for (const row of stakes) {
    if (row.workspaceId !== workspaceId) continue;
    const company = companyOf(row.companyId);
    const property = propertyOf(row.propertyId);
    if (!company || !property) continue;
    push(
      makeEdge({
        id: `stake:${row.id}`,
        source: company.id,
        target: property.id,
        relationshipType: row.predicate,
        canonicalAssertionType: "PropertyStake",
        canonicalAssertionId: row.id,
        supportCount: row._count.supports,
      })
    );
  }

  for (const row of participations) {
    if (row.workspaceId !== workspaceId) continue;
    const actor = row.personId ? personOf(row.personId) : companyOf(row.companyId);
    const deal = dealOf(row.dealId);
    if (!actor || !deal) continue;
    push(
      makeEdge({
        id: `participation:${row.id}`,
        source: actor.id,
        target: deal.id,
        relationshipType: row.role,
        customLabel: row.roleLabel,
        canonicalAssertionType: "DealParticipation",
        canonicalAssertionId: row.id,
        supportCount: row._count.supports,
      })
    );
    if (row.representsCompanyId) {
      const principal = companyOf(row.representsCompanyId);
      if (principal) {
        push(
          makeEdge({
            id: `participation:${row.id}:represents`,
            source: actor.id,
            target: principal.id,
            relationshipType: "REPRESENTS_ON_DEAL",
            canonicalAssertionType: "DealParticipation",
            canonicalAssertionId: row.id,
            supportCount: row._count.supports,
          })
        );
      }
    }
  }

  for (const deal of deals.values()) {
    if (!deal.propertyId || deal.workspaceId !== workspaceId) continue;
    const dealNodeRow = dealOf(deal.id);
    const property = propertyOf(deal.propertyId);
    if (!dealNodeRow || !property) continue;
    push(
      makeEdge({
        id: `deal-property:${deal.id}`,
        source: dealNodeRow.id,
        target: property.id,
        relationshipType: "CONCERNS_PROPERTY",
        canonicalAssertionType: "DealProperty",
        canonicalAssertionId: deal.id,
        supportCount: supportByDeal.get(deal.id) ?? 0,
      })
    );
  }

  const frontierIds = new Set(frontier.map((node) => node.id));
  const kept = edges.filter((edge) => frontierIds.has(edge.source) || frontierIds.has(edge.target));
  const used = new Set<string>();
  for (const edge of kept) {
    used.add(edge.source);
    used.add(edge.target);
  }
  return {
    nodes: [...nodes.values()].filter((node) => used.has(node.id)),
    edges: kept,
  };
}

/**
 * Bounded canonical neighborhood. Observations are never edges.
 * Every hop is filtered by the root entity's workspace.
 */
export async function getConnectionGraph(
  db: GraphDb,
  input: { rootType: string; rootId: string; depth?: number }
): Promise<ConnectionGraph | null> {
  const query = assertGraphQuery({
    rootType: input.rootType,
    rootId: input.rootId,
    depth: input.depth ?? 1,
  });
  const root = await loadRoot(db, query.rootType, query.rootId);
  if (!root) return null;

  const nodes = new Map<string, GraphNode>([[root.node.id, root.node]]);
  const edges = new Map<string, GraphEdge>();
  const expanded = new Set<string>();
  let frontier = [root.node];

  for (let hop = 0; hop < query.depth; hop += 1) {
    const pending = frontier.filter((node) => !expanded.has(node.id));
    if (pending.length === 0) break;
    const discovered = await loadIncident(db, root.workspaceId, pending);
    const next: GraphNode[] = [];
    for (const edge of discovered.edges) {
      if (!edges.has(edge.id)) edges.set(edge.id, edge);
    }
    for (const node of discovered.nodes) {
      if (!nodes.has(node.id)) {
        nodes.set(node.id, node);
        next.push(node);
      }
    }
    for (const node of pending) expanded.add(node.id);
    frontier = next;
  }

  const unresolved =
    query.rootType === "DEAL"
      ? await unresolvedObservationCount(db, root.workspaceId, query.rootId)
      : null;

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    metadata: {
      rootType: query.rootType,
      rootId: query.rootId,
      nodeId: root.node.id,
      workspaceId: root.workspaceId,
      depth: query.depth,
      unresolvedObservationCount: unresolved,
      reviewHref: query.rootType === "DEAL" ? `/deals/${query.rootId}/knowledge` : null,
    },
  };
}
