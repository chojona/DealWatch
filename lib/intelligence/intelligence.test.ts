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
  recordObservationDisposition,
  recordRelationshipObservation,
} from "@/lib/entities/service";
import { getConnectionGraph } from "@/lib/graph/service";
import { GraphQueryError, parseSearchQuery } from "@/lib/graph/query";
import { searchCanonicalEntities } from "@/lib/graph/search";
import { canonicalEntityHref } from "./routes";
import { getCompanyIntelligence, getPersonIntelligence, getPropertyIntelligence } from "./service";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let sequence = 0;

const assertion = { assertionSource: "MANUAL" as const };
const observation = { sourceKind: "MANUAL" as const, extractor: "manual", extractorVersion: "phase8a-test" };

describe("Phase 8A canonical entity intelligence", { concurrency: 1 }, () => {
  test.before(async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test.after(async () => cleanup());

  test("A/D/E/N/O person intelligence returns canonical employment, participation, evidence, and zero-support assertions", async () => {
    const fixture = await scaffold("Person read");
    const data = await getPersonIntelligence(prisma, fixture.sarah.id);
    assert.ok(data);
    assert.equal(data.workspaceId, fixture.workspace.id);
    assert.equal(data.person.name, "Sarah Chen");
    assert.equal(data.employments.length, 1);
    assert.equal(data.employments[0]?.object.href, `/companies/${fixture.jll.id}`);
    assert.equal(data.employments[0]?.evidence.supportCount, 1);
    assert.equal(data.employments[0]?.evidence.supports[0]?.quote, "Sarah Chen works at JLL Boston.");
    assert.equal(data.deals.length, 1);
    assert.equal(data.deals[0]?.object.href, `/deals/${fixture.deal.id}`);
    assert.equal(data.deals[0]?.representedCompany?.href, `/companies/${fixture.acme.id}`);
    assert.equal(data.deals[0]?.evidence.supportCount, 0);
    assert.deepEqual(data.properties, []);
  });

  test("B/F/G/H/I company intelligence keeps roles contextual and exposes people, deals, stakes, and representation", async () => {
    const fixture = await scaffold("Company read");
    const jll = await getCompanyIntelligence(prisma, fixture.jll.id);
    assert.ok(jll);
    assert.equal(jll.people[0]?.subject.href, `/people/${fixture.sarah.id}`);
    assert.ok(jll.deals.some((row) => row.label === "tenant brokerage" && row.object.id === fixture.deal.id));
    assert.equal("globalRole" in jll.company, false);

    const acme = await getCompanyIntelligence(prisma, fixture.acme.id);
    assert.ok(acme);
    assert.ok(acme.deals.some((row) => row.label === "tenant"));
    assert.ok(acme.representation.some((row) => row.subject.id === fixture.sarah.id && row.context?.id === fixture.deal.id));

    const owner = await getCompanyIntelligence(prisma, fixture.owner.id);
    assert.ok(owner);
    assert.ok(owner.properties.some((row) => row.label === "Owns" && row.object.id === fixture.property.id));
  });

  test("C/J/K/L/M property intelligence separates direct stakes from deal participants", async () => {
    const fixture = await scaffold("Property read");
    const data = await getPropertyIntelligence(prisma, fixture.property.id);
    assert.ok(data);
    assert.ok(data.stakes.some((row) => row.label === "Owns" && row.subject.id === fixture.owner.id));
    assert.ok(data.stakes.some((row) => row.label === "Manages" && row.subject.id === fixture.manager.id));
    assert.ok(data.deals.some((row) => row.subject.id === fixture.deal.id));
    assert.ok(data.participants.some((row) => row.subject.id === fixture.sarah.id && row.detail?.includes("not a direct property relationship")));
    assert.equal(data.relationships.some((row) => row.id === fixture.sarahParticipation.id), false);
  });

  test("P/Q/R workspace isolation holds for person, company, property, participants, and graph neighbors", async () => {
    const left = await scaffold("Isolation left");
    const right = await scaffold("Isolation right");
    const secretPerson = await createPerson(prisma, { workspaceId: right.workspace.id, canonicalName: "Secret Person" });
    await createEmployment(prisma, { ...assertion, workspaceId: right.workspace.id, personId: secretPerson.id, companyId: right.jll.id });

    const person = await getPersonIntelligence(prisma, left.sarah.id);
    const company = await getCompanyIntelligence(prisma, left.jll.id);
    const property = await getPropertyIntelligence(prisma, left.property.id);
    assert.ok(person && company && property);
    const serialized = JSON.stringify({ person, company, property });
    for (const value of [right.deal.id, right.jll.id, right.property.id, secretPerson.id, "Secret Person"]) assert.equal(serialized.includes(value), false);

    const graph = await getConnectionGraph(prisma, { rootType: "PERSON", rootId: left.sarah.id, depth: 2 });
    assert.ok(graph);
    assert.equal(graph.nodes.some((node) => node.entityId === right.jll.id || node.entityId === secretPerson.id), false);
  });

  test("S/T unresolved and rejected observations never become confirmed knowledge or search results", async () => {
    const fixture = await scaffold("Observed truth");
    const before = await getPropertyIntelligence(prisma, fixture.property.id);
    assert.ok(before);
    const pending = await recordEntityObservation(prisma, {
      ...observation, workspaceId: fixture.workspace.id, dealId: fixture.deal.id, observedType: "COMPANY", surfaceForm: "Pending Ghost Co", evidenceQuote: "Pending Ghost Co",
    });
    const rejected = await recordEntityObservation(prisma, {
      ...observation, workspaceId: fixture.workspace.id, dealId: fixture.deal.id, observedType: "PERSON", surfaceForm: "Rejected Ghost", evidenceQuote: "Rejected Ghost",
    });
    await recordObservationDisposition(prisma, { entityObservationId: rejected.id, disposition: "REJECTED", actor: "USER" });
    const data = await getPropertyIntelligence(prisma, fixture.property.id);
    assert.ok(data);
    assert.equal(JSON.stringify(data).includes(pending.surfaceForm), false);
    assert.equal(JSON.stringify(data).includes(rejected.surfaceForm), false);
    assert.equal(data.pending.count, before.pending.count + 1);
    const results = await searchCanonicalEntities(prisma, { workspaceId: fixture.workspace.id, q: "Ghost" });
    assert.deepEqual(results, []);
  });

  test("U/V canonical links and search results navigate to first-class routes", async () => {
    const fixture = await scaffold("Navigation");
    const hits = await searchCanonicalEntities(prisma, { workspaceId: fixture.workspace.id, q: "Sarah" });
    assert.equal(canonicalEntityHref(hits[0]!.entityType, hits[0]!.entityId), `/people/${fixture.sarah.id}`);
    assert.equal(canonicalEntityHref("COMPANY", fixture.jll.id), `/companies/${fixture.jll.id}`);
    assert.equal(canonicalEntityHref("PROPERTY", fixture.property.id), `/properties/${fixture.property.id}`);
    assert.equal(canonicalEntityHref("DEAL", fixture.deal.id), `/deals/${fixture.deal.id}`);
    assert.throws(() => parseSearchQuery(new URLSearchParams("q=Sarah&workspaceId=attacker")), GraphQueryError);
  });

  test("W/X/Y/Z all canonical roots reuse the same connection graph and Deal behavior remains intact", async () => {
    const fixture = await scaffold("Graph roots");
    const roots = await Promise.all([
      getConnectionGraph(prisma, { rootType: "PERSON", rootId: fixture.sarah.id, depth: 2 }),
      getConnectionGraph(prisma, { rootType: "COMPANY", rootId: fixture.jll.id, depth: 2 }),
      getConnectionGraph(prisma, { rootType: "PROPERTY", rootId: fixture.property.id, depth: 2 }),
      getConnectionGraph(prisma, { rootType: "DEAL", rootId: fixture.deal.id, depth: 2 }),
    ]);
    assert.deepEqual(roots.map((graph) => graph?.metadata.rootType), ["PERSON", "COMPANY", "PROPERTY", "DEAL"]);
    assert.equal(roots[3]?.metadata.reviewHref, `/deals/${fixture.deal.id}/knowledge`);
    assert.ok(roots[3]?.edges.some((edge) => edge.relationshipType === "CONCERNS_PROPERTY"));
  });

  test("intelligence reads perform zero canonical writes", async () => {
    const fixture = await scaffold("Read only");
    const before = await canonicalSnapshot(fixture.workspace.id);
    await Promise.all([
      getPersonIntelligence(prisma, fixture.sarah.id),
      getCompanyIntelligence(prisma, fixture.jll.id),
      getPropertyIntelligence(prisma, fixture.property.id),
    ]);
    assert.deepEqual(await canonicalSnapshot(fixture.workspace.id), before);
  });

  test("200 Clarendon smoke path renders canonical navigation, evidence, and zero-support truthfully", async () => {
    const fixture = await scaffold("200 Clarendon smoke");
    const person = await getPersonIntelligence(prisma, fixture.sarah.id);
    const jll = await getCompanyIntelligence(prisma, fixture.jll.id);
    const property = await getPropertyIntelligence(prisma, fixture.property.id);
    const owner = await getCompanyIntelligence(prisma, fixture.owner.id);
    assert.ok(person && jll && property && owner);
    assert.equal(person.deals[0]?.object.href, `/deals/${fixture.deal.id}`);
    assert.equal(person.employments[0]?.object.href, `/companies/${fixture.jll.id}`);
    assert.ok(property.stakes.some((row) => row.subject.href === `/companies/${fixture.owner.id}`));
    assert.ok(owner.deals.some((row) => row.object.href === `/deals/${fixture.deal.id}`));
    assert.equal(person.employments[0]?.evidence.supportCount, 1);
    assert.equal(property.stakes.find((row) => row.label === "Manages")?.evidence.supportCount, 0);
  });
});

async function scaffold(label: string) {
  const workspace = await createWorkspace(prisma, { name: `${label} ${++sequence}` });
  const deal = await prisma.deal.create({ data: { name: "Acme Corp — 200 Clarendon", company: "Acme Corp", property: "200 Clarendon Street, Boston MA", stage: "Negotiation", status: "ACTIVE", workspaceId: workspace.id } });
  const property = await createProperty(prisma, { workspaceId: workspace.id, canonicalName: "200 Clarendon", addressLine1: "200 Clarendon Street", city: "Boston", region: "MA", assetType: "OFFICE" });
  await linkDealProperty(prisma, { workspaceId: workspace.id, dealId: deal.id, propertyId: property.id });
  const acme = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Acme Corp" });
  const owner = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Boston Properties" });
  const manager = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "Harborline Management" });
  const jll = await createCompany(prisma, { workspaceId: workspace.id, canonicalName: "JLL Boston" });
  const sarah = await createPerson(prisma, { workspaceId: workspace.id, canonicalName: "Sarah Chen", primaryTitle: "Senior VP, Tenant Representation" });
  const employment = await createEmployment(prisma, { ...assertion, workspaceId: workspace.id, personId: sarah.id, companyId: jll.id, affiliationKind: "BROKER", titleAtTime: "Senior VP, Tenant Representation" });
  const ownerStake = await createPropertyStake(prisma, { ...assertion, workspaceId: workspace.id, companyId: owner.id, propertyId: property.id, predicate: "OWNS" });
  await createPropertyStake(prisma, { ...assertion, workspaceId: workspace.id, companyId: manager.id, propertyId: property.id, predicate: "MANAGES" });
  await createDealParticipation(prisma, { ...assertion, workspaceId: workspace.id, dealId: deal.id, companyId: acme.id, role: "TENANT" });
  await createDealParticipation(prisma, { ...assertion, workspaceId: workspace.id, dealId: deal.id, companyId: owner.id, role: "LANDLORD" });
  await createDealParticipation(prisma, { ...assertion, workspaceId: workspace.id, dealId: deal.id, companyId: jll.id, representsCompanyId: acme.id, role: "TENANT_BROKERAGE" });
  const sarahParticipation = await createDealParticipation(prisma, { ...assertion, workspaceId: workspace.id, dealId: deal.id, personId: sarah.id, representsCompanyId: acme.id, role: "TENANT_BROKER" });

  const personMention = await mention(workspace.id, deal.id, "PERSON", "Sarah Chen");
  const companyMention = await mention(workspace.id, deal.id, "COMPANY", "JLL Boston");
  const worksAt = await recordRelationshipObservation(prisma, { ...observation, workspaceId: workspace.id, dealId: deal.id, predicate: "WORKS_AT", subjectObservationId: personMention.id, objectObservationId: companyMention.id, evidenceQuote: "Sarah Chen works at JLL Boston." });
  await attachObservationSupport(prisma, { workspaceId: workspace.id, employmentId: employment.id, relationshipObservationId: worksAt.id });
  const ownerMention = await mention(workspace.id, deal.id, "COMPANY", "Boston Properties");
  const propertyMention = await mention(workspace.id, deal.id, "PROPERTY", "200 Clarendon");
  const owns = await recordRelationshipObservation(prisma, { ...observation, workspaceId: workspace.id, dealId: deal.id, predicate: "OWNS", subjectObservationId: ownerMention.id, objectObservationId: propertyMention.id, evidenceQuote: "Boston Properties owns 200 Clarendon." });
  await attachObservationSupport(prisma, { workspaceId: workspace.id, propertyStakeId: ownerStake.id, relationshipObservationId: owns.id });
  return { workspace, deal, property, acme, owner, manager, jll, sarah, sarahParticipation };
}

function mention(workspaceId: string, dealId: string, observedType: "PERSON" | "COMPANY" | "PROPERTY", surfaceForm: string) {
  return recordEntityObservation(prisma, { ...observation, workspaceId, dealId, observedType, surfaceForm, evidenceQuote: surfaceForm });
}

async function canonicalSnapshot(workspaceId: string) {
  const [people, companies, properties, employments, stakes, participations, deals] = await Promise.all([
    prisma.person.count({ where: { workspaceId } }), prisma.company.count({ where: { workspaceId } }), prisma.property.count({ where: { workspaceId } }),
    prisma.employment.count({ where: { workspaceId } }), prisma.propertyStake.count({ where: { workspaceId } }), prisma.dealParticipation.count({ where: { workspaceId } }), prisma.deal.count({ where: { workspaceId } }),
  ]);
  return { people, companies, properties, employments, stakes, participations, deals };
}
