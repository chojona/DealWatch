import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Nav } from "@/components/nav";
import { DealHeader } from "@/components/deals/deal-header";
import { AddRoundForm } from "@/components/negotiation/add-round-form";
import { NegotiationMatrix } from "@/components/negotiation/negotiation-matrix";
import { compareRounds } from "@/lib/negotiation/compareRounds";
import { TERM_LABELS } from "@/lib/negotiation/termCatalog";
import type {
  NegotiationRoundRecord,
  NegotiationTermRecord,
} from "@/lib/negotiation/types";
import type {
  CanonicalTermType,
  NegotiationSide,
  NegotiationTermStatus,
} from "@/lib/ai/negotiation/schemas";

export const dynamic = "force-dynamic";

function formatMovement(value: number, unit: string) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const amount = Math.abs(value);
  const number = Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
  if (unit === "USD_PER_RSF_YEAR") return `${sign}$${number}/SF`;
  if (unit === "PERCENT_ANNUAL") return `${sign}${number}%`;
  if (unit === "MONTHS") return `${sign}${number} mo`;
  if (unit === "MONTHS_RENT") return `${sign}${number} mo rent`;
  if (unit === "RSF") return `${sign}${amount.toLocaleString()} RSF`;
  return `${sign}${number}`;
}

export default async function NegotiationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      negotiationRounds: {
        include: { terms: true },
        orderBy: [{ documentDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!deal) notFound();

  const rounds: NegotiationRoundRecord[] = deal.negotiationRounds.map(
    (round) => ({
      id: round.id,
      side: round.side as NegotiationSide,
      roundNumber: round.roundNumber,
      documentName: round.documentName,
      documentText: round.documentText,
      documentDate: round.documentDate,
      createdAt: round.createdAt,
      terms: round.terms.map(
        (term): NegotiationTermRecord => ({
          ...term,
          canonicalType: term.canonicalType as CanonicalTermType,
          status: term.status as NegotiationTermStatus,
          side: term.side as NegotiationSide,
        })
      ),
    })
  );
  const analysis = compareRounds(rounds);
  const latestRound = analysis.rounds.at(-1);
  const movementRows = analysis.rows.filter(
    (row) =>
      (row.movement.tenant && row.movement.tenant.change !== 0) ||
      (row.movement.landlord && row.movement.landlord.change !== 0)
  );

  const matrixRounds = analysis.rounds.map((round) => ({
    id: round.id,
    side: round.side,
    roundNumber: round.roundNumber,
    documentName: round.documentName,
    documentDate: round.documentDate.toISOString(),
  }));
  const matrixRows = analysis.rows.map((row) => ({
    type: row.type,
    label: row.label,
    status: row.state.status,
    contradictory: row.state.contradictory,
    gap: row.gap,
    cells: row.cells.map((cell) => ({
      roundId: cell.roundId,
      terms: cell.terms.map((term) => ({
        id: term.id,
        normalizedValue: term.normalizedValue,
        normalizedNumeric: term.normalizedNumeric,
        normalizedUnit: term.normalizedUnit,
        rawValue: term.rawValue,
        status: term.status,
        confidence: term.confidence,
        evidenceQuote: term.evidenceQuote,
        sourceLocation: term.sourceLocation,
      })),
    })),
  }));

  return (
    <div className="min-h-screen">
      <Nav />
      <DealHeader
        dealId={deal.id}
        activeSection="negotiation"
        name={deal.name}
        company={deal.company}
        property={deal.property}
        stage={deal.stage}
        status={deal.status}
        estimatedValue={deal.estimatedValue}
        createdAt={deal.createdAt}
      />

      <main className="mx-auto max-w-[1500px] px-6 py-6">
        <div className="mb-4 flex items-start justify-between gap-6">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Negotiation overview</h2>
            <p className="mt-1 max-w-2xl text-xs text-zinc-500">
              Reconstructed from source-grounded term assertions. Missing terms do not supersede earlier positions.
            </p>
          </div>
          <AddRoundForm dealId={deal.id} />
        </div>

        <section className="mb-6 grid grid-cols-2 overflow-hidden rounded-sm border border-zinc-200 bg-white sm:grid-cols-5">
          {[
            ["Stage", deal.stage],
            ["Rounds", analysis.rounds.length.toString()],
            ["Last movement", latestRound ? `${latestRound.side === "TENANT" ? "Tenant" : "Landlord"} R${latestRound.roundNumber}` : "None"],
            ["Open terms", analysis.openIssues.length.toString()],
            ["Agreed terms", analysis.agreedTerms.length.toString()],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-r border-zinc-100 px-4 py-3 last:border-r-0 sm:border-b-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
              <p className="mt-1 text-sm font-semibold text-zinc-900">{value}</p>
            </div>
          ))}
        </section>

        {analysis.rounds.length === 0 ? (
          <section className="rounded-sm border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
            <h2 className="text-sm font-semibold text-zinc-800">No negotiation rounds yet</h2>
            <p className="mt-1 text-xs text-zinc-500">Add a pasted LOI or counterproposal to begin reconstructing the negotiation.</p>
          </section>
        ) : (
          <>
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Term history</h2>
              <NegotiationMatrix rounds={matrixRounds} rows={matrixRows} />
            </section>

            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Open issues</h2>
                  <span className="text-[10px] text-zinc-400">Ranked by term centrality, not estimated dollars</span>
                </div>
                <div className="overflow-hidden rounded-sm border border-zinc-200 bg-white">
                  {analysis.openIssues.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-zinc-400">No unresolved mentioned terms.</p>
                  ) : analysis.openIssues.map((row, index) => (
                    <div key={row.type} className="flex items-start gap-3 border-b border-zinc-100 px-4 py-3 last:border-0">
                      <span className="mt-0.5 text-[10px] tabular-nums text-zinc-300">{String(index + 1).padStart(2, "0")}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-zinc-800">{row.label}</p>
                          <span className="text-[9px] font-semibold text-amber-700">{row.state.contradictory ? "CONTRADICTORY" : row.state.status}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-zinc-400">
                          {row.gap ? `Current numeric gap: ${formatMovement(row.gap.currentGap, row.gap.unit).replace(/^\+/, "")}` : "Requires explicit resolution evidence"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Negotiation movement</h2>
                <div className="overflow-hidden rounded-sm border border-zinc-200 bg-white">
                  {movementRows.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-zinc-400">No measurable movement yet.</p>
                  ) : movementRows.map((row) => (
                    <div key={row.type} className="border-b border-zinc-100 px-4 py-3 last:border-0">
                      <p className="text-sm font-medium text-zinc-800">{TERM_LABELS[row.type]}</p>
                      <div className="mt-1.5 grid grid-cols-2 gap-4 text-xs">
                        <p className="text-zinc-500">Tenant moved: <span className="font-semibold tabular-nums text-zinc-800">{row.movement.tenant ? formatMovement(row.movement.tenant.change, row.movement.tenant.unit) : "—"}</span></p>
                        <p className="text-zinc-500">Landlord moved: <span className="font-semibold tabular-nums text-zinc-800">{row.movement.landlord ? formatMovement(row.movement.landlord.change, row.movement.landlord.unit) : "—"}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
