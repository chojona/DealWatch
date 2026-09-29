import { notFound } from "next/navigation";
import { PropertyIntelligencePage } from "@/components/intelligence/intelligence-page";
import { prisma } from "@/lib/db";
import { getPropertyIntelligence } from "@/lib/intelligence/service";
import { getActivityPage } from "@/lib/activity/service";

export const dynamic = "force-dynamic";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, activity] = await Promise.all([
    getPropertyIntelligence(prisma, id),
    getActivityPage(prisma, { rootType: "PROPERTY", rootId: id, limit: 25 }),
  ]);
  if (!data || !activity) notFound();
  return <div className="min-h-screen"><PropertyIntelligencePage data={data} activity={activity} /></div>;
}
