import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DealActionQueryError, parseDealActionQuery } from "@/lib/deals/actions/query";
import { getDealActionState } from "@/lib/deals/actions/service";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    parseDealActionQuery(request.nextUrl.searchParams);
    const { id } = await context.params;
    const workspaceId = await messageRequestWorkspaceId(prisma);
    if (!workspaceId) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    const actions = await getDealActionState(prisma, id, { expectedWorkspaceId: workspaceId });
    if (!actions) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }
    return NextResponse.json(actions);
  } catch (error) {
    if (error instanceof DealActionQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[deal actions GET]", error);
    return NextResponse.json({ error: "Deal actions could not be read" }, { status: 500 });
  }
}
