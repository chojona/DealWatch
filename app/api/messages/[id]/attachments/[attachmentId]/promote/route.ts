import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDocumentStorage } from "@/lib/documents/storage";
import { AttachmentPromotionError, promoteAttachmentToDocument, rejectPromotionRequest } from "@/lib/messages/promoteAttachment";
import { getMessageStorage } from "@/lib/messages/storage";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";
import { rejectClientWorkspace } from "@/lib/deals/intelligence/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const rejectedQuery = rejectClientWorkspace(request.nextUrl.searchParams);
  if (rejectedQuery) return NextResponse.json({ error: rejectedQuery }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const rejectedBody = rejectPromotionRequest(body);
  if (rejectedBody) return NextResponse.json({ error: rejectedBody }, { status: 400 });

  const workspaceId = await messageRequestWorkspaceId(prisma);
  if (!workspaceId) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  const { id, attachmentId } = await context.params;
  try {
    const result = await promoteAttachmentToDocument(prisma, {
      messageId: id,
      attachmentId,
      expectedWorkspaceId: workspaceId,
      messageStorage: getMessageStorage(),
      documentStorage: getDocumentStorage(),
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof AttachmentPromotionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error("[attachment promote POST]", error);
    return NextResponse.json({ error: "Attachment could not be promoted" }, { status: 500 });
  }
}
