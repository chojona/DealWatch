import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDocumentStorage } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: { storageKey: true, filename: true, ingestionStatus: true },
  });
  if (!document || document.storageKey === "pending") {
    return NextResponse.json({ error: "Document file not found" }, { status: 404 });
  }

  try {
    const bytes = await getDocumentStorage().get(document.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${document.filename.replaceAll('"', "")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[document file GET]", error);
    return NextResponse.json({ error: "Document file not found" }, { status: 404 });
  }
}
