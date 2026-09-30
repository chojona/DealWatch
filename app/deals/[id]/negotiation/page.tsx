import { notFound } from "next/navigation";
import { DealHeader } from "@/components/deals/deal-header";
import { AddRoundForm } from "@/components/negotiation/add-round-form";
import { NegotiationWorkspaceView } from "@/components/negotiation/negotiation-workspace";
import { UploadNegotiationDocument } from "@/components/negotiation/upload-document-form";
import { prisma } from "@/lib/db";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";

export const dynamic = "force-dynamic";

export default async function NegotiationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ round?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [workspace, reconciliation] = await Promise.all([
    getNegotiationWorkspace(prisma, id),
    getDealReconciliation(prisma, id),
  ]);
  if (!workspace) notFound();
  const focusedRound = typeof query.round === "string" ? query.round : null;

  return (
    <div className="min-h-screen bg-[#f3f0ea]">
      <DealHeader
        dealId={workspace.deal.id}
        activeSection="negotiation"
        name={workspace.deal.name}
        company={workspace.deal.company}
        property={workspace.deal.property}
        propertyHref={workspace.deal.propertyId ? `/properties/${workspace.deal.propertyId}` : null}
        stage={workspace.deal.stage}
        status={workspace.deal.status}
        estimatedValue={workspace.deal.estimatedValue}
        createdAt={new Date(workspace.deal.createdAt)}
      />

      <main className="negotiation-workspace page-gutter py-8">
        <NegotiationWorkspaceView workspace={workspace} initialRoundId={focusedRound} reconciliation={reconciliation?.links ?? []} />
        <div className="mt-12 flex flex-wrap items-start justify-end gap-3">
          <AddRoundForm dealId={workspace.deal.id} />
        </div>
        <div className="mt-3">
          <UploadNegotiationDocument dealId={workspace.deal.id} />
        </div>
      </main>
    </div>
  );
}
