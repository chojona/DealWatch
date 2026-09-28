import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ActivityQueryError, parseActivityQuery } from "@/lib/activity/query";
import { getActivityPage } from "@/lib/activity/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const input = parseActivityQuery(request.nextUrl.searchParams);
    const page = await getActivityPage(prisma, input);
    if (!page) return NextResponse.json({ error: "Canonical root not found" }, { status: 404 });
    return NextResponse.json(page);
  } catch (error) {
    if (error instanceof ActivityQueryError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[activity GET]", error);
    return NextResponse.json({ error: "Activity could not be read" }, { status: 500 });
  }
}
