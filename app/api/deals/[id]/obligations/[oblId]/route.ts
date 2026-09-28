import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const PatchBody = z.object({
  status: z.enum(["OPEN", "COMPLETED", "OVERDUE", "WAITING"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; oblId: string }> }
) {
  try {
    const { oblId } = await params;
    const body = await req.json();
    const { status } = PatchBody.parse(body);

    const updated = await prisma.obligation.update({
      where: { id: oblId },
      data: { status },
    });

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    console.error("[obligations PATCH]", e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
