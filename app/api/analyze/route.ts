import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AnalysisConfigurationError,
  AnalysisInputError,
  AnalyzeThreadOutputSchema,
  analyzeThread,
} from "@/lib/ai/analyzeThread";
import { prisma } from "@/lib/db";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";

const PostBody = z.object({
  threadText: z
    .string()
    .max(120_000)
    .refine((value) => value.trim().length > 0, "Thread text cannot be empty"),
});

const PutBody = z.object({
  threadText: z.string().min(1).max(120_000),
  result: AnalyzeThreadOutputSchema,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { threadText } = PostBody.parse(body);
    const result = await analyzeThread({ threadText, analyzedAt: new Date() });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof AnalysisInputError) {
      return NextResponse.json(
        { error: "Invalid request", details: e.issues },
        { status: 400 }
      );
    }
    if (e instanceof AnalysisConfigurationError) {
      return NextResponse.json(
        { error: "Analysis service is not configured" },
        { status: 503 }
      );
    }
    console.error("[analyze POST]", e);
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { threadText, result } = PutBody.parse(body);

    // Create or find a deal to attach this to
    const dealName = [result.deal.property, result.deal.company]
      .filter(Boolean)
      .join(" — ") || "Untitled Deal (from Thread Analysis)";

    const workspace = await ensureDefaultWorkspace(prisma);
    const deal = await prisma.deal.create({
      data: {
        name: dealName,
        company: result.deal.company ?? "Unknown",
        property: result.deal.property ?? "Unknown",
        stage: result.deal.stage ?? "Unknown",
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });

    // Create thread with all messages parsed from text
    const thread = await prisma.thread.create({
      data: {
        dealId: deal.id,
        subject: dealName,
        participants: JSON.stringify(["Analyzed via Thread Analyzer"]),
      },
    });

    // Create a single message representing the analyzed thread
    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        sender: "Thread Analyzer",
        recipients: JSON.stringify(["dealwatch@internal"]),
        sentAt: new Date(),
        body: threadText,
      },
    });

    // Save obligations
    for (const obl of result.obligations) {
      await prisma.obligation.create({
        data: {
          dealId: deal.id,
          messageId: message.id,
          owner: obl.owner,
          counterparty: obl.counterparty ?? null,
          description: obl.description,
          dueAt: obl.dueAt ? new Date(obl.dueAt) : null,
          status: obl.status,
          confidence: obl.confidence,
          evidenceQuote: obl.evidenceQuote,
        },
      });
    }

    // Save events
    for (const event of result.events) {
      await prisma.dealEvent.create({
        data: {
          dealId: deal.id,
          messageId: message.id,
          type: event.type,
          description: event.description,
          occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
          confidence: event.confidence,
          evidenceQuote: event.evidenceQuote,
        },
      });
    }

    return NextResponse.json({ dealId: deal.id }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: e.errors },
        { status: 400 }
      );
    }
    console.error("[analyze PUT]", e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
