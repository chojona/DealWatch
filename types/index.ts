import type { z } from "zod";
import type { AnalyzeThreadOutputSchema } from "@/lib/ai/analysisSchemas";

export type ObligationStatus = "OPEN" | "COMPLETED" | "OVERDUE" | "WAITING";
export type DealStatus = "ACTIVE" | "CLOSED" | "DEAD";
export type Urgency = "LOW" | "MEDIUM" | "HIGH";

export interface AnalyzeThreadInput {
  threadText: string;
  analyzedAt: Date;
}

export type AnalyzeThreadOutput = z.infer<typeof AnalyzeThreadOutputSchema>;
