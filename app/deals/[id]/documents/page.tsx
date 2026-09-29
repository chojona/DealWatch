import { notFound } from "next/navigation";
import { DealHeader } from "@/components/deals/deal-header";
import { InboxView } from "@/components/inbox/inbox-view";
import { UploadNegotiationDocument } from "@/components/negotiation/upload-document-form";
import { prisma } from "@/lib/db";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getInbox } from "@/lib/inbox/service";
import { InboxQueryError, parseInboxQuery } from "@/lib/inbox/query";

export const dynamic = "force-dynamic";

export default async function DealDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const workspace = await ensureDefaultWorkspace(prisma);
  const deal = await prisma.deal.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!deal) notFound();
  const resolved = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") query.set(key, value);
  }
  query.delete("dealId");
  query.delete("workspaceId");
  let queryError: string | null = null;
  let parsed = parseInboxQuery(new URLSearchParams());
  try {
    parsed = parseInboxQuery(query);
  } catch (error) {
    queryError = error instanceof InboxQueryError ? error.message : "Invalid document query";
  }
  const page = queryError
    ? null
    : await getInbox(prisma, {
        workspaceId: workspace.id,
        scopeDealId: deal.id,
        filter: parsed.filter,
        documentType: parsed.documentType,
        negotiationSide: parsed.negotiationSide,
        q: parsed.q,
        includeMessages: false,
      });

  return (
    <div className="min-h-screen">
      <DealHeader
        dealId={deal.id}
        activeSection="documents"
        name={deal.name}
        company={deal.company}
        property={deal.property}
        propertyHref={deal.propertyId ? `/properties/${deal.propertyId}` : null}
        stage={deal.stage}
        status={deal.status}
        estimatedValue={deal.estimatedValue}
        createdAt={deal.createdAt}
      />
      <main className="page-frame">
        <div className="mb-4">
          <UploadNegotiationDocument dealId={deal.id} surface="documents" />
        </div>
        {queryError || !page ? (
          <p className="text-sm text-red-800">{queryError}</p>
        ) : (
          <InboxView page={page} basePath={`/deals/${deal.id}/documents`} query={query} lockedDealName={deal.name} documentsOnly />
        )}
      </main>
    </div>
  );
}
