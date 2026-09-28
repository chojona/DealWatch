import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { ResolutionReview } from "@/components/resolution/resolution-review";
import { readDocumentObservations } from "@/lib/ai/graph/readObservations";
import { prisma } from "@/lib/db";
import {
  documentReviewCounts,
  listDocumentRelationshipPromotions,
  previewCanonicalEntity,
} from "@/lib/promotion/service";
import { listResolutionCandidates } from "@/lib/resolution/service";

export const dynamic = "force-dynamic";

export default async function DocumentResolutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, originalFilename: true, dealId: true },
  });
  if (!document) notFound();
  const stored = await readDocumentObservations(prisma, document.id);
  if (!stored) notFound();
  const observations = [];
  for (const observation of stored.entityObservations) {
    const review = await listResolutionCandidates(prisma, observation.id);
    if (!review) continue;
    const preview = await previewCanonicalEntity(prisma, observation.id);
    observations.push({ ...review, preview });
  }
  const relationships = (await listDocumentRelationshipPromotions(prisma, document.id)) ?? [];
  const counts = await documentReviewCounts(prisma, {
    observationIds: observations.map((observation) => observation.observationId),
    relationships,
  });

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-6">
        <ResolutionReview
          documentName={document.originalFilename}
          dealId={document.dealId}
          observations={observations}
          relationships={relationships}
          counts={counts}
        />
      </main>
    </div>
  );
}
