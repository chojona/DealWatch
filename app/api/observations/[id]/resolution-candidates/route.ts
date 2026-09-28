import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GraphInvariantError } from "@/lib/entities/errors";
import { listResolutionCandidates } from "@/lib/resolution/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const review = await listResolutionCandidates(prisma, id);
    if (!review) {
      return NextResponse.json({ error: "Observation not found" }, { status: 404 });
    }
    return NextResponse.json(review);
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[resolution candidates GET]", error);
    return NextResponse.json({ error: "Resolution candidates could not be loaded" }, { status: 500 });
  }
}
