import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { DealOverview } from "@/components/deals/deal-overview";
import { getDealIntelligence } from "@/lib/deals/intelligence/service";
import { intelligenceStatusLabel } from "@/lib/deals/intelligence/project";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const intelligence = await getDealIntelligence(prisma, id);
  if (!intelligence) notFound();

  return (
    <div className="min-h-screen">
      <Nav />
      <DealHeader
        dealId={intelligence.deal.id}
        activeSection="overview"
        name={intelligence.deal.name}
        company={intelligence.deal.company}
        property={intelligence.deal.property}
        propertyHref={intelligence.deal.propertyId ? `/properties/${intelligence.deal.propertyId}` : null}
        stage={intelligence.deal.stage}
        status={intelligence.deal.recordStatus}
        intelligenceStatus={intelligenceStatusLabel(intelligence.intelligenceStatus)}
        estimatedValue={intelligence.deal.estimatedValue}
        createdAt={new Date(intelligence.deal.createdAt)}
      />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <DealOverview intelligence={intelligence} />
      </main>
    </div>
  );
}
