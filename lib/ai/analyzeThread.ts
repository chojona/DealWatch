/**
 * analyzeThread.ts
 *
 * Interface for AI-powered thread analysis.
 * Currently implemented as a rule-based stub that demonstrates
 * the expected output structure.
 *
 * To connect a real LLM:
 * 1. Replace the stub implementation below with an LLM call
 *    (e.g. OpenAI, Anthropic, etc.)
 * 2. Pass the ANALYZE_PROMPT + threadText to the LLM
 * 3. Parse and validate the response with Zod
 *
 * The interface (input/output types) is stable.
 */

import { z } from "zod";
import type { AnalyzeThreadOutput } from "@/types";

// ─── Zod schema for validated output ─────────────────────────
const ObligationStatusEnum = z.enum([
  "OPEN",
  "COMPLETED",
  "OVERDUE",
  "WAITING",
]);
const UrgencyEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const AnalyzeThreadOutputSchema = z.object({
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
      confidence: z.number().min(0).max(1),
      evidenceQuote: z.string(),
    })
  ),
  obligations: z.array(
    z.object({
      owner: z.string(),
      counterparty: z.string().optional(),
      description: z.string(),
      dueAt: z.string().optional(),
      status: ObligationStatusEnum,
      confidence: z.number().min(0).max(1),
      evidenceQuote: z.string(),
    })
  ),
  nextAction: z
    .object({
      description: z.string(),
      owner: z.string(),
      urgency: UrgencyEnum,
    })
    .optional(),
});

// ─── Stub implementation ──────────────────────────────────────

/**
 * Analyzes a pasted email thread and returns structured intelligence.
 *
 * Current implementation: rule-based stub.
 * Replace `stubAnalyze` with an LLM call when ready.
 */
export async function analyzeThread(
  threadText: string
): Promise<AnalyzeThreadOutput> {
  // TODO: Replace with real LLM call
  // Example (OpenAI):
  //   const completion = await openai.chat.completions.create({
  //     model: "gpt-4o",
  //     messages: [
  //       { role: "system", content: ANALYZE_SYSTEM_PROMPT },
  //       { role: "user", content: threadText }
  //     ],
  //     response_format: { type: "json_object" }
  //   });
  //   const raw = JSON.parse(completion.choices[0].message.content!);
  //   return AnalyzeThreadOutputSchema.parse(raw);

  return stubAnalyze(threadText);
}

function stubAnalyze(threadText: string): AnalyzeThreadOutput {
  const text = threadText.toLowerCase();
  const lines = threadText.split("\n").filter((l) => l.trim().length > 0);

  // Extract participants (lines starting with From: or names before <)
  const fromMatches = Array.from(threadText.matchAll(/From:\s*([^\n<]+)/gi));
  const senderNames = fromMatches.map((m) =>
    m[1].trim().split("<")[0].trim()
  );
  const primarySender = senderNames[0] ?? "Unknown";

  // Extract company/property hints
  const subjectMatch = threadText.match(/Subject:\s*([^\n]+)/i);
  const subject = subjectMatch?.[1]?.trim() ?? "";

  // Deadline patterns
  const deadlineMatches = Array.from(
    threadText.matchAll(
      /by\s+(end of (?:the |this )?\w+(?:\s+\(\w+ \d+\w*\))?|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})/gi
    )
  );

  // Commitment patterns
  const commitmentMatches = Array.from(
    threadText.matchAll(
      /(?:will|we'll|i'll|i will|plan to|intend to|send|provide|deliver|get back|follow up|respond|review|confirm)\s+[^.!?\n]{5,80}/gi
    )
  );

  // Wait patterns
  const waitPatterns = Array.from(
    threadText.matchAll(
      /(?:waiting|pending|awaiting|need to hear|follow up after|reach out after)\s+[^.!?\n]{5,60}/gi
    )
  );

  const obligations: AnalyzeThreadOutput["obligations"] = [];
  const events: AnalyzeThreadOutput["events"] = [];

  // Build obligations from detected patterns
  if (commitmentMatches.length > 0) {
    const commit = commitmentMatches[0];
    obligations.push({
      owner: primarySender,
      description: `Committed action detected: "${commit[0].trim().slice(0, 100)}"`,
      status: "OPEN",
      confidence: 0.72,
      evidenceQuote: commit[0].trim().slice(0, 150),
    });
  }

  if (deadlineMatches.length > 0) {
    obligations.push({
      owner: primarySender,
      description: `Deadline referenced: ${deadlineMatches[0][0]}`,
      status: "OPEN",
      confidence: 0.68,
      evidenceQuote: deadlineMatches[0][0],
    });
  }

  if (waitPatterns.length > 0) {
    obligations.push({
      owner: "Counterparty",
      description: `Waiting on: ${waitPatterns[0][0].trim().slice(0, 100)}`,
      status: "WAITING",
      confidence: 0.65,
      evidenceQuote: waitPatterns[0][0].trim().slice(0, 150),
    });
  }

  // Build events from first few lines of thread
  const firstSignificantLine =
    lines.find((l) => l.length > 30 && !l.includes(":")) ?? lines[0] ?? "";

  events.push({
    type: "MESSAGE_ANALYZED",
    description: `Thread analyzed: ${subject || firstSignificantLine.slice(0, 80)}`,
    confidence: 0.85,
    evidenceQuote: firstSignificantLine.slice(0, 200),
  });

  // Infer deal info from subject / body
  const propertyMatch = subject.match(/^([^—\-|:]+)/);
  const companyMatch = subject.match(/[—\-|:]\s*([^—\-|:]+)/);

  const urgency: "LOW" | "MEDIUM" | "HIGH" =
    text.includes("urgent") ||
    text.includes("asap") ||
    text.includes("overdue") ||
    text.includes("deadline")
      ? "HIGH"
      : text.includes("this week") || text.includes("end of week")
        ? "MEDIUM"
        : "LOW";

  return {
    deal: {
      property: propertyMatch?.[1]?.trim() || undefined,
      company: companyMatch?.[1]?.trim() || undefined,
      stage: text.includes("loi")
        ? "LOI"
        : text.includes("lease")
          ? "Negotiation"
          : text.includes("tour")
            ? "Market Survey"
            : undefined,
    },
    events,
    obligations,
    nextAction:
      obligations.length > 0
        ? {
            description: obligations[0].description,
            owner: obligations[0].owner,
            urgency,
          }
        : undefined,
  };
}

// ─── System prompt (for future LLM integration) ───────────────
export const ANALYZE_SYSTEM_PROMPT = `You are a commercial real estate deal intelligence engine.

Given an email thread, extract structured information about commitments, obligations, deadlines, and deal events.

Respond ONLY with valid JSON matching this schema:
{
  "deal": {
    "company": "tenant company name",
    "property": "property address or name",
    "stage": "one of: Prospect, Market Survey, Tour, LOI, Negotiation, Lease Execution, Closed"
  },
  "events": [
    {
      "type": "PROPOSAL_SENT | COUNTER_RECEIVED | LOI_SUBMITTED | LEASE_EXECUTED | TOUR_SCHEDULED | COMMITMENT_MADE | DEADLINE_SET | FOLLOW_UP_SENT | BOARD_MEETING_SCHEDULED | OTHER",
      "description": "concise description of what happened",
      "occurredAt": "ISO date string if detectable",
      "confidence": 0.0-1.0,
      "evidenceQuote": "exact quote from thread that supports this"
    }
  ],
  "obligations": [
    {
      "owner": "name of person responsible",
      "counterparty": "name of person waiting on this",
      "description": "what needs to happen",
      "dueAt": "ISO date string if a deadline is mentioned",
      "status": "OPEN | COMPLETED | OVERDUE | WAITING",
      "confidence": 0.0-1.0,
      "evidenceQuote": "exact quote from thread that supports this"
    }
  ],
  "nextAction": {
    "description": "the single most important thing that needs to happen next",
    "owner": "who needs to do it",
    "urgency": "LOW | MEDIUM | HIGH"
  }
}

Rules:
- Only extract what is explicitly stated or clearly implied.
- Confidence = 1.0 means explicitly stated; lower for inferred.
- evidenceQuote must be a verbatim excerpt from the thread.
- If a deadline has passed, mark status as OVERDUE.
- If waiting on a counterparty, mark status as WAITING.
- Never fabricate information not present in the thread.`;
