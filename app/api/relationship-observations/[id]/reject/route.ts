import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GraphInvariantError } from "@/lib/entities/errors";
import { rejectRelationshipObservation } from "@/lib/promotion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason : null;
  try {
    const result = await rejectRelationshipObservation(prisma, id, reason);
    if (!result) {
      return NextResponse.json({ error: "Relationship observation not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[relationship reject POST]", error);
    return NextResponse.json({ error: "Relationship could not be rejected" }, { status: 500 });
  }
}
