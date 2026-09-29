import { notFound } from "next/navigation";
import { DealHeader } from "@/components/deals/deal-header";
import { DealBriefView } from "@/components/deals/deal-brief";
import { ErrorState } from "@/components/ui/error-state";
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
        <main className="page-frame page-reading">
          <ErrorState
            title="Invalid catch-up timestamp"
            description={`${parsed.error}. Use an offset-aware value such as 2026-09-29T12:00:00Z.`}
          />
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
      <main className="page-frame">
        <DealBriefView brief={brief} actionEvidence={actionEvidence?.items ?? []} />
      </main>
    </div>
  );
}
