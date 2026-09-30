import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { extractCREGraphObservations } from "./extractCREGraph";
import { GraphExtractionError, type GraphModelExtractor } from "./extractModel";
import { graphFixtures, signatureQuote } from "./fixtures";
import { CRE_GRAPH_EXTRACTION_PROMPT, GRAPH_EXTRACTOR_VERSION } from "./prompt";
import { readDocumentObservations } from "./readObservations";
import { validateGraphObservations } from "./validateObservations";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { analyzeNegotiationDocument, ingestNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { runDocumentGraphExtraction } from "@/lib/documents/runGraphExtraction";
import { canRetryDocument } from "@/lib/inbox/status";
import { createWorkspace } from "@/lib/entities/service";

let prisma: PrismaClient;
let dealId: string;
let workspaceId: string;
let cleanup: () => Promise<void>;

test.before(async () => {
  const db = await createTestDatabase();
  prisma = db.prisma;
  cleanup = db.cleanup;
  const deal = await createTestDeal(prisma);
  dealId = deal.id;
  workspaceId = deal.workspaceId;
});

test.after(async () => {
  await cleanup();
});

function extractor(extraction: unknown, model = "mock-graph"): GraphModelExtractor {
  const fn: GraphModelExtractor = async () => ({ extraction, model });
  fn.model = model;
  return fn;
}

async function createDocument(label: string, pages: string[]) {
  return prisma.document.create({
    data: {
      dealId,
      filename: `${label}.pdf`,
      originalFilename: `${label}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 32,
      sha256: `${label}-${Date.now()}-${Math.random()}`,
      documentType: "OTHER",
      storageKey: `${label}.pdf`,
      ingestionStatus: "READY",
      pages: {
        create: pages.map((text, index) => ({ pageNumber: index + 1, text })),
      },
    },
  });
}

test("deterministic fixtures create observations and no canonical graph rows", async () => {
  for (const fixture of graphFixtures) {
    const document = await createDocument(fixture.id, fixture.pages);
    const result = await extractCREGraphObservations({
      prisma,
      documentId: document.id,
      extractor: extractor(fixture.extraction, `mock-${fixture.id}`),
    });
    assert.equal(result.status, "SUCCEEDED", fixture.id);
    const stored = await readDocumentObservations(prisma, document.id);
    assert.ok(stored);
    assert.deepEqual(
      stored.entityObservations.map((observation) => observation.surfaceForm),
      fixture.entityNames,
      fixture.id
    );
    assert.deepEqual(
      stored.relationshipObservations.map((observation) => observation.predicate),
      fixture.predicates,
      fixture.id
    );
    const codes = result.rejections.map((rejection) => rejection.code);
    for (const code of fixture.rejectionCodes) {
      assert.ok(codes.includes(code), `${fixture.id} missing ${code}: ${codes.join(",")}`);
    }
    assert.equal(stored.workspaceId, workspaceId, fixture.id);
    for (const observation of stored.entityObservations) {
      assert.equal(observation.workspaceId, workspaceId);
    }
    if (fixture.provenance) {
      assert.equal(
        stored.relationshipObservations[0]?.provenanceStatus,
        fixture.provenance,
        fixture.id
      );
      if (fixture.provenance === "EXACT") {
        assert.ok(stored.relationshipObservations[0]?.documentPageId);
      } else {
        assert.equal(stored.relationshipObservations[0]?.documentPageId, null);
      }
    }
  }

  assert.equal(await prisma.person.count(), 0);
  assert.equal(await prisma.company.count(), 0);
  assert.equal(await prisma.property.count(), 0);
  assert.equal(await prisma.employment.count(), 0);
  assert.equal(await prisma.propertyStake.count(), 0);
  assert.equal(await prisma.dealParticipation.count(), 0);
  assert.equal(await prisma.companyAlias.count(), 0);
  assert.equal(await prisma.propertyAlias.count(), 0);
  assert.equal(await prisma.entityResolutionLink.count(), 0);
});

test("signature extraction keeps attributes and does not resolve CBRE forms", async () => {
  const formsDocument = await prisma.document.findFirstOrThrow({
    where: { originalFilename: "09-company-forms.pdf" },
  });
  const forms = await prisma.entityObservation.findMany({
    where: { documentId: formsDocument.id, observedType: "COMPANY" },
    orderBy: { surfaceForm: "asc" },
  });
  assert.deepEqual(
    forms.map((observation) => observation.surfaceForm),
    ["CBRE", "CBRE Group, Inc."]
  );
  assert.deepEqual(
    forms.map((observation) => observation.normalizedName),
    ["cbre", "cbre group inc"]
  );

  const dana = await prisma.entityObservation.findFirstOrThrow({
    where: { surfaceForm: "Dana Cho" },
  });
  assert.equal(dana.email, "dana.cho@acme.example");
  assert.equal(dana.phone, "6175550199");
  assert.deepEqual(dana.rawAttributes, {
    observedLinkedIn: "https://www.linkedin.com/in/danacho",
  });

  const inbox = await prisma.entityObservation.findFirstOrThrow({
    where: { surfaceForm: "JLL", domain: "jll.com" },
  });
  assert.equal(inbox.email, null);
  assert.equal(inbox.title, null);
  assert.deepEqual(inbox.rawAttributes, {
    observedWebsite: "https://www.jll.com",
    observedEmail: "boston@jll.com",
  });

  const historical = await prisma.relationshipObservation.findFirstOrThrow({
    where: { evidenceQuote: "Until 2022, Sarah Chen was a broker at CBRE." },
  });
  assert.equal(historical.statedValidTo?.toISOString(), "2022-12-31T00:00:00.000Z");
  assert.equal(historical.predicate, "WORKS_AT");
});

test("same person in two documents stays two immutable observations", async () => {
  const people = await prisma.entityObservation.findMany({
    where: { surfaceForm: "Sarah Chen", observedType: "PERSON" },
    orderBy: { createdAt: "asc" },
  });
  assert.ok(people.length >= 2);
  assert.notEqual(people[0]?.id, people[1]?.id);
  assert.notEqual(people[0]?.documentId, people[1]?.documentId);
});

test("validation rejects missing evidence, dangling endpoints, and bad WORKS_AT types", () => {
  const pages = [{ pageNumber: 1, text: "Sarah Chen works at JLL." }];
  const missingEvidence = validateGraphObservations({
    pages,
    modelOutput: {
      entities: [
        personCompany()[0],
        personCompany()[1],
      ],
      relationships: [
        {
          subjectObservationKey: "person_1",
          predicate: "WORKS_AT",
          objectObservationKey: "company_1",
          principalObservationKey: null,
          participationRole: null,
          roleLabel: null,
          affiliationKind: null,
          statedTitle: null,
          statedValidFrom: null,
          statedValidTo: null,
          assertionStrength: "STATED",
          evidenceQuote: "   ",
          extractionConfidence: 0.4,
        },
      ],
    },
  });
  assert.ok(missingEvidence.rejections.some((rejection) => rejection.code === "MISSING_EVIDENCE"));
  assert.equal(missingEvidence.relationships.length, 0);

  const dangling = validateGraphObservations({
    pages,
    modelOutput: {
      entities: [personCompany()[0]],
      relationships: [
        {
          subjectObservationKey: "person_1",
          predicate: "WORKS_AT",
          objectObservationKey: "company_9",
          principalObservationKey: null,
          participationRole: null,
          roleLabel: null,
          affiliationKind: null,
          statedTitle: null,
          statedValidFrom: null,
          statedValidTo: null,
          assertionStrength: "STATED",
          evidenceQuote: "Sarah Chen works at JLL.",
          extractionConfidence: 0.4,
        },
      ],
    },
  });
  assert.ok(dangling.rejections.some((rejection) => rejection.code === "MISSING_ENDPOINT"));

  const swapped = validateGraphObservations({
    pages,
    modelOutput: {
      entities: [
        { ...personCompany()[1], observationKey: "company_1", observedType: "COMPANY", observedName: "JLL" },
        { ...personCompany()[0], observationKey: "person_1" },
      ],
      relationships: [
        {
          subjectObservationKey: "company_1",
          predicate: "WORKS_AT",
          objectObservationKey: "person_1",
          principalObservationKey: null,
          participationRole: null,
          roleLabel: null,
          affiliationKind: null,
          statedTitle: null,
          statedValidFrom: null,
          statedValidTo: null,
          assertionStrength: "STATED",
          evidenceQuote: "Sarah Chen works at JLL.",
          extractionConfidence: 0.4,
        },
      ],
    },
  });
  assert.ok(swapped.rejections.some((rejection) => rejection.code === "INVALID_ENDPOINTS"));
  assert.equal(swapped.relationships.length, 0);
});

test("model page numbers and workspace ids do not control stored provenance", async () => {
  const document = await createDocument("fake-page", [
    "Cover",
    signatureQuote,
  ]);
  const extraction = structuredClone(graphFixtures[0]!.extraction) as {
    workspaceId: string;
    entities: Array<Record<string, unknown>>;
    relationships: Array<Record<string, unknown>>;
  };
  extraction.workspaceId = "workspace_chosen_by_model";
  extraction.entities[0]!.pageNumber = 9;
  extraction.entities[0]!.documentPageId = "page_fake";
  extraction.relationships[0]!.pageNumber = 9;
  const other = await createWorkspace(prisma, { name: "Model Workspace" });
  extraction.workspaceId = other.id;

  const result = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: extractor(extraction, "mock-provenance"),
  });
  assert.equal(result.status, "SUCCEEDED");
  assert.ok(result.rejections.some((rejection) => rejection.code === "IGNORED_MODEL_WORKSPACE"));
  const stored = await readDocumentObservations(prisma, document.id);
  const relationship = stored?.relationshipObservations[0];
  assert.equal(relationship?.provenanceStatus, "EXACT");
  const page = await prisma.documentPage.findUniqueOrThrow({
    where: { id: relationship!.documentPageId! },
  });
  assert.equal(page.pageNumber, 2);
  assert.equal(page.documentId, document.id);
  assert.equal(stored?.entityObservations[0]?.workspaceId, workspaceId);
  assert.notEqual(stored?.workspaceId, other.id);
});

test("rerunning the same extractor version is idempotent and a new version is a new run", async () => {
  const document = await createDocument("idempotent", [signatureQuote]);
  const extraction = graphFixtures[0]!.extraction;
  const first = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: extractor(extraction, "mock-idem"),
  });
  const second = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: extractor(
      {
        entities: [],
        relationships: [],
      },
      "mock-idem"
    ),
  });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.entityCount, first.entityCount);
  assert.equal(
    await prisma.entityObservation.count({ where: { documentId: document.id } }),
    2
  );

  const next = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: extractor(extraction, "mock-idem"),
    extractorVersion: "phase7a.2",
  });
  assert.equal(next.idempotent, false);
  assert.equal(next.extractorVersion, "phase7a.2");
  assert.notEqual(next.extractorVersion, GRAPH_EXTRACTOR_VERSION);
  assert.equal(
    await prisma.graphExtractionRun.count({ where: { documentId: document.id } }),
    2
  );
  assert.equal(
    await prisma.entityObservation.count({ where: { documentId: document.id } }),
    4
  );
});

test("a graph failure leaves negotiation analysis complete", async () => {
  const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-graph-")));
  const pdf = buildTextPdf([signatureQuote, "Base Rent shall be $65.00 per rentable square foot."]);
  const result = await ingestNegotiationPdf({
    dealId,
    bytes: pdf,
    filename: "counter.pdf",
    mimeType: "application/pdf",
    side: "LANDLORD",
    documentDate: new Date("2026-05-01"),
    documentType: "COUNTERPROPOSAL",
    storage,
    prisma,
    extractTerms: async () => ({
      terms: [
        {
          canonicalType: "BASE_RENT",
          normalizedValue: "$65.00/RSF/year",
          normalizedNumeric: 65,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: "Base Rent shall be $65.00 per rentable square foot.",
          status: "PROPOSED",
          confidence: 0.9,
          evidenceQuote: "Base Rent shall be $65.00 per rentable square foot.",
          sourceLocation: "Rent",
          structuredPayload: {
            termType: "BASE_RENT",
            rent: { kind: "simple", amountPerRSFYear: 65 },
          },
        },
      ],
      metadata: {
        model: "mock-negotiation",
        extractedAt: new Date().toISOString(),
        latencyMs: 1,
        extractionConfidence: 0.9,
        validationFailures: 0,
      },
    }),
    extractGraph: async () => {
      throw new GraphExtractionError("graph model failed");
    },
  });
  assert.equal(result.document.ingestionStatus, "COMPLETE");
  assert.equal(result.document.termCount, 1);
  assert.equal(result.document.graphExtractionStatus, "FAILED");
  assert.equal(result.document.failureCode, null);
  assert.equal(await prisma.person.count(), 0);
  const round = await prisma.negotiationRound.findFirstOrThrow({
    where: { documentId: result.document.id },
    include: { terms: true },
  });
  assert.equal(round.terms[0]?.canonicalType, "BASE_RENT");
  assert.equal(round.terms[0]?.normalizedNumeric, 65);
});

test("retrying a completed negotiation reruns a failed graph extraction", async () => {
  const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-graph-retry-")));
  const pdf = buildTextPdf([`${signatureQuote}\nGraph retry marker.`]);
  let calls = 0;
  const failing: GraphModelExtractor = async () => {
    calls += 1;
    throw new GraphExtractionError("graph model failed");
  };
  failing.model = "mock-graph-retry";
  const first = await ingestNegotiationPdf({
    dealId,
    bytes: pdf,
    filename: "retry.pdf",
    mimeType: "application/pdf",
    side: "LANDLORD",
    documentDate: new Date("2026-05-03"),
    documentType: "COUNTERPROPOSAL",
    storage,
    prisma,
    extractTerms: async () => ({
      terms: [
        {
          canonicalType: "BASE_RENT",
          normalizedValue: "$65.00/RSF/year",
          normalizedNumeric: 65,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: "Base Rent shall be $65.00 per rentable square foot.",
          status: "PROPOSED",
          confidence: 0.9,
          evidenceQuote: "Base Rent shall be $65.00 per rentable square foot.",
          sourceLocation: "Rent",
          structuredPayload: {
            termType: "BASE_RENT",
            rent: { kind: "simple", amountPerRSFYear: 65 },
          },
        },
      ],
      metadata: {
        model: "mock-negotiation",
        extractedAt: new Date().toISOString(),
        latencyMs: 1,
        extractionConfidence: 0.9,
        validationFailures: 0,
      },
    }),
    extractGraph: failing,
  });
  assert.equal(first.document.ingestionStatus, "COMPLETE");
  assert.equal(first.document.graphExtractionStatus, "FAILED");
  assert.equal(calls, 1);
  assert.equal(
    canRetryDocument({
      ingestionStatus: first.document.ingestionStatus,
      failureCode: first.document.failureCode,
      graphExtractionStatus: first.document.graphExtractionStatus,
    }),
    true
  );
  assert.equal(
    await prisma.negotiationRound.count({ where: { documentId: first.document.id } }),
    1
  );

  const again = await analyzeNegotiationDocument({
    documentId: first.document.id,
    prisma,
    extractTerms: async () => {
      throw new Error("negotiation analysis must not run again");
    },
  });
  assert.equal(again.idempotent, true);
  assert.equal(
    await prisma.negotiationRound.count({ where: { documentId: first.document.id } }),
    1
  );

  const succeeding: GraphModelExtractor = async (input) => {
    calls += 1;
    return extractor(graphFixtures[0]!.extraction, "mock-graph-retry")(input);
  };
  succeeding.model = "mock-graph-retry";
  const graph = await runDocumentGraphExtraction({
    prisma,
    documentId: first.document.id,
    extractor: succeeding,
  });
  assert.equal(graph?.status, "SUCCEEDED");
  assert.equal(calls, 2);
  const stored = await prisma.document.findUniqueOrThrow({ where: { id: first.document.id } });
  assert.equal(stored.graphExtractionStatus, "SUCCEEDED");
  assert.equal(stored.graphFailureCode, null);
  assert.equal(stored.ingestionStatus, "COMPLETE");
});

test("successful graph extraction does not create canonical rows during ingestion", async () => {
  const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-graph-ok-")));
  const pdf = buildTextPdf([signatureQuote]);
  const beforePeople = await prisma.person.count();
  const result = await ingestNegotiationPdf({
    dealId,
    bytes: pdf,
    filename: "signature.pdf",
    mimeType: "application/pdf",
    side: "TENANT",
    documentDate: new Date("2026-05-02"),
    documentType: "OTHER",
    storage,
    prisma,
    extractTerms: async () => ({
      terms: [],
      metadata: {
        model: "mock-negotiation",
        extractedAt: new Date().toISOString(),
        latencyMs: 1,
        extractionConfidence: 0.9,
        validationFailures: 0,
      },
    }),
    extractGraph: extractor(graphFixtures[0]!.extraction, "mock-ingest"),
  });
  assert.equal(result.document.ingestionStatus, "COMPLETE");
  assert.equal(result.document.graphExtractionStatus, "SUCCEEDED");
  const stored = await readDocumentObservations(prisma, result.document.id);
  assert.equal(stored?.entityObservations.length, 2);
  assert.equal(stored?.relationshipObservations[0]?.predicate, "WORKS_AT");
  assert.equal(await prisma.person.count(), beforePeople);
  assert.equal(await prisma.employment.count(), 0);
});

function personCompany() {
  return [
    {
      observationKey: "person_1",
      observedType: "PERSON",
      observedName: "Sarah Chen",
      observedTitle: null,
      observedEmail: null,
      observedPhone: null,
      observedLinkedIn: null,
      observedWebsite: null,
      observedDomain: null,
      observedAddress: null,
      evidenceQuote: "Sarah Chen works at JLL.",
      extractionConfidence: 0.5,
    },
    {
      observationKey: "company_1",
      observedType: "COMPANY",
      observedName: "JLL",
      observedTitle: null,
      observedEmail: null,
      observedPhone: null,
      observedLinkedIn: null,
      observedWebsite: null,
      observedDomain: null,
      observedAddress: null,
      evidenceQuote: "Sarah Chen works at JLL.",
      extractionConfidence: 0.5,
    },
  ];
}

test("a completed identical graph extraction does not call the model again", async () => {
  let calls = 0;
  const extraction = graphFixtures[0]!.extraction;
  const mock: GraphModelExtractor = async () => {
    calls += 1;
    return { extraction, model: "mock-once" };
  };
  mock.model = "mock-once";
  const document = await createDocument("once", [signatureQuote]);
  const first = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: mock,
  });
  const second = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: mock,
  });
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.runId, first.runId);
  assert.equal(calls, 1);
  assert.equal(
    await prisma.entityObservation.count({ where: { documentId: document.id } }),
    2
  );
});

test("a different graph model creates a distinct extraction run", async () => {
  let calls = 0;
  const extraction = graphFixtures[0]!.extraction;
  const document = await createDocument("two-models", [signatureQuote]);
  const firstModel: GraphModelExtractor = async () => {
    calls += 1;
    return { extraction, model: "model-a" };
  };
  firstModel.model = "model-a";
  const secondModel: GraphModelExtractor = async () => {
    calls += 1;
    return { extraction, model: "model-b" };
  };
  secondModel.model = "model-b";
  const first = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: firstModel,
  });
  const second = await extractCREGraphObservations({
    prisma,
    documentId: document.id,
    extractor: secondModel,
  });
  assert.equal(calls, 2);
  assert.notEqual(first.runId, second.runId);
  assert.equal(
    await prisma.graphExtractionRun.count({ where: { documentId: document.id } }),
    2
  );
  assert.equal(
    await prisma.entityObservation.count({ where: { documentId: document.id } }),
    4
  );
});

test("graph prompt separates employment from deal participation and stake qualifiers", () => {
  const prompt = CRE_GRAPH_EXTRACTION_PROMPT;
  assert.match(prompt, /WORKS_AT/);
  assert.match(prompt, /participationRole must be null/);
  assert.match(prompt, /roleLabel must be null/);
  assert.match(prompt, /PARTICIPATES_AS/);
  assert.match(prompt, /participationRole is required/);
  assert.match(prompt, /affiliationKind must be null/);
  assert.match(prompt, /OWNS, MANAGES, OCCUPIES, DEVELOPED, LENDS_ON/);
  assert.match(prompt, /Do not attach deal-participation fields or employment fields/);
  assert.match(prompt, /emit two relationship observations/);
  assert.match(prompt, /Sarah Chen WORKS_AT JLL/);
  assert.match(prompt, /PARTICIPATES_AS with participationRole TENANT_BROKER/);
});
