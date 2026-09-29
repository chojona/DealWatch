import { Nav } from "@/components/nav";
import { InboxView } from "@/components/inbox/inbox-view";
import { prisma } from "@/lib/db";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getInbox } from "@/lib/inbox/service";
import { InboxQueryError, parseInboxQuery } from "@/lib/inbox/query";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") params.set(key, value);
  }
  let queryError: string | null = null;
  let parsed = parseInboxQuery(new URLSearchParams());
  try {
    parsed = parseInboxQuery(params);
  } catch (error) {
    queryError = error instanceof InboxQueryError ? error.message : "Invalid inbox query";
  }
  const workspace = await ensureDefaultWorkspace(prisma);
  const page = queryError
    ? null
    : await getInbox(prisma, { workspaceId: workspace.id, ...parsed });

  return (
    <div className="min-h-screen">
      <Nav active="/inbox" />
      <main className="mx-auto max-w-5xl px-6 py-6">
        {queryError || !page ? (
          <p className="rounded-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{queryError}</p>
        ) : (
          <InboxView page={page} basePath="/inbox" query={params} />
        )}
      </main>
    </div>
  );
}
