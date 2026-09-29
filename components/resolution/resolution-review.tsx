"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ObservationResolutionView } from "@/lib/resolution/types";
import type { CanonicalEntityPreview, RelationshipPromotionPreview } from "@/lib/promotion/types";

export function ResolutionReview({
  documentName,
  documentId,
  dealId,
  observations,
  relationships,
  counts,
  embedded = false,
  section = "all",
  focusId = null,
}: {
  documentName: string;
  documentId: string;
  dealId: string;
  observations: Array<
    ObservationResolutionView & {
      preview: CanonicalEntityPreview | null;
      closure: "UNREVIEWED" | "RESOLVED" | "LEFT_UNRESOLVED";
    }
  >;
  relationships: RelationshipPromotionPreview[];
  counts: {
    unresolved: number;
    resolved: number;
    leftUnresolved: number;
    ready: number;
    blocked: number;
    approved: number;
    acknowledgedBlocked: number;
  };
  embedded?: boolean;
  section?: "all" | "entities" | "relationships";
  focusId?: string | null;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [openRelationshipId, setOpenRelationshipId] = useState<string | null>(
    focusId && relationships.some((relationship) => relationship.relationshipObservationId === focusId)
      ? focusId
      : relationships[0]?.relationshipObservationId ?? null
  );
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`graph-observation-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [focusId]);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body: unknown = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Update failed");
    router.refresh();
  }

  async function decide(candidateId: string, action: "accept" | "reject") {
    setError(null);
    setPendingId(candidateId);
    try {
      await post(`/api/resolution-candidates/${candidateId}/${action}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Resolution update failed");
    } finally {
      setPendingId(null);
    }
  }

  async function createEntity(observationId: string) {
    setError(null);
    setPendingId(observationId);
    try {
      await post(`/api/observations/${observationId}/canonical-entity`);
      setConfirmingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Canonical entity could not be created");
    } finally {
      setPendingId(null);
    }
  }

  async function reviewRelationship(relationshipId: string, action: "approve" | "reject" | "acknowledge-blocked") {
    setError(null);
    setPendingId(relationshipId);
    try {
      await post(`/api/relationship-observations/${relationshipId}/${action}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Relationship update failed");
    } finally {
      setPendingId(null);
    }
  }

  async function closeEntity(observationId: string, action: "LEAVE_UNRESOLVED" | "REOPEN") {
    setError(null);
    setPendingId(observationId);
    try {
      await post(`/api/documents/${documentId}/entity-closure`, { observationId, action });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Entity review could not be saved");
    } finally {
      setPendingId(null);
    }
  }

  const showEntities = section === "all" || section === "entities";
  const showRelationships = section === "all" || section === "relationships";

  return (
    <div className="space-y-6" data-document={documentName}>
      {!embedded && (
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Graph review</p>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900">{documentName}</h1>
        <p className="mt-1 max-w-2xl text-xs text-zinc-500">
          A reviewer confirms every canonical record. Matching an observation or approving a relationship does not run by confidence.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-700">
          <p>
            <span className="font-medium">Entity resolution</span>
            <span className="ml-2 text-zinc-500">{counts.unresolved} unreviewed</span>
            <span className="ml-2 text-zinc-500">{counts.resolved} resolved</span>
            <span className="ml-2 text-zinc-500">{counts.leftUnresolved} left unresolved</span>
          </p>
          <p>
            <span className="font-medium">Relationship promotion</span>
            <span className="ml-2 text-zinc-500">{counts.ready} ready</span>
            <span className="ml-2 text-zinc-500">{counts.blocked} blocked</span>
            <span className="ml-2 text-zinc-500">{counts.acknowledgedBlocked} acknowledged blocked</span>
            <span className="ml-2 text-zinc-500">{counts.approved} approved</span>
          </p>
        </div>
        <a className="mt-2 inline-block text-[11px] text-zinc-600 underline" href={`/deals/${dealId}/knowledge`}>
          Deal knowledge
        </a>
      </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}

      {showEntities && <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Entity resolution</h2>
        <p className="text-[11px] text-zinc-500">{counts.unresolved} unreviewed · {counts.resolved} resolved · {counts.leftUnresolved} left unresolved</p>
        {observations.length === 0 ? (
          <p className="rounded-sm border border-zinc-200 bg-white px-4 py-6 text-xs text-zinc-500">
            This document has no person, company, or property observations yet.
          </p>
        ) : (
          observations.map((observation) => {
            const preview = observation.preview;
            const confirming = confirmingId === observation.observationId;
            return (
              <article id={`graph-observation-${observation.observationId}`} key={observation.observationId} className={`rounded-sm border bg-white ${focusId === observation.observationId ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200"}`}>
                <div className="border-b border-zinc-100 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-zinc-900">{observation.surfaceForm}</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      {observation.observedType}
                    </span>
                  </div>
                  <blockquote className="mt-2 border-l-2 border-zinc-200 pl-3 text-[11px] text-zinc-600">
                    {observation.evidenceQuote}
                  </blockquote>
                </div>
                <div className="px-4 py-3">
                  {preview?.alreadyResolved && (
                    <p className="text-xs text-zinc-600">Resolved to {preview.alreadyResolved.name}.</p>
                  )}
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Possible matches</p>
                  {observation.candidates.filter((candidate) => candidate.decision !== "REJECTED").length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500">No pending canonical match.</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {observation.candidates
                        .filter((candidate) => candidate.decision !== "REJECTED")
                        .map((candidate) => (
                          <li key={candidate.id} className="rounded-sm border border-zinc-100 px-3 py-2">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="text-sm font-medium text-zinc-900">
                                <span className="mr-2 tabular-nums text-zinc-500">{Math.round(candidate.score * 100)}%</span>
                                {candidate.candidate.name}
                              </p>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                                {candidate.decision}
                              </span>
                            </div>
                            {candidate.candidate.context && (
                              <p className="mt-0.5 text-[11px] text-zinc-500">{candidate.candidate.context}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="h-7 rounded-sm bg-zinc-900 px-2.5 text-[11px] font-medium text-white disabled:opacity-50"
                                disabled={pendingId !== null || candidate.decision === "ACCEPTED"}
                                onClick={() => decide(candidate.id, "accept")}
                              >
                                {candidate.decision === "ACCEPTED" ? "Resolved" : "Resolve"}
                              </button>
                              <button
                                type="button"
                                className="h-7 rounded-sm border border-zinc-200 px-2.5 text-[11px] font-medium text-zinc-700 disabled:opacity-50"
                                disabled={pendingId !== null || candidate.decision !== "PENDING"}
                                onClick={() => decide(candidate.id, "reject")}
                              >
                                Reject
                              </button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                  {preview && !preview.alreadyResolved && (
                    <div className="mt-3">
                      {!confirming ? (
                        <button
                          type="button"
                          className="h-7 rounded-sm border border-zinc-300 px-2.5 text-[11px] font-medium text-zinc-800"
                          onClick={() => setConfirmingId(observation.observationId)}
                        >
                          {preview.actionLabel}
                        </button>
                      ) : (
                        <div className="rounded-sm border border-zinc-200 px-3 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                            {preview.actionLabel}
                          </p>
                          <dl className="mt-2 space-y-1">
                            {preview.fields.map((field) => (
                              <div key={field.label} className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
                                <dt className="text-zinc-500">{field.label}</dt>
                                <dd className="text-zinc-900">
                                  {field.value}
                                  {field.note && <span className="mt-0.5 block text-[11px] text-zinc-500">{field.note}</span>}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {preview.blockedReason && (
                            <p className="mt-2 text-[11px] text-red-700">{preview.blockedReason}</p>
                          )}
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              className="h-7 rounded-sm px-2.5 text-[11px] font-medium text-zinc-600"
                              onClick={() => setConfirmingId(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="h-7 rounded-sm bg-zinc-900 px-2.5 text-[11px] font-medium text-white disabled:opacity-50"
                              disabled={pendingId !== null || Boolean(preview.blockedReason)}
                              onClick={() => createEntity(observation.observationId)}
                            >
                              {preview.actionLabel}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {observation.closure === "LEFT_UNRESOLVED" && (
                    <p className="mt-3 text-[11px] text-zinc-600">
                      Left unresolved. This observation stays available. No canonical record was created.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {observation.closure === "UNREVIEWED" && (
                      <button
                        type="button"
                        className="h-7 rounded-sm border border-zinc-200 px-2.5 text-[11px] font-medium text-zinc-700 disabled:opacity-50"
                        disabled={pendingId !== null}
                        onClick={() => closeEntity(observation.observationId, "LEAVE_UNRESOLVED")}
                      >
                        Leave unresolved
                      </button>
                    )}
                    {observation.closure === "LEFT_UNRESOLVED" && (
                      <button
                        type="button"
                        className="h-7 rounded-sm border border-zinc-200 px-2.5 text-[11px] font-medium text-zinc-700 disabled:opacity-50"
                        disabled={pendingId !== null}
                        onClick={() => closeEntity(observation.observationId, "REOPEN")}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>}

      {showRelationships && <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">Relationship promotion</h2>
        <p className="text-[11px] text-zinc-500">{counts.ready} pending review · {counts.blocked} blocked · {counts.acknowledgedBlocked} acknowledged blocked · {counts.approved} approved</p>
        {relationships.length === 0 ? (
          <p className="rounded-sm border border-zinc-200 bg-white px-4 py-6 text-xs text-zinc-500">
            This document has no relationship observations yet.
          </p>
        ) : (
          relationships.map((relationship) => {
            const open = openRelationshipId === relationship.relationshipObservationId;
            return (
              <article id={`graph-observation-${relationship.relationshipObservationId}`} key={relationship.relationshipObservationId} className={`rounded-sm border bg-white ${focusId === relationship.relationshipObservationId ? "border-zinc-900 ring-2 ring-zinc-900" : "border-zinc-200"}`}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left"
                  onClick={() =>
                    setOpenRelationshipId(open ? null : relationship.relationshipObservationId)
                  }
                >
                  <span className="text-sm font-medium text-zinc-900">{relationship.headline}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    {relationshipStatusLabel(relationship.status)}
                  </span>
                </button>
                {open && (
                  <div className="space-y-3 border-t border-zinc-100 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Source</p>
                      <blockquote className="mt-1 border-l-2 border-zinc-200 pl-3 text-[11px] text-zinc-600">
                        {relationship.evidenceQuote}
                      </blockquote>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {relationship.documentName ?? relationship.sourceKind}
                        {relationship.provenanceStatus === "EXACT" && relationship.pageNumber
                          ? ` · Page ${relationship.pageNumber}`
                          : ""}
                        {relationship.provenanceStatus === "AMBIGUOUS" ? " · Ambiguous page" : ""}
                        {relationship.provenanceStatus === "UNLOCATED" ? " · Unlocated" : ""}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Resolved endpoints</p>
                      <ul className="mt-1 space-y-1 text-xs text-zinc-700">
                        {relationship.endpoints.map((endpoint) => (
                          <li key={endpoint.observationId}>
                            {endpoint.role}: {endpoint.resolved ? endpoint.entityName : endpoint.closure === "LEFT_UNRESOLVED" ? `${endpoint.surfaceForm} (left unresolved)` : `${endpoint.surfaceForm} (unresolved)`}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Proposed canonical assertion
                      </p>
                      <dl className="mt-1 space-y-1">
                        {relationship.assertionLines.map((line) => (
                          <div key={line.label} className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
                            <dt className="text-zinc-500">{line.label}</dt>
                            <dd className="text-zinc-900">{line.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    {relationship.existingAssertion && (
                      <p className="text-[11px] text-zinc-600">{relationship.existingAssertion.summary}</p>
                    )}
                    {relationship.conflicts.map((conflict) => (
                      <p key={conflict.message} className="text-[11px] text-amber-800">
                        {conflict.message}
                      </p>
                    ))}
                    {relationship.status === "BLOCKED_UNRESOLVED_ENTITY" && (
                      <p className="text-[11px] font-medium text-amber-800">
                        BLOCKED — unresolved endpoint
                        {relationship.endpoints.some((endpoint) => endpoint.closure === "LEFT_UNRESOLVED")
                          ? `. ${relationship.endpoints
                              .filter((endpoint) => endpoint.closure === "LEFT_UNRESOLVED")
                              .map((endpoint) => endpoint.surfaceForm)
                              .join(", ")} left unresolved.`
                          : ""}
                      </p>
                    )}
                    {relationship.status === "ACKNOWLEDGED_BLOCKED" && (
                      <p className="text-[11px] text-zinc-600">
                        Acknowledged blocked. No canonical relationship was created.
                      </p>
                    )}
                    {relationship.blockReason && relationship.status !== "APPROVED" && (
                      <p className="text-[11px] text-zinc-600">{relationship.blockReason}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="h-7 rounded-sm bg-zinc-900 px-2.5 text-[11px] font-medium text-white disabled:opacity-50"
                        disabled={pendingId !== null || !relationship.canApprove}
                        onClick={() => reviewRelationship(relationship.relationshipObservationId, "approve")}
                      >
                        {relationship.status === "APPROVED" ? "Approved" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="h-7 rounded-sm border border-zinc-200 px-2.5 text-[11px] font-medium text-zinc-700 disabled:opacity-50"
                        disabled={pendingId !== null || relationship.status === "APPROVED" || relationship.status === "REJECTED"}
                        onClick={() => reviewRelationship(relationship.relationshipObservationId, "reject")}
                      >
                        Reject
                      </button>
                      {relationship.status === "BLOCKED_UNRESOLVED_ENTITY" && (
                        <button
                          type="button"
                          className="h-7 rounded-sm border border-zinc-200 px-2.5 text-[11px] font-medium text-zinc-700 disabled:opacity-50"
                          disabled={pendingId !== null}
                          onClick={() => reviewRelationship(relationship.relationshipObservationId, "acknowledge-blocked")}
                        >
                          Acknowledge blocked
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>}
      {embedded && (
        <a className="inline-block text-[11px] text-zinc-600 underline" href={`/deals/${dealId}/knowledge`}>
          Deal knowledge
        </a>
      )}
    </div>
  );
}

function relationshipStatusLabel(status: RelationshipPromotionPreview["status"]): string {
  if (status === "BLOCKED_UNRESOLVED_ENTITY") return "BLOCKED";
  if (status === "ACKNOWLEDGED_BLOCKED") return "ACKNOWLEDGED BLOCKED";
  if (status === "PENDING") return "PENDING REVIEW";
  return status;
}
