import type { ActionSpeakerSide } from "@/lib/ai/activity/actionDirectives";

export const ANALYZE_SPEAKER_CHOICES = ["OUR_SIDE", "COUNTERPARTY", "UNKNOWN"] as const;

export type AnalyzeSpeakerChoice = (typeof ANALYZE_SPEAKER_CHOICES)[number];

export interface ParsedAnalyzeRequest {
  speakerSide: ActionSpeakerSide | null;
  recorded: AnalyzeSpeakerChoice;
}

export function parseAnalyzeRequestBody(body: unknown): ParsedAnalyzeRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Choose who is speaking before analysis");
  }
  if ("workspaceId" in body) {
    throw new Error("workspaceId is server-controlled");
  }
  const value = (body as { speakerSide?: unknown }).speakerSide;
  if (value !== "OUR_SIDE" && value !== "COUNTERPARTY" && value !== "UNKNOWN") {
    throw new Error("Choose who is speaking before analysis");
  }
  return {
    speakerSide: value === "UNKNOWN" ? null : value,
    recorded: value,
  };
}

export function recordedSpeakerSide(options: {
  speakerSide?: ActionSpeakerSide | null;
  recordSpeakerSide?: AnalyzeSpeakerChoice | null;
}): AnalyzeSpeakerChoice | null {
  if (options.recordSpeakerSide) return options.recordSpeakerSide;
  if (options.speakerSide === "OUR_SIDE" || options.speakerSide === "COUNTERPARTY") return options.speakerSide;
  return null;
}
