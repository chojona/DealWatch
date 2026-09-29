import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DealCreateError, createModernDeal } from "@/lib/deals/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Deal name is required" }, { status: 400 });
    }
    if ("workspaceId" in body) {
      return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
    }
    const deal = await createModernDeal(prisma, body);
    return NextResponse.json({ deal, href: deal.href }, { status: 201 });
  } catch (error) {
    if (error instanceof DealCreateError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[deals POST]", error);
    return NextResponse.json({ error: "Deal could not be created" }, { status: 500 });
  }
}
