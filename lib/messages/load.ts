import type { GraphDb } from "@/lib/entities/workspace";
import type { ReconciliationActivity, ReconciliationSide } from "@/lib/deals/reconciliation/types";
import { factsFromLatestRun } from "./latestRun";
import { toStructuredFact } from "./facts";

const factInclude = {
  activityExtractionRun: {
    select: { id: true, status: true, completedAt: true, createdAt: true },
  },
} as const;

export async function loadDealMessageSources(db: GraphDb, workspaceId: string, dealIds: string[]) {
  if (dealIds.length === 0) return { messages: [], eventFacts: [] };
  const [messages, eventFacts] = await Promise.all([
    db.sourceMessage.findMany({
      where: { workspaceId, dealId: { in: dealIds } },
      include: { facts: { include: factInclude } },
      orderBy: [{ sentAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    db.activityFact.findMany({
      where: { workspaceId, dealId: { in: dealIds }, dealEventId: { not: null }, sourceMessageId: null },
      include: factInclude,
    }),
  ]);
  return { messages, eventFacts };
}

type LoadedMessages = Awaited<ReturnType<typeof loadDealMessageSources>>["messages"];
type LoadedEventFacts = Awaited<ReturnType<typeof loadDealMessageSources>>["eventFacts"];

export function linkedLegacyEventIds(messages: Array<{ legacyDealEventId: string | null }>): Set<string> {
  return new Set(messages.flatMap((message) => message.legacyDealEventId ? [message.legacyDealEventId] : []));
}

export function eventFactsByEventId(facts: LoadedEventFacts) {
  const grouped = new Map<string, LoadedEventFacts>();
  for (const fact of facts) {
    if (!fact.dealEventId) continue;
    const group = grouped.get(fact.dealEventId) ?? [];
    group.push(fact);
    grouped.set(fact.dealEventId, group);
  }
  return grouped;
}

function sideOf(value: string): ReconciliationSide {
  return value === "LANDLORD" || value === "TENANT" ? value : "UNKNOWN";
}

export function messageActivities(messages: LoadedMessages): ReconciliationActivity[] {
  return messages.map((message) => {
    const facts = factsFromLatestRun(message.facts);
    const occurredAt = message.sentAt ?? message.receivedAt ?? message.createdAt;
    return {
      id: message.id,
      dealId: message.dealId,
      type: "EMAIL",
      description: message.subject ?? "Email",
      evidenceQuote: message.bodyText,
      occurredAt,
      messageId: null,
      message: message.senderAddress || message.senderName
        ? { sender: message.senderName ?? message.senderAddress ?? "Email", sentAt: occurredAt }
        : null,
      sourceMessageId: message.id,
      structuredFacts: facts.map((fact) => toStructuredFact(fact)),
    };
  });
}

export function structuredFactsForEvent(facts: LoadedEventFacts) {
  const latest = factsFromLatestRun(facts);
  if (latest.length === 0) return undefined;
  return latest.map((fact) => ({ ...toStructuredFact(fact), side: sideOf(fact.side) }));
}
