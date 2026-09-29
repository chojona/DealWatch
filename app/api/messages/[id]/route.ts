import { NextRequest, NextResponse } from "next/server";
import { rejectClientWorkspace } from "@/lib/deals/intelligence/service";
import { prisma } from "@/lib/db";
import { getMessageSource } from "@/lib/messages/service";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rejected = rejectClientWorkspace(request.nextUrl.searchParams);
  if (rejected) return NextResponse.json({ error: rejected }, { status: 400 });
  const { id } = await context.params;
  const workspaceId = await messageRequestWorkspaceId(prisma);
  const message = workspaceId ? await getMessageSource(prisma, id, { expectedWorkspaceId: workspaceId }) : null;
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  return NextResponse.json(message);
}
