import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DealBriefQueryError, parseDealBriefQuery } from "@/lib/deals/brief/query";
import { getDealBrief } from "@/lib/deals/brief/service";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const query = parseDealBriefQuery(request.nextUrl.searchParams);
    const { id } = await context.params;
    const workspaceId = await messageRequestWorkspaceId(prisma);
    if (!workspaceId) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const brief = await getDealBrief(prisma, id, {
      ...query,
      expectedWorkspaceId: workspaceId,
    });
    if (!brief) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    return NextResponse.json(brief);
  } catch (error) {
    if (error instanceof DealBriefQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[deal brief GET]", error);
    return NextResponse.json({ error: "Deal brief could not be read" }, { status: 500 });
  }
}
