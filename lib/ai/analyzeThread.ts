import { z } from "zod";
import type { AnalyzeThreadInput, AnalyzeThreadOutput } from "@/types";
import { ANALYZE_SYSTEM_PROMPT } from "./analysisPrompt";
import { AnalyzeThreadOutputSchema } from "./analysisSchemas";
import {
  extractThreadWithOpenAI,
  type ThreadExtractor,
} from "./openAIThreadExtractor";
import { reconcileAnalysis } from "./reconcileAnalysis";

const MAX_THREAD_CHARACTERS = 120_000;

const AnalyzeThreadInputSchema = z.object({
  threadText: z
    .string()
    .max(MAX_THREAD_CHARACTERS)
    .refine((value) => value.trim().length > 0, "Thread text cannot be empty"),
  analyzedAt: z.date().refine(
    (value) => Number.isFinite(value.getTime()),
    "Analysis timestamp must be valid"
  ),
});

export class AnalysisInputError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(error: z.ZodError) {
    super("Invalid thread analysis input");
    this.name = "AnalysisInputError";
    this.issues = error.issues;
  }
}

export interface ThreadAnalyzerDependencies {
  extractor: ThreadExtractor;
}

/**
 * Creates an analyzer with an injectable extraction boundary. Production uses
 * OpenAI; tests supply deterministic candidate extractions.
 */
export function createThreadAnalyzer({
  extractor,
}: ThreadAnalyzerDependencies): (
  input: AnalyzeThreadInput
) => Promise<AnalyzeThreadOutput> {
  return async (input) => {
    const parsedInput = AnalyzeThreadInputSchema.safeParse(input);
    if (!parsedInput.success) throw new AnalysisInputError(parsedInput.error);

    const startedAt = Date.now();
    const { extraction, model } = await extractor(parsedInput.data);
    const output = reconcileAnalysis({
      ...parsedInput.data,
      extraction,
      model,
      latencyMs: Date.now() - startedAt,
    });

    return AnalyzeThreadOutputSchema.parse(output);
  };
}

const productionAnalyzer = createThreadAnalyzer({
  extractor: extractThreadWithOpenAI,
});

/** Analyze a complete email thread as of the supplied timestamp. */
export async function analyzeThread(
  input: AnalyzeThreadInput
): Promise<AnalyzeThreadOutput> {
  return productionAnalyzer(input);
}

export { ANALYZE_SYSTEM_PROMPT, AnalyzeThreadOutputSchema };
export type { ThreadExtractor } from "./openAIThreadExtractor";
export {
  AnalysisConfigurationError,
  ThreadExtractionError,
} from "./openAIThreadExtractor";
