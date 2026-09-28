import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDealKnowledge } from "@/lib/promotion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const knowledge = await getDealKnowledge(prisma, id);
  if (!knowledge) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  return NextResponse.json(knowledge);
}
