import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { ConnectionMap } from "@/components/connections/connection-map";
import { prisma } from "@/lib/db";
import { getConnectionGraph } from "@/lib/graph/service";

export const dynamic = "force-dynamic";

export default async function DealConnectionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id } });
  if (!deal) notFound();
  const graph = await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 2 });
  if (!graph) notFound();
  const workspace = await prisma.workspace.findUnique({
    where: { id: graph.metadata.workspaceId },
    select: {
      firmCompanyId: true,
      firmCompany: {
        select: { canonicalName: true, workspaceId: true, status: true, mergedIntoCompanyId: true },
      },
    },
  });
  const firm =
    workspace?.firmCompany &&
    workspace.firmCompanyId &&
    workspace.firmCompany.workspaceId === graph.metadata.workspaceId &&
    workspace.firmCompany.status === "ACTIVE" &&
    !workspace.firmCompany.mergedIntoCompanyId
      ? { id: workspace.firmCompanyId, label: workspace.firmCompany.canonicalName }
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <DealHeader
        dealId={deal.id}
        activeSection="connections"
        name={deal.name}
        company={deal.company}
        property={deal.property}
        propertyHref={deal.propertyId ? `/properties/${deal.propertyId}` : null}
        stage={deal.stage}
        status={deal.status}
        estimatedValue={deal.estimatedValue}
        createdAt={deal.createdAt}
      />
      <main className="min-h-0 flex-1">
        <ConnectionMap initialGraph={graph} firmCompanyId={firm?.id ?? null} firmLabel={firm?.label ?? null} />
      </main>
    </div>
  );
}
