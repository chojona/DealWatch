import assert from "node:assert/strict";
import test from "node:test";
import { hasSubstantiveExtraTokens, namesAreCompatible } from "@/lib/resolution/similarity";
import { proposeResolution } from "@/lib/resolution/propose";
import { evaluateResolutionBenchmark, formatResolutionBenchmark } from "./benchmark";
import { resolutionCases } from "./cases";

test("entity resolution benchmark separates recall, rank, and false candidates", () => {
  assert.equal(resolutionCases.length, 25);
  const report = evaluateResolutionBenchmark();
  assert.deepEqual(report.failures, [], formatResolutionBenchmark(report));
  assert.equal(report.candidateRecall, 1);
  assert.equal(report.top1Accuracy, 1);
  assert.equal(report.top3Accuracy, 1);
  assert.equal(report.falseCandidateRate, 0);
});

test("fuzzy similarity ranks a legal suffix and does not block on group or city qualifiers", () => {
  assert.equal(hasSubstantiveExtraTokens("CBRE", "CBRE Group"), true);
  assert.equal(hasSubstantiveExtraTokens("JLL", "JLL Boston"), true);
  assert.equal(namesAreCompatible("CBRE", "CBRE Group"), false);
  assert.equal(namesAreCompatible("Boston Properties", "Boston Properties Inc."), true);
  const proposals = proposeResolution(
    {
      id: "obs",
      workspaceId: "ws-a",
      observedType: "COMPANY",
      surfaceForm: "Boston Properties",
      normalizedName: "boston properties",
      title: null,
      email: null,
      phone: null,
      domain: null,
      addressLine1: null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
      linkedIn: null,
      externalId: null,
      dealId: null,
      documentDate: null,
      relationships: [],
    },
    {
      people: [],
      properties: [],
      companies: [
        {
          id: "inc",
          workspaceId: "ws-a",
          canonicalName: "Boston Properties Inc.",
          legalName: null,
          primaryDomain: null,
          status: "ACTIVE",
          aliases: [],
          domains: [],
          externalIds: [],
          dealIds: [],
        },
      ],
    }
  );
  assert.equal(proposals.length, 1);
  assert.ok(proposals[0]!.score < 0.5);
  assert.ok(proposals[0]!.positiveReasons.some((reason) => reason.startsWith("Name similarity")));
});
