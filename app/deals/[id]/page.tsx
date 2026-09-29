import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { DealBriefView } from "@/components/deals/deal-brief";
import { prisma } from "@/lib/db";
import { parseDealBriefQuery } from "@/lib/deals/brief/query";
import { getDealBrief } from "@/lib/deals/brief/service";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const dynamic = "force-dynamic";

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ since?: string | string[] }>;
}) {
  const { id } = await params;
  const requested = await searchParams;
  const briefSearch = new URLSearchParams();
  if (typeof requested.since === "string") briefSearch.set("since", requested.since);
  let query: { since?: Date } = {};
  try {
    query = parseDealBriefQuery(briefSearch);
  } catch {
    query = {};
  }
  const workspaceId = await messageRequestWorkspaceId(prisma);
  if (!workspaceId) notFound();
  const brief = await getDealBrief(prisma, id, { ...query, expectedWorkspaceId: workspaceId });
  if (!brief) notFound();

  return (
    <div className="min-h-screen">
      <Nav />
      <DealHeader
        dealId={brief.deal.id}
        activeSection="overview"
        name={brief.deal.name}
        company={brief.deal.company}
        property={brief.deal.property}
        propertyHref={brief.deal.propertyId ? `/properties/${brief.deal.propertyId}` : null}
        stage={brief.deal.stage}
        status={brief.deal.status}
        estimatedValue={brief.deal.estimatedValue}
        createdAt={new Date(brief.deal.createdAt)}
      />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <DealBriefView brief={brief} />
      </main>
    </div>
  );
}
