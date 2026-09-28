import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "@/lib/documents/testDb";
import {
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
import { getDealKnowledge, getRelationshipEvidence, rejectRelationshipObservation } from "@/lib/promotion/service";
import { relationshipLabel } from "./labels";
import { mergeConnectionGraphs } from "./project";
import { GraphQueryError, parseGraphQuery } from "./query";
import { getConnectionGraph } from "./service";
import type { ConnectionGraph } from "./types";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

const manualAssertion = { assertionSource: "MANUAL" as const };
const manualObservation = {
  sourceKind: "MANUAL" as const,
  extractor: "manual",
  extractorVersion: "test",
};

describe("connection graph", { concurrency: 1 }, () => {
  test.before(async () => {
    const db = await createTestDatabase();
    prisma = db.prisma;
    cleanup = db.cleanup;
  });

  test.after(async () => {
    await cleanup();
  });

  test("labels and merge stay stable", () => {
    assert.equal(relationshipLabel("WORKS_AT"), "Works at");
    assert.equal(relationshipLabel("TENANT_BROKER"), "Tenant broker");
    assert.equal(relationshipLabel("OWNS"), "Owns");
    assert.equal(relationshipLabel("MANAGES"), "Manages");
    assert.equal(relationshipLabel("OTHER", "Outside counsel"), "Outside counsel");
    const base = emptyGraph("deal:1");
    const extra = emptyGraph("person:2");
    extra.nodes.push({
      id: "person:2",
      entityType: "PERSON",
      entityId: "2",
      label: "Sarah Chen",
      subtitle: null,
      metadata: {},
    });
    extra.edges.push({
      id: "employment:1",
      source: "person:2",
      target: "company:3",
      relationshipType: "WORKS_AT",
      label: "Works at",
      canonicalAssertionType: "Employment",
      canonicalAssertionId: "1",
      supportCount: 0,
    });
    const merged = mergeConnectionGraphs(base, extra);
    const again = mergeConnectionGraphs(merged, extra);
    assert.equal(again.nodes.length, merged.nodes.length);
    assert.equal(again.edges.length, merged.edges.length);
    assert.equal(again.metadata.nodeId, "deal:1");
    assert.throws(
      () => parseGraphQuery(new URLSearchParams("rootType=DEAL&rootId=abc&workspaceId=other")),
      GraphQueryError
    );
  });

  test("A deal root returns canonical nodes", async () => {
    const fixture = await scaffold("Deal root");
    const graph = await getConnectionGraph(prisma, {
      rootType: "DEAL",
      rootId: fixture.deal.id,
      depth: 2,
    });
    assert.ok(graph);
    const labels = graph.nodes.map((node) => node.label);
    for (const expected of [
      "Sarah Chen",
      "Acme Corp",
      "Boston Properties",
      "200 Clarendon",
      "Harborline Management",
      "JLL Boston",
    ]) {
      assert.ok(labels.includes(expected), expected);
    }
    assert.equal(graph.metadata.workspaceId, fixture.workspace.id);
    assert.equal(graph.nodes.filter((node) => node.label === "Boston Properties").length, 1);
    assert.equal(await getConnectionGraph(prisma, { rootType: "DEAL", rootId: "missing", depth: 1 }), null);
  });

  test("B person root returns employment and ignores retired employment", async () => {
    const fixture = await scaffold("Person root");
    const retiredPerson = await createPerson(prisma, {
      workspaceId: fixture.workspace.id,
      canonicalName: "Retired Analyst",
    });
    const retiredCompany = await createCompany(prisma, {
      workspaceId: fixture.workspace.id,
      canonicalName: "Retired Co",
    });
    const retired = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: fixture.workspace.id,
      personId: retiredPerson.id,
      companyId: retiredCompany.id,
    });
    await prisma.employment.update({ where: { id: retired.id }, data: { status: "RETIRED" } });

    const graph = await getConnectionGraph(prisma, {
      rootType: "PERSON",
      rootId: fixture.sarah.id,
      depth: 1,
    });
    assert.ok(graph);
    const worksAt = graph.edges.find((edge) => edge.relationshipType === "WORKS_AT");
    assert.ok(worksAt);
    assert.equal(worksAt.canonicalAssertionType, "Employment");
    assert.equal(worksAt.target, `company:${fixture.jll.id}`);
    assert.equal(graph.nodes.some((node) => node.label === "Retired Co"), false);
    const retiredGraph = await getConnectionGraph(prisma, {
      rootType: "PERSON",
      rootId: retiredPerson.id,
      depth: 1,
    });
    assert.equal(retiredGraph?.edges.length, 0);
  });

  test("C company root returns employees and deal participation", async () => {
    const fixture = await scaffold("Company root");
    const graph = await getConnectionGraph(prisma, {
      rootType: "COMPANY",
      rootId: fixture.owner.id,
      depth: 1,
    });
    assert.ok(graph);
    assert.ok(graph.nodes.some((node) => node.label === "Derek Hollis"));
    assert.ok(graph.edges.some((edge) => edge.relationshipType === "LANDLORD"));
    assert.ok(graph.edges.some((edge) => edge.relationshipType === "WORKS_AT"));
  });

  test("D property root returns owner, manager, and deals", async () => {
    const fixture = await scaffold("Property root");
    const graph = await getConnectionGraph(prisma, {
      rootType: "PROPERTY",
      rootId: fixture.property.id,
      depth: 1,
    });
    assert.ok(graph);
    assert.ok(graph.edges.some((edge) => edge.relationshipType === "OWNS" && edge.source === `company:${fixture.owner.id}`));
    assert.ok(graph.edges.some((edge) => edge.relationshipType === "MANAGES"));
    assert.ok(graph.edges.some((edge) => edge.relationshipType === "CONCERNS_PROPERTY"));
    assert.equal(graph.nodes.some((node) => node.label === "Sarah Chen"), false);
  });

  test("E depth 1 excludes second-hop nodes", async () => {
    const fixture = await scaffold("Depth 1");
    const graph = await getConnectionGraph(prisma, {
      rootType: "DEAL",
      rootId: fixture.deal.id,
      depth: 1,
    });
    assert.ok(graph);
    const labels = graph.nodes.map((node) => node.label);
    assert.ok(labels.includes("Sarah Chen"));
    assert.ok(labels.includes("200 Clarendon"));
    assert.equal(labels.includes("JLL Boston"), false);
    assert.equal(labels.includes("Harborline Management"), false);
    assert.equal(labels.includes("Derek Hollis"), false);
  });

  test("F depth 2 includes second-hop nodes", async () => {
    const fixture = await scaffold("Depth 2");
    const graph = await getConnectionGraph(prisma, {
      rootType: "DEAL",
      rootId: fixture.deal.id,
      depth: 2,
    });
    assert.ok(graph);
    const labels = graph.nodes.map((node) => node.label);
    assert.ok(labels.includes("JLL Boston"));
    assert.ok(labels.includes("Harborline Management"));
    assert.ok(labels.includes("Derek Hollis"));
  });

  test("G cycles do not duplicate nodes", async () => {
    const fixture = await scaffold("Cycles");
    const graph = await getConnectionGraph(prisma, {
      rootType: "DEAL",
      rootId: fixture.deal.id,
      depth: 2,
    });
    assert.ok(graph);
    const ids = graph.nodes.map((node) => node.id);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(graph.nodes.filter((node) => node.id === `company:${fixture.owner.id}`).length, 1);
    assert.equal(graph.nodes.filter((node) => node.id === `deal:${fixture.deal.id}`).length, 1);
  });

  test("H edges are deduplicated", async () => {
    const fixture = await scaffold("Edge dedupe");
    const graph = await getConnectionGraph(prisma, {
      rootType: "DEAL",
      rootId: fixture.deal.id,
      depth: 2,
    });
    assert.ok(graph);
    const ids = graph.edges.map((edge) => edge.id);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(graph.edges.filter((edge) => edge.id === `deal-property:${fixture.deal.id}`).length, 1);
  });

  test("I workspace isolation", async () => {
    const left = await scaffold("Workspace A");
    const right = await scaffold("Workspace B");
    await createCompany(prisma, {
      workspaceId: right.workspace.id,
      canonicalName: "Secret Holdings",
    });
    const graph = await getConnectionGraph(prisma, {
      rootType: "DEAL",
      rootId: left.deal.id,
      depth: 2,
    });
    assert.ok(graph);
    assert.equal(graph.metadata.workspaceId, left.workspace.id);
    const entityIds = new Set(graph.nodes.map((node) => node.entityId));
    for (const id of [right.deal.id, right.sarah.id, right.jll.id, right.property.id, right.owner.id]) {
      assert.equal(entityIds.has(id), false);
    }
    assert.equal(graph.nodes.some((node) => node.label === "Secret Holdings"), false);
    const fromPerson = await getConnectionGraph(prisma, {
      rootType: "PERSON",
      rootId: left.sarah.id,
      depth: 2,
    });
    assert.equal(fromPerson?.nodes.some((node) => node.entityId === right.jll.id), false);
  });

  test("J/K/L/M/N support counts and evidence", async () => {
    const { workspace, deal } = await workspaceDeal("Evidence");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Sarah Chen" });
    const company = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "JLL Boston" });
    const property = await createProperty(prisma, {
      workspaceId: workspace.id,
      canonicalName: "200 Clarendon",
      city: "Boston",
      region: "MA",
    });
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
    const bareStake = await createPropertyStake(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      companyId: company.id,
      propertyId: property.id,
      predicate: "MANAGES",
    });
    const participation = await createDealParticipation(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      dealId: deal.id,
      role: "TENANT_BROKER",
      personId: person.id,
      representsCompanyId: company.id,
    });

    for (const quote of ["Sarah works at JLL.", "Sarah is with JLL Boston.", "Employed by JLL."]) {
      const subject = await observe(workspace.id, deal.id, "PERSON", "Sarah Chen");
      const object = await observe(workspace.id, deal.id, "COMPANY", "JLL Boston");
      const relationship = await recordRelationshipObservation(prisma, {
        ...manualObservation,
        workspaceId: workspace.id,
        predicate: "WORKS_AT",
        subjectObservationId: subject.id,
        objectObservationId: object.id,
        dealId: deal.id,
        evidenceQuote: quote,
      });
      await attachObservationSupport(prisma, {
        workspaceId: workspace.id,
        employmentId: employment.id,
        relationshipObservationId: relationship.id,
      });
    }

    const stakeSubject = await observe(workspace.id, deal.id, "COMPANY", "JLL Boston");
    const stakeObject = await observe(workspace.id, deal.id, "PROPERTY", "200 Clarendon");
    const stakeObservation = await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: workspace.id,
      predicate: "OWNS",
      subjectObservationId: stakeSubject.id,
      objectObservationId: stakeObject.id,
      dealId: deal.id,
      evidenceQuote: "JLL Boston owns 200 Clarendon.",
    });
    await attachObservationSupport(prisma, {
      workspaceId: workspace.id,
      propertyStakeId: stake.id,
      relationshipObservationId: stakeObservation.id,
    });

    const actor = await observe(workspace.id, deal.id, "PERSON", "Sarah Chen");
    const participationObservation = await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: workspace.id,
      predicate: "PARTICIPATES_AS",
      subjectObservationId: actor.id,
      participationRole: "TENANT_BROKER",
      contextDealId: deal.id,
      dealId: deal.id,
      evidenceQuote: "Sarah Chen is tenant broker.",
    });
    await attachObservationSupport(prisma, {
      workspaceId: workspace.id,
      dealParticipationId: participation.id,
      relationshipObservationId: participationObservation.id,
    });

    const propertyMention = await observe(workspace.id, deal.id, "PROPERTY", "200 Clarendon");
    const concerns = await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: workspace.id,
      predicate: "CONCERNS_PROPERTY",
      subjectObservationId: propertyMention.id,
      contextDealId: deal.id,
      dealId: deal.id,
      evidenceQuote: "This deal concerns 200 Clarendon.",
    });
    await prisma.relationshipPromotion.create({
      data: {
        workspaceId: workspace.id,
        relationshipObservationId: concerns.id,
        decision: "APPROVED",
        reviewedAt: new Date(),
        actor: "MANUAL_REVIEW",
        linkedDealId: deal.id,
      },
    });

    const graph = await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 2 });
    assert.ok(graph);
    const worksAt = graph.edges.find((edge) => edge.id === `employment:${employment.id}`);
    const owns = graph.edges.find((edge) => edge.id === `stake:${stake.id}`);
    const manages = graph.edges.find((edge) => edge.id === `stake:${bareStake.id}`);
    const broker = graph.edges.find((edge) => edge.id === `participation:${participation.id}`);
    const propertyEdge = graph.edges.find((edge) => edge.id === `deal-property:${deal.id}`);
    assert.equal(worksAt?.supportCount, 3);
    assert.equal(owns?.supportCount, 1);
    assert.equal(manages?.supportCount, 0);
    assert.equal(broker?.supportCount, 1);
    assert.equal(propertyEdge?.supportCount, 1);

    const employmentEvidence = await getRelationshipEvidence(prisma, { employmentId: employment.id });
    const stakeEvidence = await getRelationshipEvidence(prisma, { propertyStakeId: stake.id });
    const participationEvidence = await getRelationshipEvidence(prisma, { dealParticipationId: participation.id });
    const propertyEvidence = await getRelationshipEvidence(prisma, { dealId: deal.id });
    const bareEvidence = await getRelationshipEvidence(prisma, { propertyStakeId: bareStake.id });
    assert.equal(employmentEvidence?.supportCount, 3);
    assert.deepEqual(
      employmentEvidence?.supports.map((support) => support.quote).sort(),
      ["Employed by JLL.", "Sarah is with JLL Boston.", "Sarah works at JLL."]
    );
    assert.equal(stakeEvidence?.supports[0]?.quote, "JLL Boston owns 200 Clarendon.");
    assert.equal(participationEvidence?.supports[0]?.quote, "Sarah Chen is tenant broker.");
    assert.equal(propertyEvidence?.supportCount, 1);
    assert.equal(bareEvidence?.supportCount, 0);
    assert.equal(bareEvidence?.supports.length, 0);
  });

  test("O unresolved observations are not graph edges", async () => {
    const { workspace, deal } = await workspaceDeal("Unresolved");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Known Person" });
    await observe(workspace.id, deal.id, "PERSON", "Ghost Person");
    const subject = await observe(workspace.id, deal.id, "PERSON", "Known Person");
    const object = await observe(workspace.id, deal.id, "COMPANY", "Unconfirmed Co");
    await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: workspace.id,
      predicate: "WORKS_AT",
      subjectObservationId: subject.id,
      objectObservationId: object.id,
      dealId: deal.id,
      evidenceQuote: "Known Person may work at Unconfirmed Co.",
    });
    const graph = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: person.id, depth: 2 });
    assert.ok(graph);
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.nodes.some((node) => node.label === "Ghost Person"), false);
    assert.equal(graph.nodes.some((node) => node.label === "Unconfirmed Co"), false);
    const dealGraph = await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 1 });
    assert.ok(dealGraph);
    assert.ok((dealGraph.metadata.unresolvedObservationCount ?? 0) >= 4);
    assert.equal(dealGraph.edges.length, 0);
  });

  test("P rejected observations are not graph edges", async () => {
    const { workspace, deal } = await workspaceDeal("Rejected");
    const subject = await observe(workspace.id, deal.id, "PERSON", "Rejected Person");
    const object = await observe(workspace.id, deal.id, "COMPANY", "Rejected Co");
    const relationship = await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: workspace.id,
      predicate: "WORKS_AT",
      subjectObservationId: subject.id,
      objectObservationId: object.id,
      dealId: deal.id,
      evidenceQuote: "Rejected Person works at Rejected Co.",
    });
    await rejectRelationshipObservation(prisma, relationship.id, "Not this firm");
    const graph = await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 2 });
    assert.ok(graph);
    assert.equal(graph.edges.length, 0);
    assert.equal(graph.nodes.some((node) => node.label === "Rejected Co"), false);
  });

  test("Q pending relationship promotions are not graph edges", async () => {
    const { workspace, deal } = await workspaceDeal("Pending");
    const subject = await observe(workspace.id, deal.id, "COMPANY", "Pending Owner");
    const object = await observe(workspace.id, deal.id, "PROPERTY", "Pending Tower");
    const relationship = await recordRelationshipObservation(prisma, {
      ...manualObservation,
      workspaceId: workspace.id,
      predicate: "OWNS",
      subjectObservationId: subject.id,
      objectObservationId: object.id,
      dealId: deal.id,
      evidenceQuote: "Pending Owner owns Pending Tower.",
    });
    assert.equal(await prisma.relationshipPromotion.count({ where: { relationshipObservationId: relationship.id } }), 0);
    const graph = await getConnectionGraph(prisma, { rootType: "DEAL", rootId: deal.id, depth: 2 });
    assert.ok(graph);
    assert.equal(graph.edges.some((edge) => edge.relationshipType === "OWNS"), false);
  });

  test("R accepted canonical relationships appear", async () => {
    const { workspace, deal } = await workspaceDeal("Accepted");
    const person = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Priya Shah" });
    const company = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "CBRE" });
    const employment = await createEmployment(prisma, {
      ...manualAssertion,
      workspaceId: workspace.id,
      personId: person.id,
      companyId: company.id,
      affiliationKind: "BROKER",
    });
    const graph = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: person.id, depth: 1 });
    assert.ok(graph);
    const edge = graph.edges.find((item) => item.canonicalAssertionId === employment.id);
    assert.ok(edge);
    assert.equal(edge.relationshipType, "WORKS_AT");
    assert.equal(edge.label, "Works at");
    assert.equal(edge.source, `person:${person.id}`);
    assert.equal(edge.target, `company:${company.id}`);
    assert.equal(graph.metadata.workspaceId, workspace.id);
    assert.notEqual(graph.metadata.rootId, deal.id);
  });

  test("S graph read does not mutate canonical data", async () => {
    const fixture = await scaffold("Read only");
    const before = await snapshot(fixture.workspace.id);
    await getConnectionGraph(prisma, { rootType: "DEAL", rootId: fixture.deal.id, depth: 2 });
    await getConnectionGraph(prisma, { rootType: "PERSON", rootId: fixture.sarah.id, depth: 2 });
    const after = await snapshot(fixture.workspace.id);
    assert.deepEqual(after, before);
  });

  test("T deal knowledge stays correct after a graph read", async () => {
    const fixture = await scaffold("Knowledge");
    const before = await getDealKnowledge(prisma, fixture.deal.id);
    await getConnectionGraph(prisma, { rootType: "DEAL", rootId: fixture.deal.id, depth: 2 });
    const after = await getDealKnowledge(prisma, fixture.deal.id);
    assert.deepEqual(after, before);
    assert.equal(after?.canonical.property?.name, "200 Clarendon");
    assert.ok(after?.canonical.participations.some((row) => row.actorName === "Acme Corp" && row.role === "TENANT"));
    assert.ok(after?.canonical.people.some((person) => person.name === "Sarah Chen"));
  });

  test("depth above 2 is rejected", async () => {
    await assert.rejects(
      () => getConnectionGraph(prisma, { rootType: "DEAL", rootId: "whatever", depth: 3 }),
      GraphQueryError
    );
    await assert.rejects(
      () => getConnectionGraph(prisma, { rootType: "FIRM", rootId: "whatever", depth: 1 }),
      GraphQueryError
    );
  });
});

function emptyGraph(nodeId: string): ConnectionGraph {
  return {
    nodes: [
      {
        id: nodeId,
        entityType: "DEAL",
        entityId: "1",
        label: "Deal",
        subtitle: null,
        metadata: {},
      },
    ],
    edges: [],
    metadata: {
      rootType: "DEAL",
      rootId: "1",
      nodeId,
      workspaceId: "ws",
      depth: 1,
      unresolvedObservationCount: null,
      reviewHref: null,
    },
  };
}

async function workspaceDeal(name: string) {
  const workspace = await createWorkspace(prisma, { name: `${name} ${Date.now()}-${Math.random()}` });
  const deal = await prisma.deal.create({
    data: {
      name,
      company: "Acme Corp",
      property: "200 Clarendon Street",
      stage: "LOI",
      status: "ACTIVE",
      workspaceId: workspace.id,
    },
  });
  return { workspace, deal };
}

async function observe(
  workspaceId: string,
  dealId: string,
  observedType: "PERSON" | "COMPANY" | "PROPERTY",
  surfaceForm: string
) {
  return recordEntityObservation(prisma, {
    ...manualObservation,
    workspaceId,
    dealId,
    observedType,
    surfaceForm,
    evidenceQuote: surfaceForm,
  });
}

async function scaffold(name: string) {
  const { workspace, deal } = await workspaceDeal(name);
  const property = await createProperty(prisma, {
    workspaceId: workspace.id,
    canonicalName: "200 Clarendon",
    addressLine1: "200 Clarendon Street",
    city: "Boston",
    region: "MA",
    assetType: "OFFICE",
  });
  await linkDealProperty(prisma, { workspaceId: workspace.id, dealId: deal.id, propertyId: property.id });
  const acme = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Acme Corp" });
  const owner = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Boston Properties" });
  const manager = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Harborline Management" });
  const jll = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "JLL Boston" });
  const sarah = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Sarah Chen",
    primaryTitle: "Senior VP, Tenant Representation",
  });
  const derek = await createPerson(prisma, {
    workspaceId: workspace.id,
    canonicalName: "Derek Hollis",
    primaryTitle: "Director of Leasing",
  });
  await createEmployment(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    personId: sarah.id,
    companyId: jll.id,
    affiliationKind: "BROKER",
  });
  await createEmployment(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    personId: derek.id,
    companyId: owner.id,
  });
  await createPropertyStake(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    companyId: owner.id,
    propertyId: property.id,
    predicate: "OWNS",
  });
  await createPropertyStake(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    companyId: manager.id,
    propertyId: property.id,
    predicate: "MANAGES",
  });
  await createDealParticipation(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT",
    companyId: acme.id,
  });
  await createDealParticipation(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "LANDLORD",
    companyId: owner.id,
  });
  await createDealParticipation(prisma, {
    ...manualAssertion,
    workspaceId: workspace.id,
    dealId: deal.id,
    role: "TENANT_BROKER",
    personId: sarah.id,
    representsCompanyId: acme.id,
  });
  return { workspace, deal, property, acme, owner, manager, jll, sarah, derek };
}

async function snapshot(workspaceId: string) {
  const [employments, stakes, participations, promotions, entities, relationships, deals] = await Promise.all([
    prisma.employment.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.propertyStake.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.dealParticipation.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.relationshipPromotion.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.entityObservation.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.relationshipObservation.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
    prisma.deal.findMany({ where: { workspaceId }, orderBy: { id: "asc" } }),
  ]);
  return { employments, stakes, participations, promotions, entities, relationships, deals };
}
