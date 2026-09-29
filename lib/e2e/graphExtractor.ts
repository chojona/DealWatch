import type { GraphModelExtractor } from "@/lib/ai/graph/extractModel";
import { CRE_REVIEW_GRAPH } from "@/lib/documents/fixtures/creReviewFixture";

const EMPTY_GRAPH = { entities: [], relationships: [] };

/**
 * Test-only graph reader. The Harbor fixture returns the checked-in Phase 8F
 * graph. Every other document returns no observations, so document analysis
 * does not call a live entity model.
 */
export const e2eGraphExtractor: GraphModelExtractor = async (input) => {
  const extraction = input.documentText.includes("Sarah Chen is a broker at Harbor Brokerage.")
    ? CRE_REVIEW_GRAPH
    : EMPTY_GRAPH;
  return { extraction, model: "e2e-deterministic-graph" };
};

e2eGraphExtractor.model = "e2e-deterministic-graph";
