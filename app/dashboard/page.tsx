import { Nav } from "@/components/nav";
import { ModernHome } from "@/components/dashboard/modern-home";
import { prisma } from "@/lib/db";
import { getModernDashboard } from "@/lib/deals/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const dashboard = await getModernDashboard(prisma);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-h-screen">
      <Nav active="/dashboard" />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <ModernHome
          dashboard={dashboard}
          heading="Home"
          subheading={`${greeting}. ${new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}`}
        />
      </main>
    </div>
  );
}
