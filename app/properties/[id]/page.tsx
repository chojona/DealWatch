import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { PropertyIntelligencePage } from "@/components/intelligence/intelligence-page";
import { prisma } from "@/lib/db";
import { getPropertyIntelligence } from "@/lib/intelligence/service";

export const dynamic = "force-dynamic";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPropertyIntelligence(prisma, id);
  if (!data) notFound();
  return <div className="min-h-screen"><Nav /><PropertyIntelligencePage data={data} /></div>;
}
