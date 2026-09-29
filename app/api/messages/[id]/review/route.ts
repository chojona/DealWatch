import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decideMessageReview } from "@/lib/messages/review";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const body = await request.json().catch(() => ({}));
  if (body && typeof body === "object" && "workspaceId" in body) return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
  if (body?.decision !== "ACKNOWLEDGED" && body?.decision !== "NEEDS_FOLLOW_UP") return NextResponse.json({ error: "Invalid review decision" }, { status: 400 });
  try {
    const { id } = await context.params;
    const workspaceId = await messageRequestWorkspaceId(prisma);
    if (!workspaceId) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const result = await decideMessageReview(prisma, { sourceMessageId: id, decision: body.decision, note: typeof body.note === "string" ? body.note : null, expectedWorkspaceId: workspaceId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review could not be saved";
    return NextResponse.json({ error: message }, { status: message === "Message not found" ? 404 : 400 });
  }
}
