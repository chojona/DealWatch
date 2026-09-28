import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { analyzeThread } from "@/lib/ai/analyzeThread";
import { prisma } from "@/lib/db";

const PostBody = z.object({
  threadText: z.string().min(10),
});

const PutBody = z.object({
  threadText: z.string().min(10),
  result: z.object({
    deal: z.object({
      company: z.string().optional(),
      property: z.string().optional(),
      stage: z.string().optional(),
    }),
    events: z.array(
      z.object({
        type: z.string(),
        description: z.string(),
        occurredAt: z.string().optional(),
        confidence: z.number(),
        evidenceQuote: z.string(),
      })
    ),
    obligations: z.array(
      z.object({
        owner: z.string(),
        counterparty: z.string().optional(),
        description: z.string(),
        dueAt: z.string().optional(),
        status: z.enum(["OPEN", "COMPLETED", "OVERDUE", "WAITING"]),
        confidence: z.number(),
        evidenceQuote: z.string(),
      })
    ),
    nextAction: z
      .object({
        description: z.string(),
        owner: z.string(),
        urgency: z.enum(["LOW", "MEDIUM", "HIGH"]),
      })
      .optional(),
  }),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { threadText } = PostBody.parse(body);
    const result = await analyzeThread(threadText);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: e.errors },
        { status: 400 }
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

    const deal = await prisma.deal.create({
      data: {
        name: dealName,
        company: result.deal.company ?? "Unknown",
        property: result.deal.property ?? "Unknown",
        stage: result.deal.stage ?? "Unknown",
        status: "ACTIVE",
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
