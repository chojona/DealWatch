import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { PersonIntelligencePage } from "@/components/intelligence/intelligence-page";
import { prisma } from "@/lib/db";
import { getPersonIntelligence } from "@/lib/intelligence/service";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPersonIntelligence(prisma, id);
  if (!data) notFound();
  return <div className="min-h-screen"><Nav /><PersonIntelligencePage data={data} /></div>;
}
