import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { MessageSourceView } from "@/components/messages/message-source-view";
import { prisma } from "@/lib/db";
import { getMessageSource } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

export default async function MessagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const message = await getMessageSource(prisma, id);
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
