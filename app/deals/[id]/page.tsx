import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { ObligationRow } from "@/components/deals/obligation-row";
import { ThreadPanel } from "@/components/deals/thread-panel";
import { ConfidenceDot } from "@/components/confidence-badge";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/formatters";

export const dynamic = "force-dynamic";

async function getDeal(id: string) {
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      obligations: {
        include: { message: true },
        orderBy: { createdAt: "asc" },
      },
      events: {
        include: { message: true },
        orderBy: { occurredAt: "asc" },
      },
      threads: {
        include: {
          messages: {
            orderBy: { sentAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!deal) return null;
  return deal;
}

const eventTypeLabels: Record<string, string> = {
  PROPOSAL_SENT: "Proposal Sent",
  COUNTER_RECEIVED: "Counter Received",
  LOI_SUBMITTED: "LOI Submitted",
  LEASE_EXECUTED: "Lease Executed",
  TOUR_SCHEDULED: "Tour Scheduled",
  COMMITMENT_MADE: "Commitment Made",
  DEADLINE_SET: "Deadline Set",
  FOLLOW_UP_SENT: "Follow-up Sent",
  BOARD_MEETING_SCHEDULED: "Board Meeting Scheduled",
  REQUIREMENTS_CONFIRMED: "Requirements Confirmed",
  CLIENT_CONFIRMED: "Client Confirmed",
  MESSAGE_ANALYZED: "Thread Analyzed",
};

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await getDeal(id);

  if (!deal) notFound();

  const openObligations = deal.obligations.filter((o) =>
    ["OPEN", "WAITING"].includes(o.status)
  );
  const overdueObligations = deal.obligations.filter(
    (o) => o.status === "OVERDUE"
  );
  const completedObligations = deal.obligations.filter(
    (o) => o.status === "COMPLETED"
  );

  return (
    <div className="min-h-screen">
      <Nav />
      <DealHeader
        dealId={deal.id}
        activeSection="overview"
        name={deal.name}
        company={deal.company}
        property={deal.property}
        stage={deal.stage}
        status={deal.status}
        estimatedValue={deal.estimatedValue}
        createdAt={deal.createdAt}
      />

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid grid-cols-3 gap-6">
          {/* Left: Obligations + Timeline */}
          <div className="col-span-2 flex flex-col gap-6">
            {/* Overdue */}
            {overdueObligations.length > 0 && (
              <div className="rounded-sm border border-red-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-red-100 bg-red-50">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-red-600">
                    Overdue ({overdueObligations.length})
                  </h2>
                </div>
                {overdueObligations.map((obl) => (
                  <ObligationRow
                    key={obl.id}
                    id={obl.id}
                    owner={obl.owner}
                    counterparty={obl.counterparty}
                    description={obl.description}
                    dueAt={obl.dueAt}
                    status={obl.status}
                    confidence={obl.confidence}
                    evidenceQuote={obl.evidenceQuote}
                    createdAt={obl.createdAt}
                  />
                ))}
              </div>
            )}

            {/* Open + Waiting */}
            {openObligations.length > 0 && (
              <div className="rounded-sm border border-zinc-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Open Obligations ({openObligations.length})
                  </h2>
                </div>
                {openObligations.map((obl) => (
                  <ObligationRow
                    key={obl.id}
                    id={obl.id}
                    owner={obl.owner}
                    counterparty={obl.counterparty}
                    description={obl.description}
                    dueAt={obl.dueAt}
                    status={obl.status}
                    confidence={obl.confidence}
                    evidenceQuote={obl.evidenceQuote}
                    createdAt={obl.createdAt}
                  />
                ))}
              </div>
            )}

            {/* Transaction Timeline */}
            <div className="rounded-sm border border-zinc-200 bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-zinc-100">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Transaction Timeline ({deal.events.length} events)
                </h2>
              </div>
              {deal.events.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-zinc-400">
                  No events recorded yet.
                </div>
              ) : (
                <div className="relative px-4 py-4">
                  <div className="absolute left-[1.875rem] top-4 bottom-4 w-px bg-zinc-100" />
                  <div className="flex flex-col gap-4">
                    {deal.events.map((event) => (
                      <div key={event.id} className="flex gap-3">
                        <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-zinc-200 bg-white">
                          <div className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                        </div>
                        <div className="flex-1 pb-1">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <Badge variant="secondary">
                                  {eventTypeLabels[event.type] ?? event.type}
                                </Badge>
                                <ConfidenceDot confidence={event.confidence} />
                              </div>
                              <p className="text-sm text-zinc-700">
                                {event.description}
                              </p>
                              <blockquote className="mt-1 text-[11px] text-zinc-400 italic border-l-2 border-zinc-200 pl-2">
                                &ldquo;{event.evidenceQuote}&rdquo;
                              </blockquote>
                            </div>
                            <span className="shrink-0 text-[10px] text-zinc-400">
                              {formatRelative(event.occurredAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Completed obligations */}
            {completedObligations.length > 0 && (
              <div className="rounded-sm border border-zinc-200 bg-white overflow-hidden">
                <div className="px-4 py-2.5 border-b border-zinc-100">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Completed ({completedObligations.length})
                  </h2>
                </div>
                {completedObligations.map((obl) => (
                  <ObligationRow
                    key={obl.id}
                    id={obl.id}
                    owner={obl.owner}
                    counterparty={obl.counterparty}
                    description={obl.description}
                    dueAt={obl.dueAt}
                    status={obl.status}
                    confidence={obl.confidence}
                    evidenceQuote={obl.evidenceQuote}
                    createdAt={obl.createdAt}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right: Email threads */}
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Email Threads
              </h2>
              {deal.threads.length === 0 ? (
                <div className="rounded-sm border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-400">
                  No threads linked yet.
                </div>
              ) : (
                <ThreadPanel threads={deal.threads} />
              )}
            </div>

            {/* Deal summary card */}
            <div className="rounded-sm border border-zinc-200 bg-white p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                Deal Summary
              </h2>
              <div className="flex flex-col gap-2.5">
                <div>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                    Company
                  </p>
                  <p className="text-sm text-zinc-800">{deal.company}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                    Property
                  </p>
                  <p className="text-sm text-zinc-800">{deal.property}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                    Stage
                  </p>
                  <p className="text-sm text-zinc-800">{deal.stage}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                    Obligations
                  </p>
                  <p className="text-sm text-zinc-800">
                    {overdueObligations.length} overdue ·{" "}
                    {openObligations.length} open ·{" "}
                    {completedObligations.length} completed
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
