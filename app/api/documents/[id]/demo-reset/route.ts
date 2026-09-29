import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DemoResetError, resetDevelopmentDocument } from "@/lib/documents/demoReset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const report = await resetDevelopmentDocument(prisma, id);
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof DemoResetError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    console.error("[demo reset POST]", error);
    return NextResponse.json({ error: "The document could not be removed." }, { status: 500 });
  }
}
