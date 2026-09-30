import type { ReactNode } from "react";
import Link from "next/link";
import { EvidencePanel } from "@/components/knowledge/evidence-panel";
import { StatusChip } from "@/components/ui/status-chip";
import { ReconciliationBadge } from "@/components/deals/reconciliation-context";
import type { DealIntelligence, DealParty } from "@/lib/deals/intelligence/types";
import { intelligenceStatusLabel } from "@/lib/deals/intelligence/project";
import type { NegotiationEvidenceView, NegotiationPositionView } from "@/lib/negotiation/intelligence/types";
import type { EvidenceView } from "@/lib/promotion/types";
import { NO_DOCUMENTARY_SUPPORT } from "@/lib/graph/path-types";

function utcDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function sideLabel(side: string | null): string {
  if (side === "TENANT") return "Tenant";
  if (side === "LANDLORD") return "Landlord";
  return side ?? "—";
}

function StatusPill({ status }: { status: string }) {
  return <StatusChip status={status}>{status}</StatusChip>;
}

function PositionText({ position }: { position: NegotiationPositionView | null }) {
  if (!position) return <span className="text-zinc-300">—</span>;
  if (position.kind === "CONFLICT") {
    return (
      <div>
        <p className="text-[11px] font-semibold text-red-800">{position.label}</p>
        <ul className="mt-1 space-y-0.5 text-xs text-red-900">
          {position.candidates.map((candidate, index) => (
            <li key={`${candidate.value.summary}:${index}`}>Candidate {index + 1}: {candidate.value.summary}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm text-zinc-900">{position.value.summary}</p>
      {position.value.details.length > 0 && (
        <dl className="mt-1 space-y-0.5">
          {position.value.details.map((row) => (
            <div key={row.label} className="text-[11px] text-zinc-500">
              <span>{row.label}: </span>
              <span className="text-zinc-700">{row.value}</span>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function NegotiationWhy({ evidence }: { evidence: NegotiationEvidenceView[] }) {
  if (evidence.length === 0) {
    return <p className="mt-1 text-[11px] text-zinc-500">{NO_DOCUMENTARY_SUPPORT}</p>;
  }
  return (
    <ul className="mt-1 space-y-1">
      {evidence.map((item) => (
        <li key={item.observationId} className="text-[11px] text-zinc-600">
          <span className="font-medium text-zinc-800">{item.sourceLabel}</span>
          {item.pageNumber ? <span> · Page {item.pageNumber}</span> : null}
          {item.href ? (
            <>
              {" "}
              <a className="underline" href={item.href}>Open source</a>
            </>
          ) : null}
          {item.quote ? <span className="mt-0.5 block border-l-2 border-zinc-200 pl-2">“{item.quote}”</span> : null}
        </li>
      ))}
    </ul>
  );
}

function FactWhy({ evidence }: { evidence: EvidenceView | NegotiationEvidenceView[] }) {
  if (Array.isArray(evidence)) return <NegotiationWhy evidence={evidence} />;
  return <EvidencePanel evidence={evidence} />;
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-sm border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
        {action}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function attentionLines(intelligence: DealIntelligence): string[] {
  const health = intelligence.health;
  const lines: string[] = [];
  if (health.reviewRequiredDocumentCount > 0) {
    lines.push(`${health.reviewRequiredDocumentCount} ${health.reviewRequiredDocumentCount === 1 ? "document needs" : "documents need"} review`);
  }
  if (health.failedDocumentCount > 0) {
    lines.push(`${health.failedDocumentCount} ${health.failedDocumentCount === 1 ? "document" : "documents"} failed analysis`);
  }
  if (health.processingDocumentCount > 0) {
    lines.push(`${health.processingDocumentCount} ${health.processingDocumentCount === 1 ? "document is" : "documents are"} processing`);
  }
  if (health.conflictCount > 0) {
    lines.push(`${health.conflictCount} negotiation ${health.conflictCount === 1 ? "conflict" : "conflicts"}`);
  }
  if (health.openTermCount > 0) {
    lines.push(`${health.openTermCount} open ${health.openTermCount === 1 ? "term" : "terms"}`);
  }
  if (health.unresolvedEntityCount > 0) {
    lines.push(`${health.unresolvedEntityCount} unreviewed ${health.unresolvedEntityCount === 1 ? "entity" : "entities"}`);
  }
  if (health.blockedRelationshipCount > 0) {
    lines.push(`${health.blockedRelationshipCount} blocked ${health.blockedRelationshipCount === 1 ? "relationship" : "relationships"}`);
  }
  if (health.evidenceIssueCount > 0) {
    lines.push(`${health.evidenceIssueCount} provenance ${health.evidenceIssueCount === 1 ? "issue" : "issues"}`);
  }
  const prepare = intelligence.reviewQueue.filter((item) => item.kind === "PREPARE" || item.kind === "ANALYZE").length;
  if (prepare > 0) {
    lines.push(`${prepare} ${prepare === 1 ? "document still needs" : "documents still need"} preparation or analysis`);
  }
  return lines;
}

function PartyList({ title, parties }: { title: string; parties: DealParty[] }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      {parties.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-400">None canonically linked.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {parties.map((party) => (
            <li key={party.id}>
              <p className="text-sm text-zinc-900">
                {party.href ? <Link className="underline decoration-zinc-300 underline-offset-2" href={party.href}>{party.name}</Link> : party.name}
                <span className="ml-2 text-[11px] text-zinc-500">{party.role}</span>
              </p>
              {party.representsCompanyName && (
                <p className="text-[11px] text-zinc-500">
                  Represents{" "}
                  {party.representsHref ? <Link className="underline decoration-zinc-300 underline-offset-2" href={party.representsHref}>{party.representsCompanyName}</Link> : party.representsCompanyName}
                </p>
              )}
              {party.employers.map((employer) => (
                <p key={employer.companyId} className="text-[11px] text-zinc-500">
                  {employer.title ? `${employer.title} at ` : "Employed by "}
                  <Link className="underline decoration-zinc-300 underline-offset-2" href={employer.href}>{employer.companyName}</Link>
                </p>
              ))}
              <FactWhy evidence={party.evidence} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DealOverview({ intelligence }: { intelligence: DealIntelligence }) {
  const lines = attentionLines(intelligence);
  const hasTerms = intelligence.health.negotiationTermCount > 0;
  const teamEmpty = !intelligence.team.property
    && intelligence.team.tenant.length === 0
    && intelligence.team.landlord.length === 0
    && intelligence.team.tenantBrokers.length === 0
    && intelligence.team.landlordBrokers.length === 0
    && intelligence.team.other.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-sm border border-zinc-200 bg-white px-4 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Attention</h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">No outstanding review items.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {lines.map((line) => (
              <li key={line} className="text-sm text-zinc-800">{line}</li>
            ))}
          </ul>
        )}
        {intelligence.reviewQueue.length > 0 && (
          <ul className="mt-4 divide-y divide-zinc-100 border-t border-zinc-100">
            {intelligence.reviewQueue.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <p className="text-sm text-zinc-900">{item.label}</p>
                  <p className="text-[11px] text-zinc-500">{item.detail ?? item.documentName}</p>
                </div>
                <Link className="shrink-0 text-xs font-medium text-zinc-800 underline" href={item.href}>Open</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section
        title="Negotiation"
        action={<Link className="text-[11px] font-medium text-zinc-600 underline" href={`/deals/${intelligence.deal.id}/negotiation`}>Open negotiation</Link>}
      >
        {!hasTerms ? (
          <p className="text-sm text-zinc-600">No negotiation terms have been extracted yet.</p>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Open items</h3>
              {intelligence.openItems.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">No open negotiation items.</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-zinc-400">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">Term</th>
                        <th className="py-2 pr-3 font-semibold">Tenant</th>
                        <th className="py-2 pr-3 font-semibold">Landlord</th>
                        <th className="py-2 pr-3 font-semibold">Gap</th>
                        <th className="py-2 pr-3 font-semibold">Status</th>
                        <th className="py-2 pr-3 font-semibold">Latest side</th>
                        <th className="py-2 font-semibold">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {intelligence.openItems.map((item) => (
                        <tr key={item.canonicalType} className="align-top">
                          <td className="py-3 pr-3 font-medium text-zinc-900">{item.label}</td>
                          <td className="py-3 pr-3"><PositionText position={item.tenantPosition} /></td>
                          <td className="py-3 pr-3"><PositionText position={item.landlordPosition} /></td>
                          <td className="py-3 pr-3 text-zinc-700">{item.numericGap?.display ?? "—"}</td>
                          <td className="py-3 pr-3"><StatusPill status={item.status} /></td>
                          <td className="py-3 pr-3 text-xs text-zinc-600">
                            {sideLabel(item.latestChangingSide)}
                            <span className="mt-1 block text-zinc-400">{utcDate(item.lastChangedAt)}</span>
                          </td>
                          <td className="py-3 text-xs text-zinc-600">
                            <p>{item.source.sourceLabel ?? item.source.roundName ?? "—"}</p>
                            {item.source.pageNumber ? <p>Page {item.source.pageNumber}</p> : null}
                            {item.source.href ? <a className="underline" href={item.source.href}>Evidence</a> : null}
                            <NegotiationWhy evidence={item.evidence} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Agreed terms</h3>
              {intelligence.agreedTerms.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">No terms are agreed yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-zinc-100">
                  {intelligence.agreedTerms.map((term) => (
                    <li key={term.canonicalType} className="py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-zinc-900">{term.label}</p>
                        <StatusPill status="AGREED" />
                      </div>
                      <p className="mt-1 text-sm text-zinc-800">{term.agreedValue.summary}</p>
                      {term.agreedValue.details.length > 0 && (
                        <dl className="mt-1 space-y-0.5">
                          {term.agreedValue.details.map((row) => (
                            <div key={row.label} className="text-[11px] text-zinc-500">
                              {row.label}: <span className="text-zinc-700">{row.value}</span>
                            </div>
                          ))}
                        </dl>
                      )}
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {term.agreedAt ? `Agreed ${utcDate(term.agreedAt)}` : "Agreement date is not stored"}
                        {term.source.sourceLabel ? ` · ${term.source.sourceLabel}` : ""}
                      </p>
                      <NegotiationWhy evidence={term.evidence} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Recent movement</h3>
              {intelligence.recentMovement.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-600">No term movement has been recorded.</p>
              ) : (
                <ul className="mt-2 divide-y divide-zinc-100">
                  {intelligence.recentMovement.map((item) => (
                    <li key={item.canonicalType} className="py-3">
                      <p className="text-sm font-medium text-zinc-900">{item.label}</p>
                      <p className="mt-1 text-xs text-zinc-700">Tenant: {item.tenantLine ?? "—"}</p>
                      <p className="text-xs text-zinc-700">Landlord: {item.landlordLine ?? "—"}</p>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {item.movement.label}
                        {item.source.roundDate ? ` · ${utcDate(item.source.roundDate)}` : ""}
                        {item.source.sourceLabel ? ` · ${item.source.sourceLabel}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section title="Messages" action={<Link className="text-[11px] font-medium text-zinc-600 underline" href={`/deals/${intelligence.deal.id}/messages`}>Open messages</Link>}>
        <div className="flex flex-wrap gap-6 text-sm text-zinc-800"><p>Messages: <span className="font-semibold">{intelligence.messageRollup.total}</span></p><p>Needs review: <span className="font-semibold">{intelligence.messageRollup.needsReview}</span></p><p>Analysis failed: <span className="font-semibold">{intelligence.messageRollup.failed}</span></p></div>
      </Section>

      <Section
        title="Documents"
        action={<Link className="text-[11px] font-medium text-zinc-600 underline" href={`/deals/${intelligence.deal.id}/documents`}>Open documents</Link>}
      >
        <p className="mb-3 text-xs text-zinc-500">
          {intelligence.health.documentCount} {intelligence.health.documentCount === 1 ? "document" : "documents"}
          {" · "}
          {intelligence.health.reviewedDocumentCount} reviewed
          {" · "}
          {intelligence.health.reviewRequiredDocumentCount} need review
        </p>
        {intelligence.documents.length === 0 ? (
          <p className="text-sm text-zinc-600">No documents have been added to this deal.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-zinc-400">
                <tr>
                  {["Document", "Type", "Side", "Date", "Analysis", "Review", "Negotiation findings", "Entities", "Relationships", "Evidence", "Action"].map((column) => (
                    <th key={column} className="py-2 pr-3 font-semibold">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-zinc-700">
                {intelligence.documents.map((document) => (
                  <tr key={document.id} className="align-top">
                    <td className="py-2 pr-3 font-medium text-zinc-900">
                      <Link className="underline decoration-zinc-300 underline-offset-2" href={document.action.href}>{document.name}</Link>
                    </td>
                    <td className="py-2 pr-3">{document.documentType}</td>
                    <td className="py-2 pr-3">{sideLabel(document.side)}</td>
                    <td className="py-2 pr-3">{utcDate(document.documentDate)}</td>
                    <td className="py-2 pr-3">{document.analysis}</td>
                    <td className="py-2 pr-3">{document.review}</td>
                    <td className="py-2 pr-3">{document.negotiationFindings}</td>
                    <td className="py-2 pr-3">{document.entities}</td>
                    <td className="py-2 pr-3">{document.relationships}</td>
                    <td className="py-2 pr-3">{document.evidence}</td>
                    <td className="py-2">
                      <Link className="font-medium text-zinc-900 underline" href={document.action.href}>{document.action.label}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Deal team"
        action={<Link className="text-[11px] font-medium text-zinc-600 underline" href={`/deals/${intelligence.deal.id}/knowledge`}>Open knowledge</Link>}
      >
        {teamEmpty ? (
          <p className="text-sm text-zinc-600">No canonical people, companies, or property are linked to this deal yet.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Property</h3>
              {intelligence.team.property ? (
                <div className="mt-2">
                  <Link className="text-sm font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2" href={intelligence.team.property.href}>
                    {intelligence.team.property.name}
                  </Link>
                  {intelligence.team.property.address ? <p className="text-[11px] text-zinc-500">{intelligence.team.property.address}</p> : null}
                  <FactWhy evidence={intelligence.team.property.evidence} />
                </div>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">No canonical property is linked.</p>
              )}
            </div>
            <PartyList title="Tenant" parties={intelligence.team.tenant} />
            <PartyList title="Landlord" parties={intelligence.team.landlord} />
            <PartyList title="Tenant broker" parties={intelligence.team.tenantBrokers} />
            <PartyList title="Landlord broker" parties={intelligence.team.landlordBrokers} />
            <PartyList title="Other participants" parties={intelligence.team.other} />
          </div>
        )}
      </Section>

      <Section
        title="Recent activity"
        action={<Link className="text-[11px] font-medium text-zinc-600 underline" href={intelligence.activityHref}>Open activity</Link>}
      >
        {intelligence.activity.length === 0 ? (
          <p className="text-sm text-zinc-600">No activity has been recorded for this deal.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {intelligence.activity.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-zinc-900">{event.title}</p>
                    <ReconciliationBadge links={event.reconciliation} />
                  </div>
                  {event.description ? <p className="text-[11px] text-zinc-500">{event.description}</p> : null}
                  {event.sourceType === "SOURCE_MESSAGE" && event.details && event.details.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {event.details.filter((detail) => detail.canonicalType !== "OTHER").map((detail) => (
                        <li key={`${event.id}:${detail.canonicalType}:${detail.value}:${detail.status}`} className="text-[11px] text-zinc-700">
                          <span className="font-medium text-zinc-900">{detail.label}</span>
                          {detail.side ? <span className="text-zinc-500"> · {detail.side}</span> : null}
                          <span> · {detail.value}</span>
                          {detail.reconciliation ? <span className="ml-2"><ReconciliationBadge links={[detail.reconciliation]} /></span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {event.sourceType === "SOURCE_MESSAGE" && event.sourceHref && <Link className="mt-1 inline-block text-[11px] font-medium text-zinc-700 underline" href={event.sourceHref}>View message</Link>}
                </div>
                <span className="shrink-0 text-[11px] text-zinc-400">{utcDate(event.occurredAt ?? event.recordedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="text-[11px] text-zinc-400">
        Intelligence status: {intelligenceStatusLabel(intelligence.intelligenceStatus)}. Record status remains {intelligence.deal.recordStatus}.
      </p>
    </div>
  );
}
