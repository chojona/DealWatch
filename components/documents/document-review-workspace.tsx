"use client";

import Link from "next/link";
import { ResolutionReview } from "@/components/resolution/resolution-review";
import { RetryAnalysisButton } from "@/components/inbox/retry-button";
import {
  AnalyzeDocumentButton,
  conflictReviewTarget,
  EvidenceLocateButton,
  findingReviewTarget,
  FormalTermReviewControls,
  MetadataEditor,
  ReviewDecisionButtons,
  SourceReplacementForm,
  DemoResetButton,
} from "@/components/documents/review-actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DOCUMENT_TYPE_LABELS } from "@/lib/documents/labels";
import { needsStoredPageExtraction, readinessGuidance } from "@/lib/documents/readinessCopy";
import type { ReadinessGapCode } from "@/lib/documents/readiness";
import { formatCalendarDate, formatDateTime } from "@/lib/formatters";
import { processingLabel } from "@/lib/inbox/status";
import type { DocumentReviewModel } from "@/lib/inbox/types";
import type { ReviewHistory } from "@/lib/review/history";
import type { CanonicalEntityPreview, RelationshipPromotionPreview } from "@/lib/promotion/types";
import type { ObservationResolutionView } from "@/lib/resolution/types";

function sideLabel(side: string | null): string {
  if (side === "LANDLORD") return "Landlord";
  if (side === "TENANT") return "Tenant";
  return "Not set";
}

export function DocumentReviewWorkspace({
  review,
  observations,
  relationships,
  counts,
  history,
  allowSourceReplacement,
  allowDemoReset,
}: {
  review: DocumentReviewModel;
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
  history: ReviewHistory;
  allowSourceReplacement: boolean;
  allowDemoReset: boolean;
}) {
  const item = review.item;
  const progress = review.progress;
  const unresolvedNames = relationships
    .filter((relationship) => relationship.status === "BLOCKED_UNRESOLVED_ENTITY")
    .flatMap((relationship) => relationship.endpoints.filter((endpoint) => !endpoint.resolved).map((endpoint) => endpoint.surfaceForm));

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs text-zinc-400">
        <Link href="/inbox" className="hover:text-zinc-700">Inbox</Link>
        <span> / </span>
        <Link href={item.dealHref} className="hover:text-zinc-700">{item.deal.name}</Link>
        <span> / </span>
        <span className="text-zinc-600">{item.document.originalFilename}</span>
      </div>

      <div className="rounded-sm border border-zinc-200 bg-white px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Document review</p>
            <h1 className="mt-1 text-lg font-semibold text-zinc-900">{item.document.originalFilename}</h1>
            <p className="mt-1 text-sm text-zinc-600">{item.deal.name}</p>
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700">
            {processingLabel(item.processingStatus)}
          </p>
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <Fact label="Document type" value={DOCUMENT_TYPE_LABELS[item.document.documentType] ?? item.document.documentType} />
          <Fact label="Authoring side" value={sideLabel(item.document.negotiationSide)} />
          <Fact label="Document date" value={item.documentDate ? formatCalendarDate(item.documentDate) : "Not set"} />
          <Fact label="Uploaded" value={formatDateTime(item.uploadedAt)} />
          <Fact label="Pages" value={item.document.pageCount === null ? "Unknown" : String(item.document.pageCount)} />
          <Fact label="Analysis" value={item.document.ingestionStatus} />
          <Fact label="Graph extraction" value={item.document.graphExtractionStatus} />
          <Fact label="File" value={review.fileAvailable ? "Stored PDF available" : "Stored PDF is missing"} />
          <Fact
            label="Duplicate"
            value={item.document.duplicateDocumentIds.length > 0 ? `Same file also stored on ${item.document.duplicateDocumentIds.length} other document${item.document.duplicateDocumentIds.length === 1 ? "" : "s"}` : "No other copy in this workspace"}
          />
        </dl>
        <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
          {item.pdfHref ? (
            <a href={item.pdfHref} target="_blank" rel="noreferrer" className="underline">Open PDF</a>
          ) : (
            <span className="text-zinc-500">PDF unavailable</span>
          )}
          <Link href={item.dealHref} className="underline">Open deal</Link>
          <Link href={item.negotiationHref} className="underline">View negotiation</Link>
          <Link href={item.activityHref} className="underline">View activity</Link>
          <Link href={item.knowledgeHref} className="underline">Knowledge</Link>
          <Link href={item.connectionsHref} className="underline">Connections</Link>
        </div>
      </div>

      {review.promotionSources.length > 0 && (
        <section className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Source</h2>
          {review.promotionSources.map((source) => (
            <dl key={source.attachmentId} className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <Fact label="Source" value="Email attachment" />
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Message</dt>
                <dd className="mt-0.5 text-zinc-800">
                  <Link href={source.messageHref} className="underline">{source.messageSubject || "Email"}</Link>
                </dd>
              </div>
              <Fact label="Attachment" value={source.attachmentFilename} />
            </dl>
          ))}
        </section>
      )}

      <section className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Document review</h2>
        <div className="mt-2 grid gap-2 text-xs text-zinc-700 sm:grid-cols-2">
          <p>Source · {progress.sourceReady ? "✓" : "–"} {progress.sourceLabel}</p>
          <p>Metadata · {progress.metadataReady ? "✓" : "–"} {progress.metadataLabel}</p>
          <p>Analysis · {progress.analysisLabel}</p>
          <p>Negotiation · {progress.negotiationTotal === 0 ? "No negotiation terms" : `${progress.negotiationReviewed} / ${progress.negotiationTotal} reviewed`}</p>
          <p>Entities · {progress.entitiesTotal === 0 ? "No entities" : `${progress.entitiesAddressed} / ${progress.entitiesTotal} closed`}</p>
          <p>Relationships · {progress.relationshipsTotal === 0 ? "No relationships" : `${progress.relationshipsReviewed} / ${progress.relationshipsTotal} reviewed`}</p>
          <p>Evidence · {progress.evidenceTotal === 0 ? "No issues" : `${progress.evidenceReviewed} / ${progress.evidenceTotal} ${progress.evidenceTotal === 1 ? "issue" : "issues"} reviewed`}</p>
        </div>
        <p className="mt-2 text-xs font-medium text-zinc-900">Overall · {processingLabel(progress.overall)}</p>
        {item.processingStatus === "REVIEWED" && <ReviewedBanner item={item} />}
        {item.entityReviewSummary.unresolved > 0 && relationships.some((relationship) => relationship.status === "BLOCKED_UNRESOLVED_ENTITY") && (
          <p className="mt-2 text-xs text-amber-800">
            {item.entityReviewSummary.unresolved} {item.entityReviewSummary.unresolved === 1 ? "entity" : "entities"} unresolved
            <span className="mx-2 text-zinc-400">↓</span>
            {counts.blocked} {counts.blocked === 1 ? "relationship" : "relationships"} blocked
            {unresolvedNames.length > 0 ? ` · resolve ${[...new Set(unresolvedNames)].join(", ")} first` : ""}
          </p>
        )}
      </section>

      {(item.processingStatus === "FAILED") && (
        <section className="rounded-sm border border-red-200 bg-red-50 px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-red-700">Failed</h2>
          <p className="mt-1 text-sm text-red-900">
            {item.document.failureReason ?? item.document.graphFailureReason ?? (!review.fileAvailable ? "The stored PDF file is missing." : "This document failed processing.")}
          </p>
          {item.document.graphFailureReason && item.document.failureReason && (
            <p className="mt-1 text-xs text-red-800">{item.document.graphFailureReason}</p>
          )}
          {item.canRetry && <div className="mt-3"><RetryAnalysisButton documentId={item.document.id} /></div>}
        </section>
      )}
      {!review.fileAvailable && (
        <p className="rounded-sm border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-800">
          Original PDF required.
          {item.document.pageCount && item.document.ingestionStatus !== "UPLOADED"
            ? " Text was extracted, but the original PDF is unavailable."
            : " Upload the original PDF before analysis."}
        </p>
      )}
      {allowSourceReplacement && !review.fileAvailable && (
        <SourceReplacementForm documentId={item.document.id} />
      )}

      <MetadataEditor
        documentId={item.document.id}
        documentType={item.document.documentType}
        negotiationSide={item.document.negotiationSide}
        documentDate={item.document.documentDate}
        originalFilename={item.document.originalFilename}
        locked={review.findings.length > 0}
      />

      {review.readiness.analysisReady && item.processingStatus !== "FAILED" && (
        <section className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Ready to analyze</h2>
          <p className="mt-1 text-xs text-zinc-600">Side, date, source file, and extracted pages are stored. Analysis uses the existing pipeline.</p>
          <div className="mt-3"><AnalyzeDocumentButton documentId={item.document.id} ready /></div>
        </section>
      )}
      {!review.readiness.analysisReady && !review.readiness.reviewReady && item.processingStatus !== "FAILED" && item.processingStatus !== "ANALYZING" && review.readiness.missing.length > 0 && (
        <section className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Analysis unavailable</h2>
          <p className="mt-1 text-xs text-zinc-600">{needsStoredPageExtraction(review.readiness, item.document.ingestionStatus) ? "Metadata is stored. Analyze document extracts the stored PDF, then runs the existing analysis pipeline." : "Analyze stays unavailable until every requirement below is stored."}</p>
          {needsStoredPageExtraction(review.readiness, item.document.ingestionStatus) && (
            <div className="mt-3"><AnalyzeDocumentButton documentId={item.document.id} ready /></div>
          )}
          <ul className="mt-3 space-y-2">
            {review.readiness.missing.map((gap) => {
              const guidance = readinessGuidance(gap.code as ReadinessGapCode, item.sourceFileState);
              return (
                <li key={gap.code}>
                  <p className="text-xs font-medium text-zinc-900">{guidance.title}</p>
                  <p className="text-[11px] text-zinc-600">{guidance.action}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {item.processingStatus === "ANALYZING" && (
        <p className="rounded-sm border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">Analyzing</p>
      )}
      {review.readiness.reviewReady && (
        <p className="rounded-sm border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">Analysis complete</p>
      )}
      {review.readiness.reviewReady && <CompletionSummary review={review} />}
      {allowDemoReset && <DemoResetButton documentId={item.document.id} />}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="negotiation">Negotiation</TabsTrigger>
          <TabsTrigger value="entities">Entities</TabsTrigger>
          <TabsTrigger value="relationships">Relationships</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="rounded-sm border border-zinc-200 bg-white px-4 py-4 text-xs text-zinc-600">
            {item.requiresReview ? (
              <ul className="space-y-1">
                {item.reviewReasons.map((reason) => (
                  <li key={reason}>{reasonLabel(reason)}</li>
                ))}
              </ul>
            ) : item.processingStatus === "REVIEWED" ? (
              <p>Nothing on this document currently requires review.</p>
            ) : (
              <p>Review starts after analysis is stored. Counts above are from records already on the document.</p>
            )}
            {review.deletionBlocked && (
              <p className="mt-3 text-zinc-500">This document is referenced by graph observations and cannot be deleted.</p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="negotiation">
          {review.findings.length === 0 ? (
            <p className="rounded-sm border border-zinc-200 bg-white px-4 py-6 text-xs text-zinc-500">
              This document has no stored negotiation terms.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {review.conflicts.map((conflict) => (
                <article key={conflict.canonicalType} className="rounded-sm border border-red-200 bg-white px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-zinc-900">{conflict.label}</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-red-700">Conflict</span>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-zinc-700">
                    {conflict.candidates.map((candidate) => <li key={candidate}>Candidate: {candidate}</li>)}
                  </ul>
                  <ReviewDecisionButtons documentId={item.document.id} target={conflictReviewTarget(conflict)} reviewState={conflict.reviewState} />
                  <p className="mt-1 text-[11px] text-zinc-500">Acknowledging a conflict does not choose a value.</p>
                </article>
              ))}
              {review.findings.map((finding) => (
                <article key={finding.termId} className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold text-zinc-900">{finding.label}</h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{finding.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600">{sideLabel(finding.side)} proposed</p>
                  <p className="mt-1 text-sm text-zinc-900">{finding.formattedValue}</p>
                  <p className="mt-1 text-xs text-zinc-700">{finding.impactLabel}</p>
                  {finding.structuredDetails && finding.structuredDetails.length > 0 && (
                    <dl className="mt-2 space-y-1">
                      {finding.structuredDetails.map((detail) => (
                        <div key={detail.label} className="grid grid-cols-[8rem_1fr] gap-2 text-[11px]">
                          <dt className="text-zinc-500">{detail.label}</dt>
                          <dd className="text-zinc-800">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <blockquote className="mt-2 border-l-2 border-zinc-200 pl-3 text-[11px] text-zinc-600">
                    {finding.evidenceQuote}
                  </blockquote>
                  <FormalTermReviewControls documentId={item.document.id} finding={finding} />
                  {finding.activeCorrectionId && (
                    <p className="mt-1 text-[11px] text-zinc-500">Original model quote: {finding.originalEvidenceQuote}</p>
                  )}
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {finding.pageLabel ?? provenanceLabel(finding.provenanceStatus)}
                  </p>
                  {finding.provenanceStatus === "EXACT" && finding.pageNumber && item.pdfHref && (
                    <a href={`${item.pdfHref}#page=${finding.pageNumber}`} target="_blank" rel="noreferrer" className="text-[11px] underline">Open page</a>
                  )}
                  {finding.originalProvenanceStatus === "AMBIGUOUS" && !finding.activeCorrectionId && (
                    <p className="mt-1 text-[11px] text-amber-800">Evidence appears in multiple locations.</p>
                  )}
                  {finding.originalProvenanceStatus === "UNLOCATED" && !finding.activeCorrectionId && (
                    <p className="mt-1 text-[11px] text-amber-800">DealWatch could not locate this quote in the source document.</p>
                  )}
                  {(finding.originalProvenanceStatus === "AMBIGUOUS" || finding.originalProvenanceStatus === "UNLOCATED") && (
                    <EvidenceLocateButton
                      documentId={item.document.id}
                      termId={finding.termId}
                      pages={review.pages}
                      label={finding.originalProvenanceStatus === "AMBIGUOUS" ? "Correct evidence" : "Locate evidence"}
                    />
                  )}
                  <ReviewDecisionButtons documentId={item.document.id} target={findingReviewTarget(finding)} reviewState={finding.reviewState} />
                </article>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="entities">
          <ResolutionReview
            embedded
            section="entities"
            documentName={item.document.originalFilename}
            documentId={item.document.id}
            dealId={item.deal.id}
            observations={observations}
            relationships={relationships}
            counts={counts}
          />
        </TabsContent>
        <TabsContent value="relationships">
          <ResolutionReview
            embedded
            section="relationships"
            documentName={item.document.originalFilename}
            documentId={item.document.id}
            dealId={item.deal.id}
            observations={observations}
            relationships={relationships}
            counts={counts}
          />
        </TabsContent>
        <TabsContent value="evidence">
          <div className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs text-zinc-600">
              Corrections are checked against extracted page text. The original model quote stays stored.
            </p>
            {review.evidence.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">This document has no stored evidence quotes.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {review.evidence.map((record) => (
                  <li key={`${record.kind}-${record.id}`} className="border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      {record.kind} · {provenanceLabel(record.provenanceStatus)}
                    </p>
                    <p className="mt-1 text-xs font-medium text-zinc-800">{record.label}</p>
                    <blockquote className="mt-1 border-l-2 border-zinc-200 pl-3 text-[11px] text-zinc-600">{record.quote}</blockquote>
                    {record.href ? (
                      <a href={record.href} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] underline">
                        Page {record.pageNumber} · Exact match
                      </a>
                    ) : (
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {record.provenanceStatus === "EXACT" && record.pageNumber
                          ? `Page ${record.pageNumber} · Exact match. The original PDF is unavailable.`
                          : record.provenanceStatus === "AMBIGUOUS"
                            ? "Evidence appears in multiple locations."
                            : record.provenanceStatus === "UNLOCATED"
                              ? "DealWatch could not locate this quote in the source document."
                              : "No exact page is stored."}
                      </p>
                    )}
                    {(record.originalProvenanceStatus === "AMBIGUOUS" || record.originalProvenanceStatus === "UNLOCATED") && (
                      <ReviewDecisionButtons
                        documentId={item.document.id}
                        reviewState={record.reviewState}
                        target={record.kind === "TERM"
                          ? { kind: "EVIDENCE", evidenceKind: "TERM", id: record.id }
                          : record.kind === "ENTITY"
                            ? { kind: "EVIDENCE", evidenceKind: "ENTITY", id: record.id }
                            : { kind: "EVIDENCE", evidenceKind: "RELATIONSHIP", id: record.id }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>
      <ReviewHistoryList history={history} />
    </div>
  );
}

function ReviewedBanner({ item }: { item: DocumentReviewModel["item"] }) {
  return (
    <div className="mt-4 rounded-sm border border-zinc-300 bg-zinc-50 px-3 py-3">
      <p className="text-sm font-semibold text-zinc-900">Review complete</p>
      <p className="mt-1 text-xs text-zinc-600">
        This document has been reviewed. Review completion does not imply that every observation was promoted to canonical knowledge.
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        <Link href={item.negotiationHref} className="underline">Negotiation</Link>
        <Link href={item.knowledgeHref} className="underline">Knowledge</Link>
        <Link href={item.connectionsHref} className="underline">Connection Map</Link>
        <Link href={item.activityHref} className="underline">Activity</Link>
        <Link href={item.dealHref} className="underline">Deal</Link>
      </div>
    </div>
  );
}

function CompletionSummary({ review }: { review: DocumentReviewModel }) {
  const summary = review.completion;
  const complete = summary.result === "REVIEWED";
  return (
    <section className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {complete ? "Review complete" : "Review progress"}
      </h2>
      <div className="mt-3 space-y-3 text-xs text-zinc-800">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Negotiation</p>
          <p className="mt-1">✓ {summary.findingsReviewed} findings reviewed</p>
          <p>✓ {summary.conflictsAcknowledged} {summary.conflictsAcknowledged === 1 ? "conflict" : "conflicts"} acknowledged</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Knowledge</p>
          <p className="mt-1">✓ {summary.entitiesResolved} {summary.entitiesResolved === 1 ? "entity" : "entities"} resolved</p>
          <p>✓ {summary.entitiesLeftUnresolved} {summary.entitiesLeftUnresolved === 1 ? "entity" : "entities"} intentionally left unresolved</p>
          <p>✓ {summary.relationshipsApproved} {summary.relationshipsApproved === 1 ? "relationship" : "relationships"} approved</p>
          <p>✓ {summary.relationshipsRejected} {summary.relationshipsRejected === 1 ? "relationship" : "relationships"} rejected</p>
          <p>✓ {summary.relationshipsAcknowledgedBlocked} blocked {summary.relationshipsAcknowledgedBlocked === 1 ? "relationship" : "relationships"} acknowledged</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Evidence</p>
          <p className="mt-1">✓ {summary.evidenceExact} exact</p>
          <p>✓ {summary.evidenceCorrected} manually corrected</p>
          <p>✓ {summary.ambiguityAcknowledged} {summary.ambiguityAcknowledged === 1 ? "ambiguity" : "ambiguities"} acknowledged</p>
        </div>
        <p className="font-medium text-zinc-900">Result {processingLabel(summary.result)}</p>
      </div>
    </section>
  );
}

function ReviewHistoryList({ history }: { history: ReviewHistory }) {
  return (
    <section className="rounded-sm border border-zinc-200 bg-white px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Review history</h2>
      {history.entries.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">No review history yet.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {history.entries.map((entry) => (
            <li key={entry.id} className="text-xs text-zinc-800">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{entry.dateLabel}</p>
              <p>{entry.label}</p>
              <p className="text-[11px] text-zinc-500">{entry.actorLabel}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-zinc-800">{value}</dd>
    </div>
  );
}

function reasonLabel(reason: string): string {
  if (reason === "UNRESOLVED_ENTITIES") return "Unresolved entity observations";
  if (reason === "UNRESOLVED_RELATIONSHIPS") return "Relationships are waiting for review";
  if (reason === "NEGOTIATION_CONFLICT") return "Negotiation conflict is waiting for review";
  if (reason === "NEGOTIATION_REVIEW_PENDING") return "Negotiation findings are waiting for review";
  if (reason === "NEGOTIATION_FOLLOW_UP") return "A review was flagged for follow-up";
  if (reason === "AMBIGUOUS_PROVENANCE") return "Ambiguous provenance";
  if (reason === "UNLOCATED_PROVENANCE") return "Unlocated provenance";
  return reason;
}

function provenanceLabel(status: string | null): string {
  if (status === "EXACT") return "Exact";
  if (status === "AMBIGUOUS") return "Ambiguous";
  if (status === "UNLOCATED") return "Unlocated";
  return "Provenance not stored";
}
