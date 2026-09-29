import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { DealMessages } from "@/components/messages/deal-messages";
import { prisma } from "@/lib/db";
import { listDealMessages } from "@/lib/messages/list";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const dynamic = "force-dynamic";

export default async function DealMessagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = await messageRequestWorkspaceId(prisma);
  if (!workspaceId || !(await prisma.deal.findFirst({ where: { id, workspaceId }, select: { id: true } }))) notFound();
  const result = await listDealMessages(prisma, id);
  if (!result) notFound();
  return <div className="min-h-screen"><Nav/><DealHeader dealId={result.deal.id} activeSection="messages" name={result.deal.name} company={result.deal.company} property={result.deal.property} propertyHref={result.deal.propertyId ? `/properties/${result.deal.propertyId}` : null} stage={result.deal.stage} status={result.deal.status} estimatedValue={result.deal.estimatedValue} createdAt={result.deal.createdAt}/><main className="mx-auto max-w-5xl px-6 py-6"><DealMessages dealId={result.deal.id} items={result.items}/></main></div>;
}
