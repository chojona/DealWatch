export type ObligationStatus = "OPEN" | "COMPLETED" | "OVERDUE" | "WAITING";
export type DealStatus = "ACTIVE" | "CLOSED" | "DEAD";
export type Urgency = "LOW" | "MEDIUM" | "HIGH";

export interface AnalyzeThreadInput {
  threadText: string;
  dealId?: string;
}

export interface AnalyzeThreadOutput {
  deal: {
    company?: string;
    property?: string;
    stage?: string;
  };
  events: Array<{
    type: string;
    description: string;
    occurredAt?: string;
    confidence: number;
    evidenceQuote: string;
  }>;
  obligations: Array<{
    owner: string;
    counterparty?: string;
    description: string;
    dueAt?: string;
    status: ObligationStatus;
    confidence: number;
    evidenceQuote: string;
  }>;
  nextAction?: {
    description: string;
    owner: string;
    urgency: Urgency;
  };
}
