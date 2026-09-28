import { notFound } from "next/navigation";
import { EntityConnections } from "@/components/intelligence/entity-connections";
import { prisma } from "@/lib/db";
import { getConnectionGraph } from "@/lib/graph/service";
import { searchWorkspaceContext } from "@/lib/graph/search";
import { getCompanyIntelligence } from "@/lib/intelligence/service";

export const dynamic = "force-dynamic";

export default async function CompanyConnectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, graph] = await Promise.all([getCompanyIntelligence(prisma, id), getConnectionGraph(prisma, { rootType: "COMPANY", rootId: id, depth: 2 })]);
  if (!data || !graph) notFound();
  const firmContext = await searchWorkspaceContext(prisma, graph.metadata.workspaceId);
  const firm = firmContext.firmCompanyId && firmContext.firmLabel ? { id: firmContext.firmCompanyId, label: firmContext.firmLabel } : null;
  return <EntityConnections graph={graph} title={data.company.name} type="Company" backHref={`/companies/${id}`} firm={firm} />;
}
