import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeSourceMessage } from "@/lib/messages/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const body = await request.json().catch(() => ({}));
  if (body && typeof body === "object" && "workspaceId" in body) {
    return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const result = await analyzeSourceMessage(prisma, id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Message could not be analyzed";
    const status = message === "Message not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
