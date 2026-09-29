import { Nav } from "@/components/nav";
import { ModernHome } from "@/components/dashboard/modern-home";
import { prisma } from "@/lib/db";
import { getModernDashboard } from "@/lib/deals/dashboard";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const dashboard = await getModernDashboard(prisma);
  return (
    <div className="min-h-screen">
      <Nav active="/deals" />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <ModernHome dashboard={dashboard} heading="Deals" subheading="Modern deals in this workspace." />
      </main>
    </div>
  );
}
