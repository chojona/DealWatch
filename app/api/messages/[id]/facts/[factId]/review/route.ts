import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reviewActivityFact } from "@/lib/messages/review";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; factId: string }> }) {
  const body = await request.json().catch(() => ({}));
  if (body && typeof body === "object" && "workspaceId" in body) return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
  if (!["CONFIRMED", "INCORRECT", "SUPERSEDED"].includes(body?.state)) return NextResponse.json({ error: "Invalid fact review state" }, { status: 400 });
  try {
    const { id, factId } = await context.params;
    const workspaceId = await messageRequestWorkspaceId(prisma);
    if (!workspaceId) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const result = await reviewActivityFact(prisma, { sourceMessageId: id, activityFactId: factId, state: body.state, correctedPayload: body.correctedPayload, note: typeof body.note === "string" ? body.note : null, expectedWorkspaceId: workspaceId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fact review could not be saved";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
