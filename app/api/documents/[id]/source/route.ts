import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { replaceDevelopmentSourceFile, SourceReplacementError } from "@/lib/documents/replaceSource";
import { getDocumentStorage } from "@/lib/documents/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A PDF file is required." }, { status: 400 });
    }
    const document = await replaceDevelopmentSourceFile(prisma, {
      documentId: id,
      bytes: Buffer.from(await file.arrayBuffer()),
      filename: file.name,
      mimeType: file.type || "application/pdf",
      storage: getDocumentStorage(),
    });
    return NextResponse.json({ document });
  } catch (error) {
    if (error instanceof SourceReplacementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("[document source POST]", error);
    return NextResponse.json({ error: "The source file could not be replaced." }, { status: 500 });
  }
}
