import { normalizeSurfaceForm } from "@/lib/entities/normalize";
import type { GraphDb } from "@/lib/entities/workspace";
import type { CanonicalSearchHit, CanonicalSearchResult } from "./path-types";
import { graphNodeId, type GraphNodeType } from "./types";

const SEARCH_LIMIT = 20;

interface RankedHit extends CanonicalSearchHit {
  rank: number;
}

function dealLabel(deal: { name: string; company: string; property: string }, propertyName: string | null): string {
  const place = propertyName || deal.property;
  return deal.company && place ? `${deal.company} — ${place}` : deal.name;
}

function rankOf(label: string, needle: string, matchField: CanonicalSearchHit["matchField"]): number {
  const normalized = normalizeSurfaceForm(label);
  if (normalized === needle) return 0;
  if (normalized.startsWith(needle)) return 1;
  if (matchField === "name") return 2;
  if (matchField === "alias") return 3;
  if (matchField === "address") return 4;
  return 5;
}

function includes(value: string | null | undefined, needle: string): boolean {
  if (!value) return false;
  return normalizeSurfaceForm(value).includes(needle);
}

function pushHit(hits: RankedHit[], hit: Omit<RankedHit, "rank"> & { label: string }, needle: string) {
  if (hits.some((existing) => existing.nodeId === hit.nodeId)) return;
  hits.push({ ...hit, rank: rankOf(hit.label, needle, hit.matchField) });
}

/**
 * Confirmed canonical entities in one workspace.
 * Entity observations are never results. There is no session auth yet, so the
 * route resolves the workspace from the default workspace or from a root
 * entity. This function does not accept a client-supplied workspace id.
 */
export async function searchCanonicalEntities(
  db: GraphDb,
  input: { workspaceId: string; q: string; limit?: number }
): Promise<CanonicalSearchHit[]> {
  const needle = normalizeSurfaceForm(input.q);
  if (needle.length < 2) return [];
  const workspaceId = input.workspaceId;
  const [people, companies, properties, deals, workspace] = await Promise.all([
    db.person.findMany({
      where: { workspaceId, status: "ACTIVE", mergedIntoPersonId: null },
      select: {
        id: true,
        canonicalName: true,
        primaryTitle: true,
        aliases: { select: { alias: true } },
      },
    }),
    db.company.findMany({
      where: { workspaceId, status: "ACTIVE", mergedIntoCompanyId: null },
      select: {
        id: true,
        canonicalName: true,
        legalName: true,
        aliases: { select: { alias: true } },
      },
    }),
    db.property.findMany({
      where: { workspaceId, status: "ACTIVE", mergedIntoPropertyId: null },
      select: {
        id: true,
        canonicalName: true,
        addressLine1: true,
        city: true,
        region: true,
        aliases: { select: { alias: true } },
      },
    }),
    db.deal.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        company: true,
        property: true,
        stage: true,
        canonicalProperty: { select: { canonicalName: true, workspaceId: true } },
      },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    }),
  ]);
  if (!workspace) return [];

  const hits: RankedHit[] = [];
  for (const person of people) {
    const alias = person.aliases.find((row) => includes(row.alias, needle));
    if (!includes(person.canonicalName, needle) && !alias) continue;
    pushHit(
      hits,
      {
        entityType: "PERSON",
        entityId: person.id,
        nodeId: graphNodeId("PERSON", person.id),
        label: person.canonicalName,
        subtitle: alias && !includes(person.canonicalName, needle) ? `Alias · ${alias.alias}` : person.primaryTitle,
        matchField: includes(person.canonicalName, needle) ? "name" : "alias",
      },
      needle
    );
  }
  for (const company of companies) {
    const alias = company.aliases.find((row) => includes(row.alias, needle));
    const nameHit = includes(company.canonicalName, needle) || includes(company.legalName, needle);
    if (!nameHit && !alias) continue;
    pushHit(
      hits,
      {
        entityType: "COMPANY",
        entityId: company.id,
        nodeId: graphNodeId("COMPANY", company.id),
        label: company.canonicalName,
        subtitle: alias && !nameHit ? `Alias · ${alias.alias}` : null,
        matchField: nameHit ? "name" : "alias",
      },
      needle
    );
  }
  for (const property of properties) {
    const alias = property.aliases.find((row) => includes(row.alias, needle));
    const address = [property.addressLine1, property.city, property.region].filter(Boolean).join(", ");
    const nameHit = includes(property.canonicalName, needle);
    const addressHit = includes(address, needle) || includes(property.addressLine1, needle);
    if (!nameHit && !addressHit && !alias) continue;
    const subtitle = [property.city, property.region].filter(Boolean).join(", ") || null;
    pushHit(
      hits,
      {
        entityType: "PROPERTY",
        entityId: property.id,
        nodeId: graphNodeId("PROPERTY", property.id),
        label: property.canonicalName,
        subtitle: alias && !nameHit && !addressHit ? `Alias · ${alias.alias}` : subtitle,
        matchField: nameHit ? "name" : alias && !addressHit ? "alias" : "address",
      },
      needle
    );
  }
  for (const deal of deals) {
    const propertyName =
      deal.canonicalProperty && deal.canonicalProperty.workspaceId === workspaceId
        ? deal.canonicalProperty.canonicalName
        : null;
    const label = dealLabel(deal, propertyName);
    const matched =
      includes(label, needle) ||
      includes(deal.name, needle) ||
      includes(deal.company, needle) ||
      includes(deal.property, needle) ||
      includes(propertyName, needle);
    if (!matched) continue;
    pushHit(
      hits,
      {
        entityType: "DEAL",
        entityId: deal.id,
        nodeId: graphNodeId("DEAL", deal.id),
        label,
        subtitle: deal.stage || null,
        matchField: "deal_label",
      },
      needle
    );
  }

  const typeOrder: Record<GraphNodeType, number> = { PERSON: 0, COMPANY: 1, PROPERTY: 2, DEAL: 3 };
  hits.sort((a, b) => a.rank - b.rank || typeOrder[a.entityType] - typeOrder[b.entityType] || a.label.localeCompare(b.label));
  return hits.slice(0, input.limit ?? SEARCH_LIMIT).map((hit) => ({
    entityType: hit.entityType,
    entityId: hit.entityId,
    nodeId: hit.nodeId,
    label: hit.label,
    subtitle: hit.subtitle,
    matchField: hit.matchField,
  }));
}

export async function workspaceIdForEntity(
  db: GraphDb,
  entityType: GraphNodeType,
  entityId: string
): Promise<string | null> {
  if (entityType === "PERSON") {
    const row = await db.person.findFirst({ where: { id: entityId }, select: { workspaceId: true } });
    return row?.workspaceId ?? null;
  }
  if (entityType === "COMPANY") {
    const row = await db.company.findFirst({ where: { id: entityId }, select: { workspaceId: true } });
    return row?.workspaceId ?? null;
  }
  if (entityType === "PROPERTY") {
    const row = await db.property.findFirst({ where: { id: entityId }, select: { workspaceId: true } });
    return row?.workspaceId ?? null;
  }
  const row = await db.deal.findFirst({ where: { id: entityId }, select: { workspaceId: true } });
  return row?.workspaceId ?? null;
}

export async function searchWorkspaceContext(
  db: GraphDb,
  workspaceId: string
): Promise<Pick<CanonicalSearchResult, "firmCompanyId" | "firmLabel">> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      firmCompanyId: true,
      firmCompany: {
        select: { canonicalName: true, workspaceId: true, status: true, mergedIntoCompanyId: true },
      },
    },
  });
  const firm = workspace?.firmCompany;
  if (
    !workspace?.firmCompanyId ||
    !firm ||
    firm.workspaceId !== workspaceId ||
    firm.status !== "ACTIVE" ||
    firm.mergedIntoCompanyId
  ) {
    return { firmCompanyId: null, firmLabel: null };
  }
  return { firmCompanyId: workspace.firmCompanyId, firmLabel: firm.canonicalName };
}
