import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOriginalMessageSource } from "@/lib/messages/source";
import { sanitizeMessageFilename } from "@/lib/messages/storage";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (request.nextUrl.searchParams.has("workspaceId")) return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
  const { id } = await context.params;
  try {
    const workspaceId = await messageRequestWorkspaceId(prisma);
    const source = workspaceId ? await getOriginalMessageSource(prisma, { sourceMessageId: id, expectedWorkspaceId: workspaceId }) : null;
    if (!source || !source.bytes) return NextResponse.json({ error: "Original source not found" }, { status: 404 });
    const filename = sanitizeMessageFilename(source.originalFilename || "message.eml");
    return new NextResponse(new Uint8Array(source.bytes), {
      headers: {
        "Content-Type": source.sourceMimeType || "message/rfc822",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return NextResponse.json({ error: "Original source is unavailable" }, { status: 404 });
  }
}
