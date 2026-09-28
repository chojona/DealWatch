import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { previewRelationshipPromotion } from "@/lib/promotion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const preview = await previewRelationshipPromotion(prisma, id);
  if (!preview) {
    return NextResponse.json({ error: "Relationship observation not found" }, { status: 404 });
  }
  return NextResponse.json(preview);
}
