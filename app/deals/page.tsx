import Link from "next/link";
import { Nav } from "@/components/nav";
import { ModernHome } from "@/components/dashboard/modern-home";
import { DealSearch } from "@/components/deals/deal-search";
import { prisma } from "@/lib/db";
import { getModernDashboard } from "@/lib/deals/dashboard";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const dashboard = await getModernDashboard(prisma);
  return (
    <div className="min-h-screen">
      <Nav active="/deals" />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900">Deals</h1>
            <p className="mt-0.5 text-sm text-zinc-500">Find a deal by name, company, or property.</p>
          </div>
          <Link
            href="/deals/new"
            className="inline-flex h-8 items-center rounded-sm bg-zinc-900 px-3 text-xs font-medium text-white"
          >
            New deal
          </Link>
        </div>
        <DealSearch>
          <ModernHome dashboard={dashboard} heading="Deals" showHeader={false} />
        </DealSearch>
      </main>
    </div>
  );
}
