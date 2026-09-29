import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";
import { DocumentReviewWorkspace } from "@/components/documents/document-review-workspace";
import { readDocumentObservations } from "@/lib/ai/graph/readObservations";
import { prisma } from "@/lib/db";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getDocumentReview } from "@/lib/inbox/service";
import { getReviewHistory } from "@/lib/review/history";
import {
  documentReviewCounts,
  listDocumentRelationshipPromotions,
  previewCanonicalEntity,
} from "@/lib/promotion/service";
import { listResolutionCandidates } from "@/lib/resolution/service";

export const dynamic = "force-dynamic";

const DOCUMENT_REVIEW_SECTIONS = ["overview", "negotiation", "entities", "relationships", "evidence"] as const;

export default async function DocumentReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; focus?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const initialSection = DOCUMENT_REVIEW_SECTIONS.find((section) => section === query.section) ?? "overview";
  const focusId = query.focus?.trim() || null;
  const workspace = await ensureDefaultWorkspace(prisma);
  const [review, history, closures] = await Promise.all([
    getDocumentReview(prisma, workspace.id, id),
    getReviewHistory(prisma, { workspaceId: workspace.id, documentId: id }),
    prisma.reviewDecision.findMany({
      where: { documentId: id, kind: "ENTITY_CLOSURE", reviewState: "LEFT_UNRESOLVED" },
      select: { entityObservationId: true },
    }),
  ]);
  if (!review || !history) notFound();
  const leftUnresolved = new Set(
    closures.map((row) => row.entityObservationId).filter((value): value is string => Boolean(value))
  );

  const stored = await readDocumentObservations(prisma, id);
  const observations = [];
  for (const observation of stored?.entityObservations ?? []) {
    const candidates = await listResolutionCandidates(prisma, observation.id);
    if (!candidates) continue;
    const preview = await previewCanonicalEntity(prisma, observation.id);
    const closure = preview?.alreadyResolved
      ? "RESOLVED" as const
      : leftUnresolved.has(observation.id)
        ? "LEFT_UNRESOLVED" as const
        : "UNREVIEWED" as const;
    observations.push({ ...candidates, preview, closure });
  }
  const relationships = (await listDocumentRelationshipPromotions(prisma, id)) ?? [];
  const counts = await documentReviewCounts(prisma, {
    observationIds: observations.map((observation) => observation.observationId),
    relationships,
  });

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-6">
        <DocumentReviewWorkspace
          review={review}
          observations={observations}
          relationships={relationships}
          counts={counts}
          history={history}
          allowSourceReplacement={process.env.NODE_ENV !== "production"}
          allowDemoReset={process.env.NODE_ENV !== "production"}
          initialSection={initialSection}
          focusId={focusId}
        />
      </main>
    </div>
  );
}
