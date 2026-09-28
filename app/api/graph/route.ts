import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GraphQueryError, parseGraphQuery } from "@/lib/graph/query";
import { getConnectionGraph } from "@/lib/graph/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = parseGraphQuery(request.nextUrl.searchParams);
    const graph = await getConnectionGraph(prisma, query);
    if (!graph) {
      return NextResponse.json({ error: "Root entity not found" }, { status: 404 });
    }
    return NextResponse.json(graph);
  } catch (error) {
    if (error instanceof GraphQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[graph GET]", error);
    return NextResponse.json({ error: "Connection graph could not be read" }, { status: 500 });
  }
}
