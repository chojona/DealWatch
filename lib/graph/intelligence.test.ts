import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import {
  addCompanyAlias,
  attachObservationSupport,
  createCompany,
  createDealParticipation,
  createEmployment,
  createPerson,
  createProperty,
  createPropertyStake,
  createWorkspace,
  linkDealProperty,
  recordEntityObservation,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import { seedClarendonGraph } from "@/lib/entities/seedClarendonGraph";
import { getDealKnowledge, getRelationshipEvidence, rejectRelationshipObservation } from "@/lib/promotion/service";
import { explainConnectionFacts, factForRelationship } from "./explain";
import { getConnectionGraph } from "./service";
import { findConnectionPaths, getAssertionStrength } from "./paths";
import { NO_DOCUMENTARY_SUPPORT } from "./path-types";
import { GraphQueryError, GraphRequestError, parsePathQuery, parseSearchQuery } from "./query";
import { searchCanonicalEntities, searchWorkspaceContext } from "./search";
import { pathHopWeight, scoreConnectionPath, scoreEdgeStrength } from "./strength";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let sequence = 0;

const manualAssertion = { assertionSource: "MANUAL" as const };
const manualObservation = {
  sourceKind: "MANUAL" as const,
  extractor: "manual",
  extractorVersion: "test",
};

describe("connection intelligence", { concurrency: 1 }, () => {
  test.before(async () => {
    const db = await createTestDatabase();
    prisma = db.prisma;
    cleanup = db.cleanup;
  });

  test.after(async () => {
    await cleanup();
  });

  test("strength is a score with reasons, not a probability", () => {
    const strong = scoreEdgeStrength({
      observationCount: 4,
      distinctDocumentCount: 3,
      distinctMessageCount: 0,
      sharedDealCount: 2,
      newestEvidenceAt: new Date(),
      open: true,
      assertionSource: "OBSERVATION",
      hasExactProvenance: true,
    });
    assert.equal(strong.strengthLabel, "Strong");
    assert.ok(strong.strengthScore > 0.7 && strong.strengthScore <= 1);
    assert.ok(strong.strengthReasons.some((reason) => reason.includes("4 supporting observations")));
    assert.ok(strong.strengthReasons.some((reason) => reason.includes("3 distinct documents")));
    assert.ok(strong.strengthReasons.some((reason) => reason.includes("Appeared on 2 deals")));
    assert.ok(strong.strengthReasons.some((reason) => reason.includes("last 12 months")));
    const text = `${strong.strengthLabel} ${strong.strengthScore} ${strong.strengthReasons.join(" ")}`;
    assert.equal(text.includes("%"), false);
    assert.equal(/probability|confidence/i.test(text), false);
    assert.deepEqual(
      [1, 2, 3, 4].map((hops) => pathHopWeight(hops)),
      [1, 0.55, 0.32, 0.18]
    );
    const short = scoreConnectionPath([
      scoreEdgeStrength({
        observationCount: 0,
        distinctDocumentCount: 0,
        distinctMessageCount: 0,
        sharedDealCount: 0,
        newestEvidenceAt: null,
        open: true,
        assertionSource: "MANUAL",
        hasExactProvenance: false,
      }),
      scoreEdgeStrength({
        observationCount: 0,
        distinctDocumentCount: 0,
        distinctMessageCount: 0,
        sharedDealCount: 0,
        newestEvidenceAt: null,
        open: true,
        assertionSource: "MANUAL",
        hasExactProvenance: false,
      }),
    ]);
    const long = scoreConnectionPath(
      [0, 1, 2, 3].map(() =>
        scoreEdgeStrength({
          observationCount: 6,
          distinctDocumentCount: 4,
          distinctMessageCount: 0,
          sharedDealCount: 3,
          newestEvidenceAt: new Date(),
          open: true,
          assertionSource: "OBSERVATION",
          hasExactProvenance: true,
        })
      )
    );
    assert.ok(short > long);
  });

  test("path explanation uses canonical relationship words only", () => {
    const text = explainConnectionFacts([
      factForRelationship({
        relationshipType: "TENANT_BROKER",
        label: "Tenant broker",
        sourceLabel: "Sarah Chen",
        targetLabel: "200 Clarendon",
        sourceType: "PERSON",
        targetType: "DEAL",
      }),
      factForRelationship({
        relationshipType: "LANDLORD",
        label: "Landlord",
        sourceLabel: "Boston Properties",
        targetLabel: "200 Clarendon",
        sourceType: "COMPANY",
        targetType: "DEAL",
      }),
    ]);
    assert.match(text, /Sarah Chen represented the tenant on 200 Clarendon/);
    assert.match(text, /Boston Properties is the landlord/);
    assert.equal(/knows|friend|introduce|has met|probability|confidence/i.test(text), false);
  });

  test("search and path queries reject a client workspace id", () => {
    assert.throws(() => parseSearchQuery(new URLSearchParams("q=Boston&workspaceId=other")), GraphQueryError);
    assert.throws(
      () =>
        parsePathQuery(
          new URLSearchParams("sourceType=PERSON&sourceId=a&targetType=COMPANY&targetId=b&workspaceId=other")
        ),
      GraphQueryError
    );
    assert.throws(
      () => parsePathQuery(new URLSearchParams("sourceType=PERSON&sourceId=a&targetType=COMPANY&targetId=b&maxDepth=5")),
      GraphQueryError
    );
    assert.equal(NO_DOCUMENTARY_SUPPORT, "No documentary support is currently linked to this canonical assertion.");
  });

  test("A/B/C canonical search is workspace scoped and skips observations", async () => {
    const left = await workspaceDeal("Search left");
    const right = await workspaceDeal("Search right");
    const boston = await createCompany(prisma, { workspaceId: left.workspace.id, canonicalName: "Boston Properties" });
    await addCompanyAlias(prisma, { workspaceId: left.workspace.id, companyId: boston.id, alias: "BXP" });
    await createCompany(prisma, { workspaceId: right.workspace.id, canonicalName: "Boston Properties" });
    const property = await createProperty(prisma, {
      workspaceId: left.workspace.id,
      canonicalName: "200 Clarendon",
      addressLine1: "200 Clarendon Street",
      city: "Boston",
      region: "MA",
      assetType: "OFFICE",
    });
    await prisma.deal.update({
      where: { id: left.deal.id },
      data: { name: "Boston lease", company: "Acme Corp", property: "200 Clarendon Street, Boston MA" },
    });
    await recordEntityObservation(prisma, {
      ...manualObservation,
      workspaceId: left.workspace.id,
      dealId: left.deal.id,
      observedType: "COMPANY",
      surfaceForm: "Boston Ghost Holdings",
      evidenceQuote: "Boston Ghost Holdings",
    });

    const results = await searchCanonicalEntities(prisma, { workspaceId: left.workspace.id, q: "Boston" });
    assert.ok(results.some((hit) => hit.entityId === boston.id && hit.entityType === "COMPANY"));
    assert.ok(results.some((hit) => hit.entityId === property.id && hit.entityType === "PROPERTY"));
    assert.ok(results.some((hit) => hit.entityId === left.deal.id && hit.entityType === "DEAL"));
    assert.equal(results.some((hit) => hit.label === "Boston Ghost Holdings"), false);
    assert.equal(results.some((hit) => hit.entityType === "COMPANY" && hit.label === "Boston Properties" && hit.entityId !== boston.id), false);

    const aliasHits = await searchCanonicalEntities(prisma, { workspaceId: left.workspace.id, q: "BXP" });
    assert.equal(aliasHits[0]?.entityId, boston.id);
    assert.equal(aliasHits[0]?.matchField, "alias");
    const rightHits = await searchCanonicalEntities(prisma, { workspaceId: right.workspace.id, q: "BXP" });
    assert.equal(rightHits.length, 0);
    const firm = await searchWorkspaceContext(prisma, left.workspace.id);
    assert.equal(firm.firmCompanyId, null);
    assert.equal(firm.firmLabel, null);
  });

  test("D direct employment is a one-hop path", async () => {
    const { workspace } = await workspaceDeal("Direct");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Sarah Chen" });
    const company = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "JLL Boston" });
    await createEmployment(prisma, { ...manualAssertion, workspaceId: workspace.id, personId: person.id, companyId: company.id });
    const result = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "COMPANY",
      targetId: company.id,
      maxDepth: 4,
    });
    assert.equal(result.paths.length, 1);
    assert.equal(result.paths[0].hops, 1);
    assert.equal(result.paths[0].edges[0].relationshipType, "WORKS_AT");
    assert.match(result.paths[0].explanation, /Sarah Chen works at JLL Boston/);
  });

  test("E two-hop path goes through a deal", async () => {
    const fixture = await brokerAndLandlord("Two hop");
    const result = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: fixture.person.id,
      targetType: "COMPANY",
      targetId: fixture.landlord.id,
      maxDepth: 4,
    });
    assert.ok(result.paths[0]);
    assert.equal(result.paths[0].hops, 2);
    assert.match(result.paths[0].explanation, /represented the tenant/);
    assert.match(result.paths[0].explanation, /landlord/);
    assert.equal(/knows|friend|introduce/i.test(result.paths[0].explanation), false);
  });

  test("F/G four hops are returned and a shallower max depth is empty", async () => {
    const fixture = await fourHop("Four hop");
    const found = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: fixture.person.id,
      targetType: "COMPANY",
      targetId: fixture.owner.id,
      maxDepth: 4,
    });
    assert.equal(found.paths[0]?.hops, 4);
    assert.deepEqual(
      found.paths[0].edges.map((edge) => edge.relationshipType),
      ["WORKS_AT", "TENANT_BROKERAGE", "CONCERNS_PROPERTY", "OWNS"]
    );
    const tooShallow = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: fixture.person.id,
      targetType: "COMPANY",
      targetId: fixture.owner.id,
      maxDepth: 3,
    });
    assert.equal(tooShallow.paths.length, 0);
    await assert.rejects(
      () =>
        findConnectionPaths(prisma, {
          sourceType: "PERSON",
          sourceId: fixture.person.id,
          targetType: "COMPANY",
          targetId: fixture.owner.id,
          maxDepth: 5,
        }),
      GraphRequestError
    );
  });

  test("H/I/J no path, cycles, and duplicate edges collapse", async () => {
    const { workspace } = await workspaceDeal("Cycle");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Ada" });
    const other = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Bea" });
    const company = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Cycle Co" });
    const property = await createProperty(prisma, { workspaceId: workspace.id, canonicalName: "Cycle Tower" });
    const { deal } = await workspaceDeal("Cycle deal");
    await prisma.deal.update({ where: { id: deal.id }, data: { workspaceId: workspace.id } });
    await linkDealProperty(prisma, { workspaceId: workspace.id, dealId: deal.id, propertyId: property.id });
    await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: company.id,
      affiliationKind: "BROKER",
    });
    await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: company.id,
      affiliationKind: "STAFF",
    });
    await createDealParticipation(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      dealId: deal.id,
      role: "TENANT_BROKER",
      personId: person.id,
    });
    await createDealParticipation(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      dealId: deal.id,
      role: "LANDLORD",
      companyId: company.id,
    });
    const direct = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "COMPANY",
      targetId: company.id,
      maxDepth: 4,
    });
    assert.equal(direct.paths.filter((path) => path.hops === 1).length, 1);
    for (const path of direct.paths) {
      assert.equal(new Set(path.nodes.map((node) => node.id)).size, path.nodes.length);
    }
    const none = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "PERSON",
      targetId: other.id,
      maxDepth: 4,
    });
    assert.equal(none.paths.length, 0);
  });

  test("K/L/M at most three paths, shortest first, stronger tie breaks", async () => {
    const { workspace, deal } = await workspaceDeal("Ranked");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Riley" });
    const company = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Ranked Landlord" });
    const deals = [deal];
    for (const name of ["Second", "Third", "Fourth"]) {
      deals.push((await workspaceDeal(name)).deal);
      await prisma.deal.update({ where: { id: deals[deals.length - 1].id }, data: { workspaceId: workspace.id, name } });
    }
    for (const [index, item] of deals.entries()) {
      const broker = await createDealParticipation(prisma, {
        ...manualAssertion,
        workspaceId: workspace.id,
        dealId: item.id,
        role: "TENANT_BROKER",
        personId: person.id,
      });
      const landlord = await createDealParticipation(prisma, {
        ...manualAssertion,
        workspaceId: workspace.id,
        dealId: item.id,
        role: "LANDLORD",
        companyId: company.id,
      });
      if (index === 0) {
        await supportParticipation(workspace.id, item.id, broker.id, person.canonicalName, "broker evidence");
        await supportParticipation(workspace.id, item.id, landlord.id, company.canonicalName, "landlord evidence");
      }
    }
    const ranked = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "COMPANY",
      targetId: company.id,
      maxDepth: 4,
    });
    assert.equal(ranked.paths.length, 3);
    assert.ok(ranked.paths.every((path) => path.hops === 2));
    assert.equal(ranked.paths[0].nodes.some((node) => node.entityId === deal.id), true);
    assert.ok(ranked.paths[0].pathScore >= ranked.paths[1].pathScore);

    const chain = await fourHop("Rank chain");
    const nearer = await prisma.deal.create({
      data: {
        name: "Nearer",
        company: "Nearer",
        property: "Nearer Tower",
        stage: "LOI",
        status: "ACTIVE",
        workspaceId: chain.workspace.id,
      },
    });
    await createDealParticipation(prisma, {
      ...manualAssertion,
      workspaceId: chain.workspace.id,
      dealId: nearer.id,
      role: "TENANT_BROKER",
      personId: chain.person.id,
    });
    await createDealParticipation(prisma, {
      ...manualAssertion,
      workspaceId: chain.workspace.id,
      dealId: nearer.id,
      role: "LANDLORD",
      companyId: chain.owner.id,
    });
    const mixed = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: chain.person.id,
      targetType: "COMPANY",
      targetId: chain.owner.id,
      maxDepth: 4,
    });
    assert.equal(mixed.paths[0].hops, 2);
    assert.ok(mixed.paths.some((path) => path.hops === 4));
    assert.ok(mixed.paths[0].pathScore > mixed.paths.find((path) => path.hops === 4)!.pathScore);
  });

  test("N/O/P/Q support, sources, and recency change strength; zero support stays weak", async () => {
    const { workspace, deal } = await workspaceDeal("Strength");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Strength Person" });
    const thinCompany = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Thin Co" });
    const thickCompany = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Thick Co" });
    const thin = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: thinCompany.id,
    });
    const thick = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: thickCompany.id,
      affiliationKind: "BROKER",
    });
    await supportEmployment(workspace.id, deal.id, thick.id, "one");
    const thinScore = await getAssertionStrength(prisma, { assertionType: "Employment", assertionId: thin.id });
    const thickScore = await getAssertionStrength(prisma, { assertionType: "Employment", assertionId: thick.id });
    assert.ok(thinScore && thickScore);
    assert.equal(thinScore.strengthLabel, "Limited");
    assert.ok(thickScore.strengthScore > thinScore.strengthScore);
    assert.ok(thinScore.strengthReasons.some((reason) => reason === "No supporting observations"));

    const oneDoc = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "One Doc" });
    const twoDoc = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Two Docs" });
    const one = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: oneDoc.id,
      affiliationKind: "STAFF",
    });
    const two = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: twoDoc.id,
      affiliationKind: "EXECUTIVE",
    });
    const sharedQuote = "Works at the firm.";
    const sharedDocument = await documentWithQuote(deal.id, sharedQuote, `shared-${deal.id}`);
    await supportEmploymentDocument(workspace.id, deal.id, one.id, sharedDocument.id, sharedQuote);
    await supportEmploymentDocument(workspace.id, deal.id, one.id, sharedDocument.id, sharedQuote);
    const first = await documentWithQuote(deal.id, "First letter.", `first-${deal.id}`);
    const second = await documentWithQuote(deal.id, "Second letter.", `second-${deal.id}`);
    await supportEmploymentDocument(workspace.id, deal.id, two.id, first.id, "First letter.");
    await supportEmploymentDocument(workspace.id, deal.id, two.id, second.id, "Second letter.");
    const oneStrength = await getAssertionStrength(prisma, { assertionType: "Employment", assertionId: one.id });
    const twoStrength = await getAssertionStrength(prisma, { assertionType: "Employment", assertionId: two.id });
    assert.ok(oneStrength && twoStrength);
    assert.equal(oneStrength.distinctDocumentCount, 1);
    assert.equal(twoStrength.distinctDocumentCount, 2);
    assert.ok(twoStrength.strengthScore > oneStrength.strengthScore);

    const recentCompany = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Recent Co" });
    const oldCompany = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Old Co" });
    const recent = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: recentCompany.id,
      affiliationKind: "COUNSEL",
    });
    const old = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: oldCompany.id,
      affiliationKind: "FOUNDER",
    });
    await supportEmployment(workspace.id, deal.id, recent.id, "recent evidence");
    const oldObservation = await supportEmployment(workspace.id, deal.id, old.id, "old evidence");
    await prisma.relationshipObservation.update({
      where: { id: oldObservation.id },
      data: { createdAt: new Date("2020-01-01T00:00:00Z") },
    });
    const recentStrength = await getAssertionStrength(prisma, { assertionType: "Employment", assertionId: recent.id });
    const oldStrength = await getAssertionStrength(prisma, { assertionType: "Employment", assertionId: old.id });
    assert.ok(recentStrength && oldStrength);
    assert.equal(recentStrength.recency, "recent");
    assert.equal(oldStrength.recency, "older");
    assert.ok(recentStrength.strengthScore > oldStrength.strengthScore);

    const bare = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "COMPANY",
      targetId: thinCompany.id,
      maxDepth: 1,
    });
    assert.equal(bare.paths[0]?.edges[0].strengthLabel, "Limited");
    assert.ok(bare.paths[0].edges[0].strengthScore < 0.4);
    assert.equal(bare.paths[0].edges[0].strengthReasons.join(" ").includes("%"), false);
  });

  test("T evidence can be read for every canonical assertion type", async () => {
    const { workspace, deal } = await workspaceDeal("Evidence");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Evidence Person" });
    const company = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Evidence Co" });
    const property = await createProperty(prisma, { workspaceId: workspace.id, canonicalName: "Evidence Tower" });
    await linkDealProperty(prisma, { workspaceId: workspace.id, dealId: deal.id, propertyId: property.id });
    const employment = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: company.id,
    });
    const stake = await createPropertyStake(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      companyId: company.id,
      propertyId: property.id,
      predicate: "OWNS",
    });
    const participation = await createDealParticipation(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      dealId: deal.id,
      role: "LANDLORD",
      companyId: company.id,
    });
    const employmentEvidence = await getRelationshipEvidence(prisma, { employmentId: employment.id });
    const stakeEvidence = await getRelationshipEvidence(prisma, { propertyStakeId: stake.id });
    const participationEvidence = await getRelationshipEvidence(prisma, { dealParticipationId: participation.id });
    const dealEvidence = await getRelationshipEvidence(prisma, { dealId: deal.id });
    for (const evidence of [employmentEvidence, stakeEvidence, participationEvidence, dealEvidence]) {
      assert.ok(evidence);
      assert.equal(typeof evidence.supportCount, "number");
      assert.ok(evidence.title.length > 0);
    }
  });

  test("U/V/W cross-workspace, pending, and rejected observations do not connect", async () => {
    const left = await workspaceDeal("Left path");
    const right = await workspaceDeal("Right path");
    const person = await createPerson(prisma, { workspaceId: left.workspace.id, canonicalName: "Left Person" });
    const company = await createCompany(prisma, { workspaceId: right.workspace.id, canonicalName: "Right Co" });
    await assert.rejects(
      () =>
        findConnectionPaths(prisma, {
          sourceType: "PERSON",
          sourceId: person.id,
          targetType: "COMPANY",
          targetId: company.id,
          maxDepth: 4,
        }),
      (error: unknown) => error instanceof GraphRequestError && error.status === 400
    );

    const localCompany = await createCompany(prisma, { workspaceId: left.workspace.id, canonicalName: "Unlinked Co" });
    const subject = await recordEntityObservation(prisma, {
      ...manualObservation,
      workspaceId: left.workspace.id,
      dealId: left.deal.id,
      observedType: "PERSON",
      surfaceForm: "Left Person",
      evidenceQuote: "Left Person",
    });
    const object = await recordEntityObservation(prisma, {
      ...manualObservation,
      workspaceId: left.workspace.id,
      dealId: left.deal.id,
      observedType: "COMPANY",
      surfaceForm: "Unlinked Co",
      evidenceQuote: "Unlinked Co",
    });
    await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: left.workspace.id,
      predicate: "WORKS_AT",
      subjectObservationId: subject.id,
      objectObservationId: object.id,
      dealId: left.deal.id,
      evidenceQuote: "Left Person may work at Unlinked Co.",
    });
    const pending = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "COMPANY",
      targetId: localCompany.id,
      maxDepth: 4,
    });
    assert.equal(pending.paths.length, 0);

    const rejectedSubject = await recordEntityObservation(prisma, {
      ...manualObservation,
      workspaceId: left.workspace.id,
      dealId: left.deal.id,
      observedType: "PERSON",
      surfaceForm: "Left Person",
      evidenceQuote: "Left Person",
    });
    const rejectedObject = await recordEntityObservation(prisma, {
      ...manualObservation,
      workspaceId: left.workspace.id,
      dealId: left.deal.id,
      observedType: "COMPANY",
      surfaceForm: "Unlinked Co",
      evidenceQuote: "Unlinked Co",
    });
    const rejected = await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: left.workspace.id,
      predicate: "WORKS_AT",
      subjectObservationId: rejectedSubject.id,
      objectObservationId: rejectedObject.id,
      dealId: left.deal.id,
      evidenceQuote: "Left Person works at Unlinked Co.",
    });
    await rejectRelationshipObservation(prisma, rejected.id, "Not this firm");
    const afterReject = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "COMPANY",
      targetId: localCompany.id,
      maxDepth: 4,
    });
    assert.equal(afterReject.paths.length, 0);
  });

  test("X/Y/Z reads stay read-only and leave the map and knowledge page intact", async () => {
    const { workspace, deal } = await workspaceDeal("Regression");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Sarah Chen" });
    const company = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "JLL Boston" });
    await createEmployment(prisma, { ...manualAssertion, workspaceId: workspace.id, personId: person.id, companyId: company.id });
    const beforeKnowledge = await getDealKnowledge(prisma, deal.id);
    const before = await fingerprint(workspace.id);
    await searchCanonicalEntities(prisma, { workspaceId: workspace.id, q: "Sarah" });
    await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: person.id,
      targetType: "COMPANY",
      targetId: company.id,
      maxDepth: 4,
    });
    const graph = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: person.id, depth: 1 });
    assert.equal(graph?.edges[0]?.relationshipType, "WORKS_AT");
    assert.equal(graph?.nodes.some((node) => node.label === "JLL Boston"), true);
    const afterKnowledge = await getDealKnowledge(prisma, deal.id);
    assert.deepEqual(afterKnowledge, beforeKnowledge);
    assert.deepEqual(await fingerprint(workspace.id), before);
  });

  test("200 Clarendon seed exposes search hits and a real path", async () => {
    const { workspace, deal } = await workspaceDeal("Clarendon seed");
    const thread = await prisma.thread.create({
      data: { dealId: deal.id, subject: "200 Clarendon", participants: "[]" },
    });
    const body = [
      "Sarah Chen",
      "JLL Boston",
      "Senior VP, Tenant Representation | JLL Boston",
      "Derek Hollis",
      "Boston Properties",
      "Director of Leasing | Boston Properties",
    ].join("\n");
    const tenantMessage = await prisma.message.create({
      data: { threadId: thread.id, sender: "Sarah Chen", recipients: "[]", sentAt: new Date(), body },
    });
    const landlordMessage = await prisma.message.create({
      data: { threadId: thread.id, sender: "Derek Hollis", recipients: "[]", sentAt: new Date(), body },
    });
    await seedClarendonGraph(prisma, { workspaceId: workspace.id, dealId: deal.id, tenantMessage, landlordMessage });

    for (const query of ["Sarah Chen", "JLL Boston", "Boston Properties", "200 Clarendon"]) {
      const hits = await searchCanonicalEntities(prisma, { workspaceId: workspace.id, q: query });
      assert.ok(hits.some((hit) => hit.label.toLowerCase().includes(query.toLowerCase().slice(0, 6))), query);
    }
    const sarah = await prisma.person.findFirst({ where: { workspaceId: workspace.id, canonicalName: "Sarah Chen" } });
    const owner = await prisma.company.findFirst({
      where: { workspaceId: workspace.id, canonicalName: "Boston Properties" },
    });
    const jll = await prisma.company.findFirst({ where: { workspaceId: workspace.id, canonicalName: "JLL Boston" } });
    assert.ok(sarah && owner && jll);
    const sarahToOwner = await findConnectionPaths(prisma, {
      sourceType: "PERSON",
      sourceId: sarah.id,
      targetType: "COMPANY",
      targetId: owner.id,
      maxDepth: 4,
    });
    assert.ok(sarahToOwner.paths.length > 0);
    assert.ok(sarahToOwner.paths.length <= 3);
    assert.equal(sarahToOwner.paths[0].hops <= sarahToOwner.paths[sarahToOwner.paths.length - 1].hops, true);
    assert.match(sarahToOwner.paths[0].explanation, /Sarah Chen/);
    assert.match(sarahToOwner.paths[0].explanation, /Boston Properties/);
    assert.equal(/knows|friend|introduce/i.test(sarahToOwner.paths[0].explanation), false);
    for (const edge of sarahToOwner.paths[0].edges) {
      assert.ok(edge.strengthLabel === "Strong" || edge.strengthLabel === "Moderate" || edge.strengthLabel === "Limited");
      const evidence =
        edge.canonicalAssertionType === "Employment"
          ? await getRelationshipEvidence(prisma, { employmentId: edge.canonicalAssertionId })
          : edge.canonicalAssertionType === "PropertyStake"
            ? await getRelationshipEvidence(prisma, { propertyStakeId: edge.canonicalAssertionId })
            : edge.canonicalAssertionType === "DealParticipation"
              ? await getRelationshipEvidence(prisma, { dealParticipationId: edge.canonicalAssertionId })
              : await getRelationshipEvidence(prisma, { dealId: edge.canonicalAssertionId });
      assert.ok(evidence);
    }
    const jllToOwner = await findConnectionPaths(prisma, {
      sourceType: "COMPANY",
      sourceId: jll.id,
      targetType: "COMPANY",
      targetId: owner.id,
      maxDepth: 4,
    });
    assert.ok(jllToOwner.paths.length > 0);
  });
});

async function workspaceDeal(name: string) {
  sequence += 1;
  const workspace = await createWorkspace(prisma, { name: `${name} ${sequence}` });
  const deal = await prisma.deal.create({
    data: {
      name,
      company: "Acme Corp",
      property: "Tower",
      stage: "LOI",
      status: "ACTIVE",
      workspaceId: workspace.id,
    },
  });
  return { workspace, deal };
}

async function brokerAndLandlord(name: string) {
  const { workspace, deal } = await workspaceDeal(name);
  const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Sarah Chen" });
  const landlord = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Boston Properties" });
  await createDealParticipation(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT_BROKER",
    personId: person.id,
  });
  await createDealParticipation(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "LANDLORD",
    companyId: landlord.id,
  });
  return { workspace, deal, person, landlord };
}

async function fourHop(name: string) {
  const { workspace, deal } = await workspaceDeal(name);
  const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Nora Hale" });
  const brokerage = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Hale Brokerage" });
  const owner = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Hale Owner" });
  const property = await createProperty(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Hale Tower",
    city: "Boston",
    region: "MA",
    assetType: "OFFICE",
  });
  await linkDealProperty(prisma, { workspaceId: workspace.id, dealId: deal.id, propertyId: property.id });
  await createEmployment(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    personId: person.id,
    companyId: brokerage.id,
  });
  await createDealParticipation(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT_BROKERAGE",
    companyId: brokerage.id,
  });
  await createPropertyStake(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    companyId: owner.id,
    propertyId: property.id,
    predicate: "OWNS",
  });
  return { workspace, deal, person, owner };
}

async function supportEmployment(workspaceId: string, dealId: string, employmentId: string, quote: string) {
  const employment = await prisma.employment.findUniqueOrThrow({ where: { id: employmentId } });
  const person = await prisma.person.findUniqueOrThrow({ where: { id: employment.personId } });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: employment.companyId } });
  const subject = await recordEntityObservation(prisma, {
    ...manualObservation,
    workspaceId,
    dealId,
    observedType: "PERSON",
    surfaceForm: person.canonicalName,
    evidenceQuote: person.canonicalName,
  });
  const object = await recordEntityObservation(prisma, {
    ...manualObservation,
    workspaceId,
    dealId,
    observedType: "COMPANY",
    surfaceForm: company.canonicalName,
    evidenceQuote: company.canonicalName,
  });
  const relationship = await recordRelationshipObservation(prisma, {
    ...manualObservation,
    workspaceId,
    predicate: "WORKS_AT",
    subjectObservationId: subject.id,
    objectObservationId: object.id,
    affiliationKind: employment.affiliationKind,
    dealId,
    evidenceQuote: quote,
  });
  await attachObservationSupport(prisma, { workspaceId, employmentId, relationshipObservationId: relationship.id });
  return relationship;
}

async function supportEmploymentDocument(
  workspaceId: string,
  dealId: string,
  employmentId: string,
  documentId: string,
  quote: string
) {
  const employment = await prisma.employment.findUniqueOrThrow({ where: { id: employmentId } });
  const person = await prisma.person.findUniqueOrThrow({ where: { id: employment.personId } });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: employment.companyId } });
  const subject = await recordEntityObservation(prisma, {
    workspaceId,
    dealId,
    documentId,
    sourceKind: "DOCUMENT_PAGE",
    observedType: "PERSON",
    surfaceForm: person.canonicalName,
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  const object = await recordEntityObservation(prisma, {
    workspaceId,
    dealId,
    documentId,
    sourceKind: "DOCUMENT_PAGE",
    observedType: "COMPANY",
    surfaceForm: company.canonicalName,
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  const relationship = await recordRelationshipObservation(prisma, {
    workspaceId,
    dealId,
    documentId,
    sourceKind: "DOCUMENT_PAGE",
    predicate: "WORKS_AT",
    subjectObservationId: subject.id,
    objectObservationId: object.id,
    affiliationKind: employment.affiliationKind,
    evidenceQuote: quote,
    extractor: "manual",
    extractorVersion: "test",
  });
  await attachObservationSupport(prisma, { workspaceId, employmentId, relationshipObservationId: relationship.id });
  return relationship;
}

async function supportParticipation(
  workspaceId: string,
  dealId: string,
  participationId: string,
  surface: string,
  quote: string
) {
  const participation = await prisma.dealParticipation.findUniqueOrThrow({ where: { id: participationId } });
  const subject = await recordEntityObservation(prisma, {
    ...manualObservation,
    workspaceId,
    dealId,
    observedType: participation.personId ? "PERSON" : "COMPANY",
    surfaceForm: surface,
    evidenceQuote: surface,
  });
  const relationship = await recordRelationshipObservation(prisma, {
    ...manualObservation,
    workspaceId,
    predicate: "PARTICIPATES_AS",
    participationRole: participation.role,
    subjectObservationId: subject.id,
    contextDealId: dealId,
    dealId,
    evidenceQuote: quote,
  });
  await attachObservationSupport(prisma, {
    workspaceId,
    dealParticipationId: participationId,
    relationshipObservationId: relationship.id,
  });
}

async function documentWithQuote(dealId: string, quote: string, key: string) {
  return prisma.document.create({
    data: {
      dealId,
      filename: `${key}.pdf`,
      originalFilename: key,
      mimeType: "application/pdf",
      sizeBytes: 12,
      sha256: key,
      documentType: "LOI",
      storageKey: `${key}.pdf`,
      pages: { create: [{ pageNumber: 1, text: quote }] },
    },
  });
}

async function fingerprint(workspaceId: string) {
  const [employments, stakes, participations, promotions, people, companies, deals] = await Promise.all([
    prisma.employment.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.propertyStake.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.dealParticipation.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.relationshipPromotion.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.person.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.company.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.deal.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
  ]);
  return { employments, stakes, participations, promotions, people, companies, deals };
}
