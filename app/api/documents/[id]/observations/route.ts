import { NextRequest, NextResponse } from "next/server";
import { readDocumentObservations } from "@/lib/ai/graph/readObservations";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const observations = await readDocumentObservations(prisma, id);
  if (!observations) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json(observations);
}
