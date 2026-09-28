import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { DealKnowledgeView } from "@/components/knowledge/deal-knowledge";
import { prisma } from "@/lib/db";
import { getDealKnowledge } from "@/lib/promotion/service";

export const dynamic = "force-dynamic";

export default async function DealKnowledgePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id } });
  if (!deal) notFound();
  const knowledge = await getDealKnowledge(prisma, deal.id);
  if (!knowledge) notFound();

  return (
    <div className="min-h-screen">
      <Nav />
      <DealHeader
        dealId={deal.id}
        activeSection="knowledge"
        name={deal.name}
        company={deal.company}
        property={deal.property}
        propertyHref={deal.propertyId ? `/properties/${deal.propertyId}` : null}
        stage={deal.stage}
        status={deal.status}
        estimatedValue={deal.estimatedValue}
        createdAt={deal.createdAt}
      />
      <main className="mx-auto max-w-5xl px-6 py-6">
        <DealKnowledgeView knowledge={knowledge} />
      </main>
    </div>
  );
}
