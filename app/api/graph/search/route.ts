import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { GraphQueryError, parseSearchQuery } from "@/lib/graph/query";
import { searchCanonicalEntities, searchWorkspaceContext, workspaceIdForEntity } from "@/lib/graph/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Workspace search has no authenticated session yet. A client workspaceId is
 * rejected. The workspace is the root entity's workspace when rootType and
 * rootId are present, otherwise the Default workspace.
 */
export async function GET(request: NextRequest) {
  try {
    const query = parseSearchQuery(request.nextUrl.searchParams);
    const workspaceId =
      query.rootType && query.rootId
        ? await workspaceIdForEntity(prisma, query.rootType, query.rootId)
        : (await ensureDefaultWorkspace(prisma)).id;
    if (!workspaceId) {
      return NextResponse.json({ error: "Root entity not found" }, { status: 404 });
    }
    const [results, firm] = await Promise.all([
      searchCanonicalEntities(prisma, { workspaceId, q: query.q }),
      searchWorkspaceContext(prisma, workspaceId),
    ]);
    return NextResponse.json({ workspaceId, ...firm, results });
  } catch (error) {
    if (error instanceof GraphQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[graph search GET]", error);
    return NextResponse.json({ error: "Canonical search could not be read" }, { status: 500 });
  }
}
