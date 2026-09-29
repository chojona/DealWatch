import { NextRequest, NextResponse } from "next/server";
import { rejectClientWorkspace } from "@/lib/deals/intelligence/service";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
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
  const reconciliation = await getDealReconciliation(prisma, id);
  if (!reconciliation) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  return NextResponse.json(reconciliation);
}
