import { notFound } from "next/navigation";
import { MessageSourceView } from "@/components/messages/message-source-view";
import { getActionEvidenceReview } from "@/lib/deals/actions/evidenceReview";
import { prisma } from "@/lib/db";
import { getMessageSource } from "@/lib/messages/service";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const dynamic = "force-dynamic";

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = await messageRequestWorkspaceId(prisma);
  const message = workspaceId ? await getMessageSource(prisma, id, { expectedWorkspaceId: workspaceId }) : null;
  if (!message) notFound();
  const queue = await getActionEvidenceReview(prisma, message.deal.id, { expectedWorkspaceId: workspaceId ?? undefined });
  const actionEvidence = queue?.items.filter((item) => item.messageId === message.id) ?? [];
  return (
    <div className="min-h-screen">
      <main className="page-frame page-reading">
        <MessageSourceView message={message} actionEvidence={actionEvidence} />
      </main>
    </div>
  );
}
