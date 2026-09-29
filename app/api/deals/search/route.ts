import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DealSearchError, parseDealSearchRequest, searchDeals } from "@/lib/deals/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { q } = parseDealSearchRequest(request.nextUrl.searchParams);
    const result = await searchDeals(prisma, { q });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof DealSearchError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[deals search GET]", error);
    return NextResponse.json({ error: "Deal search could not be read" }, { status: 500 });
  }
}
