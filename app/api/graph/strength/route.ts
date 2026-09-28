import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAssertionStrength } from "@/lib/graph/paths";
import { GraphQueryError, parseStrengthQuery } from "@/lib/graph/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Strength is read from the assertion row. A client workspaceId is rejected. */
export async function GET(request: NextRequest) {
  try {
    const query = parseStrengthQuery(request.nextUrl.searchParams);
    const strength = await getAssertionStrength(prisma, query);
    if (!strength) {
      return NextResponse.json({ error: "Assertion not found" }, { status: 404 });
    }
    return NextResponse.json(strength);
  } catch (error) {
    if (error instanceof GraphQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[graph strength GET]", error);
    return NextResponse.json({ error: "Relationship strength could not be read" }, { status: 500 });
  }
}
