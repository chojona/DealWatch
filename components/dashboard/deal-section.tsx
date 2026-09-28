import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatRelative } from "@/lib/formatters";

interface WaitingDeal {
  dealId: string;
  property: string;
  company: string;
  stage: string;
  estimatedValue: number | null;
  obligationDescription: string;
  counterparty: string;
  waitingSince: Date;
  evidenceQuote: string;
}

interface UpcomingCommitment {
  dealId: string;
  property: string;
  company: string;
  description: string;
  owner: string;
  dueAt: Date;
  evidenceQuote: string;
}

interface RecentEvent {
  dealId: string;
  property: string;
  company: string;
  type: string;
  description: string;
  occurredAt: Date;
  confidence: number;
}

export function WaitingSection({ deals }: { deals: WaitingDeal[] }) {
  if (deals.length === 0) return null;
  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Waiting on Them
      </h2>
      <div className="overflow-hidden rounded-sm border border-zinc-200">
        {deals.map((deal, i) => (
          <Link
            key={deal.dealId}
            href={`/deals/${deal.dealId}`}
            className="group block"
          >
            <div
              className={`flex items-start gap-4 px-4 py-3 transition-colors group-hover:bg-zinc-50 ${
                i < deals.length - 1 ? "border-b border-zinc-100" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-sm font-medium text-zinc-900 truncate">
                    {deal.property}
                  </span>
                  <span className="text-xs text-zinc-400">—</span>
                  <span className="text-xs text-zinc-500">{deal.company}</span>
                </div>
                <p className="text-xs text-zinc-600 mb-1">
                  {deal.obligationDescription}
                </p>
                <div className="flex items-center gap-2">
                  <StatusBadge status="WAITING" />
                  <span className="text-[10px] text-zinc-400">
                    Waiting on {deal.counterparty}
                  </span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                {deal.estimatedValue && (
                  <div className="text-xs text-zinc-400 tabular-nums mb-0.5">
                    {formatCurrency(deal.estimatedValue)}
                  </div>
                )}
                <div className="text-[10px] text-amber-600 font-medium">
                  {formatRelative(deal.waitingSince)}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function UpcomingSection({
  commitments,
}: {
  commitments: UpcomingCommitment[];
}) {
  if (commitments.length === 0) return null;
  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Upcoming Commitments
      </h2>
      <div className="overflow-hidden rounded-sm border border-zinc-200">
        {commitments.map((c, i) => (
          <Link
            key={`${c.dealId}-${i}`}
            href={`/deals/${c.dealId}`}
            className="group block"
          >
            <div
              className={`flex items-start gap-4 px-4 py-3 transition-colors group-hover:bg-zinc-50 ${
                i < commitments.length - 1 ? "border-b border-zinc-100" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-sm font-medium text-zinc-900">
                    {c.property}
                  </span>
                  <span className="text-xs text-zinc-400">—</span>
                  <span className="text-xs text-zinc-500">{c.company}</span>
                </div>
                <p className="text-xs text-zinc-600">{c.description}</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Owner: {c.owner}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] text-zinc-500">
                  Due {formatRelative(c.dueAt)}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function RecentActivitySection({ events }: { events: RecentEvent[] }) {
  if (events.length === 0) return null;

  const typeLabels: Record<string, string> = {
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

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Recent Deal Activity
      </h2>
      <div className="overflow-hidden rounded-sm border border-zinc-200">
        {events.map((event, i) => (
          <Link
            key={`${event.dealId}-${i}`}
            href={`/deals/${event.dealId}`}
            className="group block"
          >
            <div
              className={`flex items-start gap-3 px-4 py-3 transition-colors group-hover:bg-zinc-50 ${
                i < events.length - 1 ? "border-b border-zinc-100" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant="secondary">
                    {typeLabels[event.type] ?? event.type}
                  </Badge>
                  <span className="text-[10px] text-zinc-400">
                    {event.property} — {event.company}
                  </span>
                </div>
                <p className="text-xs text-zinc-600">{event.description}</p>
              </div>
              <div className="shrink-0 text-[10px] text-zinc-400">
                {formatRelative(event.occurredAt)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
