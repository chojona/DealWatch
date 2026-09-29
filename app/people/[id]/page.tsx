import { notFound } from "next/navigation";
import { PersonIntelligencePage } from "@/components/intelligence/intelligence-page";
import { prisma } from "@/lib/db";
import { getPersonIntelligence } from "@/lib/intelligence/service";
import { getActivityPage } from "@/lib/activity/service";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, activity] = await Promise.all([
    getPersonIntelligence(prisma, id),
    getActivityPage(prisma, { rootType: "PERSON", rootId: id, limit: 25 }),
  ]);
  if (!data || !activity) notFound();
  return <div className="min-h-screen"><PersonIntelligencePage data={data} activity={activity} /></div>;
}
