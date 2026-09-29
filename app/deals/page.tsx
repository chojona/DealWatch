import Link from "next/link";
import { Nav } from "@/components/nav";
import { DealSearch } from "@/components/deals/deal-search";
import { prisma } from "@/lib/db";
import { searchDeals, type DealSearchHit } from "@/lib/deals/search";

export const dynamic = "force-dynamic";

function DealRow({ deal }: { deal: DealSearchHit }) {
  const place = [deal.company, deal.property].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        href={deal.href}
        className="block rounded-sm border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300"
      >
        <span className="block text-sm font-semibold text-zinc-900">{deal.name}</span>
        <span className="mt-0.5 block text-xs text-zinc-500">
          {[place || "Company and property not set", deal.stage].filter(Boolean).join(" · ")}
          <span className="text-zinc-300"> · </span>
          {deal.status}
        </span>
      </Link>
    </li>
  );
}

export default async function DealsPage() {
  const listing = await searchDeals(prisma);
  return (
    <div className="min-h-screen">
      <Nav active="/deals" />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <h1 className="mb-4 text-xl font-semibold text-zinc-900">Deals</h1>
        <DealSearch>
          {listing.results.length === 0 ? (
            <p className="rounded-sm border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-500">
              No deals in this workspace.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {listing.results.map((deal) => <DealRow key={deal.id} deal={deal} />)}
              </ul>
              {listing.truncated ? (
                <p className="mt-3 text-xs text-zinc-400">Showing the first {listing.results.length} deals.</p>
              ) : null}
            </>
          )}
        </DealSearch>
      </main>
    </div>
  );
}
