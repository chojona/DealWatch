import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { MessageSourceView } from "@/components/messages/message-source-view";
import { prisma } from "@/lib/db";
import { getMessageSource } from "@/lib/messages/service";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const dynamic = "force-dynamic";

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspaceId = await messageRequestWorkspaceId(prisma);
  const message = workspaceId ? await getMessageSource(prisma, id, { expectedWorkspaceId: workspaceId }) : null;
  if (!message) notFound();
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <MessageSourceView message={message} />
      </main>
    </div>
  );
}
