import type { EvidenceView } from "@/lib/promotion/types";
import { activityEvidenceSupport, observationOccurredAt, type ActivityEvidenceObservation, sentence } from "./documents";
import type { ActivityEntityRef, ActivityEvent, ActivityEventType } from "./types";

export interface CanonicalRelationshipActivityInput {
  id: string;
  eventType: ActivityEventType;
  title: string;
  description?: string;
  validFrom: Date | null;
  validTo: Date | null;
  createdAt: Date;
  supports: ActivityEvidenceObservation[];
  refs: ActivityEntityRef[];
  dealId?: string;
}

function newestEvidenceDate(supports: ActivityEvidenceObservation[]): string | null {
  return supports
    .map(observationOccurredAt)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function buildCanonicalRelationshipEvent(input: CanonicalRelationshipActivityInput): ActivityEvent | null {
  if (input.supports.length === 0 && !input.validFrom && !input.validTo) return null;
  const evidence: EvidenceView | undefined = input.supports.length
    ? {
        title: input.title,
        supportCount: input.supports.length,
        supports: input.supports.map(activityEvidenceSupport),
      }
    : undefined;
  const occurredAt = input.validFrom?.toISOString() ?? newestEvidenceDate(input.supports);
  const exactPageIds = [...new Set(input.supports.filter((support) => support.provenanceStatus === "EXACT" && support.documentPageId).map((support) => support.documentPageId!))];
  const documentIds = [...new Set(input.supports.map((support) => support.document?.id ?? support.documentId).filter((id): id is string => Boolean(id)))];
  return {
    id: `relationship:${input.eventType}:${input.id}`,
    occurredAt,
    recordedAt: input.createdAt.toISOString(),
    eventType: input.eventType,
    title: input.title,
    description: input.description ?? validityDescription(input.validFrom, input.validTo),
    entityRefs: input.refs,
    ...(input.dealId ? { dealId: input.dealId } : {}),
    ...(documentIds.length === 1 ? { documentId: documentIds[0] } : {}),
    ...(exactPageIds.length === 1 ? { documentPageId: exactPageIds[0] } : {}),
    ...(evidence ? { evidence } : {}),
    sourceType: "CANONICAL_ASSERTION",
    sourceId: input.id,
    resolutionState: "CONFIRMED",
    dedupeKey: `canonical:${input.eventType}:${input.id}`,
  };
}

function validityDescription(validFrom: Date | null, validTo: Date | null): string | undefined {
  if (!validFrom && !validTo) return undefined;
  const format = (value: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(value);
  return `${validFrom ? `Valid from ${format(validFrom)}` : "Start date unknown"}${validTo ? ` through ${format(validTo)}` : ""}`;
}

export function buildEntityObservationEvents(
  rows: Array<ActivityEvidenceObservation & {
    createdAt: Date;
    surfaceForm: string;
    dealId: string | null;
    resolutionState: "CONFIRMED" | "PENDING";
  }>,
  refsForRow: (row: (typeof rows)[number]) => ActivityEntityRef[],
  dealIdForRow: (row: (typeof rows)[number]) => string | undefined
): ActivityEvent[] {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const source = row.documentId ? `document:${row.documentId}` : row.messageId ? `message:${row.messageId}` : `observation:${row.id}`;
    const key = `${row.resolutionState}:${source}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const first = group[0]!;
    const names = [...new Set(group.map((row) => row.surfaceForm))];
    const state = first.resolutionState;
    const supports = group.map(activityEvidenceSupport);
    const occurredAt = newestEvidenceDate(group);
    const sourceName = first.document?.originalFilename ?? (first.messageId ? "message" : "stored observation");
    return {
      id: `entity-evidence:${key}`,
      occurredAt,
      recordedAt: [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!.createdAt.toISOString(),
      eventType: "ENTITY_EVIDENCE",
      title: state === "PENDING" ? "Pending entity evidence" : names.length === 1 ? `${names[0]} confirmed in ${sourceName}` : `Confirmed entities in ${sourceName}`,
      description: state === "PENDING" ? `${names.join(", ")} · unresolved extraction, not canonical truth` : names.join(", "),
      entityRefs: uniqueRefs(group.flatMap(refsForRow)),
      ...(dealIdForRow(first) ? { dealId: dealIdForRow(first) } : {}),
      ...(first.documentId ? { documentId: first.documentId } : {}),
      evidence: { title: state === "PENDING" ? "Unresolved extracted mentions" : "Accepted entity resolution", supportCount: supports.length, supports },
      sourceType: "ENTITY_OBSERVATION",
      sourceId: first.id,
      resolutionState: state,
      dedupeKey: `entity-evidence:${key}`,
    };
  });
}

export function buildPendingRelationshipEvents(rows: Array<ActivityEvidenceObservation & {
  createdAt: Date;
  predicate: string;
  dealId: string | null;
  contextDealId: string | null;
  subjectObservation: { surfaceForm: string };
  objectObservation: { surfaceForm: string } | null;
}>, refsForDeal: (dealId: string) => ActivityEntityRef[]): ActivityEvent[] {
  return rows.map((row) => {
    const support = activityEvidenceSupport(row);
    const dealId = row.contextDealId ?? row.dealId ?? undefined;
    return {
      id: `pending-relationship:${row.id}`,
      occurredAt: observationOccurredAt(row),
      recordedAt: row.createdAt.toISOString(),
      eventType: "RELATIONSHIP_EVIDENCE",
      title: `Pending relationship evidence: ${sentence(row.predicate)}`,
      description: `${row.subjectObservation.surfaceForm}${row.objectObservation ? ` → ${row.objectObservation.surfaceForm}` : ""} · unresolved extraction, not canonical truth`,
      entityRefs: dealId ? refsForDeal(dealId) : [],
      ...(dealId ? { dealId } : {}),
      ...(row.documentId ? { documentId: row.documentId } : {}),
      ...(row.provenanceStatus === "EXACT" && row.documentPageId ? { documentPageId: row.documentPageId } : {}),
      evidence: { title: "Pending relationship observation", supportCount: 1, supports: [support] },
      sourceType: "RELATIONSHIP_OBSERVATION",
      sourceId: row.id,
      resolutionState: "PENDING",
      dedupeKey: `pending-relationship:${row.id}`,
    };
  });
}

function uniqueRefs(refs: ActivityEntityRef[]): ActivityEntityRef[] {
  return [...new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values()];
}
