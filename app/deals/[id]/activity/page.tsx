import { notFound } from "next/navigation";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { DealHeader } from "@/components/deals/deal-header";
import { Nav } from "@/components/nav";
import { getActivityPage } from "@/lib/activity/service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DealActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, activity] = await Promise.all([
    prisma.deal.findUnique({ where: { id }, include: { canonicalProperty: true } }),
    getActivityPage(prisma, { rootType: "DEAL", rootId: id, limit: 25 }),
  ]);
  if (!deal || !activity) notFound();
  return (
    <div className="min-h-screen">
      <Nav />
      <DealHeader dealId={deal.id} activeSection="activity" name={deal.name} company={deal.company} property={deal.property} propertyHref={deal.canonicalProperty ? `/properties/${deal.canonicalProperty.id}` : null} stage={deal.stage} status={deal.status} estimatedValue={deal.estimatedValue} createdAt={deal.createdAt} />
      <main className="mx-auto max-w-5xl px-6 py-6"><ActivityTimeline initialPage={activity} rootType="DEAL" title="Deal activity / history" /></main>
    </div>
  );
}
