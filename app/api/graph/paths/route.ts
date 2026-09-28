import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findConnectionPaths } from "@/lib/graph/paths";
import { GraphQueryError, GraphRequestError, parsePathQuery } from "@/lib/graph/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Path search is read-only and workspace-scoped by the source and target
 * entities. A client workspaceId is rejected. There is no session auth yet.
 */
export async function GET(request: NextRequest) {
  try {
    const query = parsePathQuery(request.nextUrl.searchParams);
    const result = await findConnectionPaths(prisma, query);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GraphRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof GraphQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[graph paths GET]", error);
    return NextResponse.json({ error: "Connection paths could not be read" }, { status: 500 });
  }
}
