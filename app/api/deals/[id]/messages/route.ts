import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseAddresses } from "@/lib/messages/ingest/eml";
import { ingestEmlMessage, ingestManualMessage } from "@/lib/messages/ingest/service";
import { listDealMessages } from "@/lib/messages/list";
import { messageRequestWorkspaceId } from "@/lib/messages/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (request.nextUrl.searchParams.has("workspaceId")) return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
  const { id } = await context.params;
  const workspaceId = await messageRequestWorkspaceId(prisma);
  if (!workspaceId || !(await prisma.deal.findFirst({ where: { id, workspaceId }, select: { id: true } }))) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  const result = await listDealMessages(prisma, id);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Deal not found" }, { status: 404 });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await context.params;
  try {
    const workspaceId = await messageRequestWorkspaceId(prisma);
    if (!workspaceId || !(await prisma.deal.findFirst({ where: { id: dealId, workspaceId }, select: { id: true } }))) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (form.has("workspaceId")) return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "An .eml file is required" }, { status: 400 });
      if (!file.name.toLowerCase().endsWith(".eml")) return NextResponse.json({ error: "Only .eml files are supported" }, { status: 415 });
      const message = await ingestEmlMessage(prisma, { dealId, bytes: Buffer.from(await file.arrayBuffer()), filename: file.name, mimeType: file.type });
      return NextResponse.json({ id: message.id, href: `/messages/${message.id}` }, { status: 201 });
    }
    const body = await request.json();
    if (body && typeof body === "object" && "workspaceId" in body) return NextResponse.json({ error: "workspaceId is server-controlled" }, { status: 400 });
    if (typeof body?.body !== "string" || !body.body.trim()) return NextResponse.json({ error: "Message body is required" }, { status: 400 });
    const recipients = typeof body.recipients === "string" ? parseAddresses(body.recipients) : [];
    const sentAt = typeof body.sentAt === "string" && body.sentAt ? new Date(body.sentAt) : null;
    const message = await ingestManualMessage(prisma, {
      dealId,
      subject: typeof body.subject === "string" && body.subject.trim() ? body.subject.trim() : null,
      senderName: typeof body.senderName === "string" && body.senderName.trim() ? body.senderName.trim() : null,
      senderAddress: typeof body.senderAddress === "string" && body.senderAddress.trim() ? body.senderAddress.trim() : null,
      sentAt: sentAt && Number.isFinite(sentAt.getTime()) ? sentAt : null,
      receivedAt: null,
      bodyText: body.body,
      participants: recipients.map((item) => ({ role: "TO" as const, ...item })),
    });
    return NextResponse.json({ id: message.id, href: `/messages/${message.id}` }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email could not be imported";
    const status = "code" in (error as object) && (error as { code?: string }).code === "OVERSIZED" ? 413 : message === "Deal not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
