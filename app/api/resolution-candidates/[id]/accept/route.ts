import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GraphInvariantError } from "@/lib/entities/errors";
import { acceptResolutionCandidate } from "@/lib/resolution/service";

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
    const result = await acceptResolutionCandidate(prisma, id, reason);
    if (!result) {
      return NextResponse.json({ error: "Resolution candidate not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[resolution accept POST]", error);
    return NextResponse.json({ error: "Resolution candidate could not be accepted" }, { status: 500 });
  }
}
