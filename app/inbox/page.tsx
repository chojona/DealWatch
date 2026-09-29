import { InboxView } from "@/components/inbox/inbox-view";
import { ErrorState } from "@/components/ui/error-state";
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
      <main className="page-frame">
        {queryError || !page ? (
          <ErrorState title="Inbox could not be opened" description={queryError ?? "The inbox query was not valid."} />
        ) : (
          <InboxView page={page} basePath="/inbox" query={params} />
        )}
      </main>
    </div>
  );
}
