import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { CompanyIntelligencePage } from "@/components/intelligence/intelligence-page";
import { prisma } from "@/lib/db";
import { getCompanyIntelligence } from "@/lib/intelligence/service";
import { getActivityPage } from "@/lib/activity/service";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, activity] = await Promise.all([
    getCompanyIntelligence(prisma, id),
    getActivityPage(prisma, { rootType: "COMPANY", rootId: id, limit: 25 }),
  ]);
  if (!data || !activity) notFound();
  return <div className="min-h-screen"><Nav /><CompanyIntelligencePage data={data} activity={activity} /></div>;
}
