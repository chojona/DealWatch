import { NextResponse } from "next/server";
import { isE2ETestMode } from "@/lib/e2e/mode";
import { resetE2EDatabase } from "@/lib/e2e/reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (!isE2ETestMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await resetE2EDatabase();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "E2E reset failed";
    return NextResponse.json({ error: message, databaseUrl: process.env.DATABASE_URL }, { status: 403 });
  }
}
