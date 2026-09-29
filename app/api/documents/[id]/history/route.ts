import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getReviewHistory } from "@/lib/review/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const workspace = await ensureDefaultWorkspace(prisma);
  const history = await getReviewHistory(prisma, { workspaceId: workspace.id, documentId: id });
  if (!history) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return NextResponse.json(history);
}
