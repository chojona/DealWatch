import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { DocumentMetadataError, updateDocumentMetadata } from "@/lib/documents/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  documentType: z.enum(["LOI", "PROPOSAL", "COUNTERPROPOSAL", "TERM_SHEET", "AMENDMENT", "RENEWAL_PROPOSAL", "OTHER"]).optional(),
  negotiationSide: z.enum(["TENANT", "LANDLORD"]).optional(),
  documentDate: z.string().optional(),
  originalFilename: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = Schema.parse(await request.json());
    const documentDate = body.documentDate === undefined ? undefined : new Date(`${body.documentDate.slice(0, 10)}T00:00:00.000Z`);
    const document = await updateDocumentMetadata(prisma, id, {
      documentType: body.documentType,
      negotiationSide: body.negotiationSide,
      documentDate,
      originalFilename: body.originalFilename,
    });
    return NextResponse.json({ document });
  } catch (error) {
    if (error instanceof DocumentMetadataError) {
      return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Metadata is invalid." }, { status: 400 });
    }
    console.error("[document metadata PATCH]", error);
    return NextResponse.json({ error: "Metadata could not be saved." }, { status: 500 });
  }
}
