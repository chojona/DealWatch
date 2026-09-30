import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AnalysisConfigurationError,
  AnalysisInputError,
  analyzeThread,
} from "@/lib/ai/analyzeThread";

const PostBody = z.object({
  threadText: z
    .string()
    .max(120_000)
    .refine((value) => value.trim().length > 0, "Thread text cannot be empty"),
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

export async function PUT() {
  return NextResponse.json(
    { error: "Thread analysis is not saved as deal history" },
    { status: 410 }
  );
}
