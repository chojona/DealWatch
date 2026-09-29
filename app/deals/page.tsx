import Link from "next/link";
import { ModernHome } from "@/components/dashboard/modern-home";
import { DealSearch } from "@/components/deals/deal-search";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { getModernDashboard } from "@/lib/deals/dashboard";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const dashboard = await getModernDashboard(prisma);
  return (
    <div className="min-h-screen">
      <main className="page-frame">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="page-title">Deals</h1>
            <p className="mt-1 text-sm text-ink-secondary">Find a deal by name, company, or property.</p>
          </div>
          <Button asChild>
            <Link href="/deals/new">New deal</Link>
          </Button>
        </div>
        <DealSearch>
          <ModernHome dashboard={dashboard} heading="Deals" showHeader={false} />
        </DealSearch>
      </main>
    </div>
  );
}
