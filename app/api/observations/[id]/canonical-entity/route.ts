import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { GraphInvariantError } from "@/lib/entities/errors";
import {
  createCanonicalEntityFromObservation,
  previewCanonicalEntity,
} from "@/lib/promotion/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const preview = await previewCanonicalEntity(prisma, id);
  if (!preview) {
    return NextResponse.json({ error: "Observation not found" }, { status: 404 });
  }
  return NextResponse.json(preview);
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const result = await createCanonicalEntityFromObservation(prisma, id);
    if (!result) {
      return NextResponse.json({ error: "Observation not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GraphInvariantError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[canonical entity POST]", error);
    return NextResponse.json({ error: "Canonical entity could not be created" }, { status: 500 });
  }
}
