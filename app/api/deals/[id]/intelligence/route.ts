import { NextRequest, NextResponse } from "next/server";
import { getDealIntelligence, rejectClientWorkspace } from "@/lib/deals/intelligence/service";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const rejected = rejectClientWorkspace(request.nextUrl.searchParams);
  if (rejected) {
    return NextResponse.json({ error: rejected }, { status: 400 });
  }
  const { id } = await context.params;
  const intelligence = await getDealIntelligence(prisma, id);
  if (!intelligence) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  return NextResponse.json(intelligence);
}
