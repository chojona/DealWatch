import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { DealBriefView } from "@/components/deals/deal-brief";
import { prisma } from "@/lib/db";
import { parseDealBriefPageQuery } from "@/lib/deals/brief/query";
import { getActionEvidenceReview } from "@/lib/deals/actions/evidenceReview";
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
  const parsed = parseDealBriefPageQuery(requested);
  if (parsed.error !== null) {
    return (
      <div className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-3xl px-6 py-10">
          <div className="rounded-sm border border-red-200 bg-red-50 px-5 py-4 text-red-900" role="alert">
            <h1 className="text-sm font-semibold">Invalid catch-up timestamp</h1>
            <p className="mt-1 text-sm text-red-800">{parsed.error}. Use an offset-aware value such as 2026-09-29T12:00:00Z.</p>
          </div>
        </main>
      </div>
    );
  }
  const query = parsed.query;
  const workspaceId = await messageRequestWorkspaceId(prisma);
  if (!workspaceId) notFound();
  const brief = await getDealBrief(prisma, id, { ...query, expectedWorkspaceId: workspaceId });
  if (!brief) notFound();
  const actionEvidence = await getActionEvidenceReview(prisma, id, { expectedWorkspaceId: workspaceId });

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
        <DealBriefView brief={brief} actionEvidence={actionEvidence?.items ?? []} />
      </main>
    </div>
  );
}
