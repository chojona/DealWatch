import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { CompanyIntelligencePage } from "@/components/intelligence/intelligence-page";
import { prisma } from "@/lib/db";
import { getCompanyIntelligence } from "@/lib/intelligence/service";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getCompanyIntelligence(prisma, id);
  if (!data) notFound();
  return <div className="min-h-screen"><Nav /><CompanyIntelligencePage data={data} /></div>;
}
