import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GraphInvariantError } from "@/lib/entities/errors";
import { getRelationshipEvidence } from "@/lib/promotion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const input = {
    employmentId: params.get("employmentId") ?? undefined,
    propertyStakeId: params.get("propertyStakeId") ?? undefined,
    dealParticipationId: params.get("dealParticipationId") ?? undefined,
    dealId: params.get("dealId") ?? undefined,
  };
  try {
    const evidence = await getRelationshipEvidence(prisma, input);
    if (!evidence) {
      return NextResponse.json({ error: "Assertion not found" }, { status: 404 });
    }
    return NextResponse.json(evidence);
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[evidence GET]", error);
    return NextResponse.json({ error: "Evidence could not be read" }, { status: 500 });
  }
}
