import { notFound } from "next/navigation";
import { EntityConnections } from "@/components/intelligence/entity-connections";
import { prisma } from "@/lib/db";
import { getConnectionGraph } from "@/lib/graph/service";
import { searchWorkspaceContext } from "@/lib/graph/search";
import { getPersonIntelligence } from "@/lib/intelligence/service";

export const dynamic = "force-dynamic";

export default async function PersonConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, graph] = await Promise.all([getPersonIntelligence(prisma, id), getConnectionGraph(prisma, { rootType: "PERSON", rootId: id, depth: 2 })]);
  if (!data || !graph) notFound();
  const firmContext = await searchWorkspaceContext(prisma, graph.metadata.workspaceId);
  const firm = firmContext.firmCompanyId && firmContext.firmLabel ? { id: firmContext.firmCompanyId, label: firmContext.firmLabel } : null;
  return <EntityConnections graph={graph} title={data.person.name} type="Person" backHref={`/people/${id}`} firm={firm} />;
}
