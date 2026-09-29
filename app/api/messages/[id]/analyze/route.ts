import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeSourceMessage } from "@/lib/messages/service";
import { parseAnalyzeRequestBody } from "@/lib/messages/speakerSide";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const body = await request.json().catch(() => null);
  let parsed;
  try {
    parsed = parseAnalyzeRequestBody(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Choose who is speaking before analysis";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const workspaceId = await messageRequestWorkspaceId(prisma);
    if (!workspaceId) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    const result = await analyzeSourceMessage(prisma, id, {
      expectedWorkspaceId: workspaceId,
      speakerSide: parsed.speakerSide,
      recordSpeakerSide: parsed.recorded,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Message could not be analyzed";
    const status = message === "Message not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
