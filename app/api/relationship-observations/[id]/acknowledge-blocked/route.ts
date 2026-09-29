import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GraphInvariantError } from "@/lib/entities/errors";
import { acknowledgeBlockedRelationship } from "@/lib/promotion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const result = await acknowledgeBlockedRelationship(prisma, id);
    if (!result) {
      return NextResponse.json({ error: "Relationship observation not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[relationship acknowledge-blocked POST]", error);
    return NextResponse.json({ error: "Blocked relationship could not be acknowledged" }, { status: 500 });
  }
}
