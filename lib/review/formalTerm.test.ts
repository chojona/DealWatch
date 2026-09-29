import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getDealBrief } from "@/lib/deals/brief/service";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { createWorkspace } from "@/lib/entities/workspace";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { projectEffectiveRounds, resolveFormalCorrection, FormalCorrectionError } from "@/lib/negotiation/formalReview";
import type { RoundWithPayload } from "@/lib/negotiation/resolveStructuredState";
import { resolveCurrentState } from "@/lib/negotiation/resolveCurrentState";
import { reviewActivityFact } from "@/lib/messages/review";
import { ReviewActionError } from "@/lib/review/decisions";
import { correctNegotiationEvidence } from "@/lib/review/evidence";
import { reviewFormalTerm } from "@/lib/review/formalTerm";

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

const wrongQuote = "Base Rent: $54.00/SF";
const rightQuote = "Base Rent: $45.00 per rentable square foot";

function baseRent(amount: number) {
  return { termType: "BASE_RENT" as const, rent: { kind: "simple" as const, amountPerRSFYear: amount } };
}

function documentData(dealId: string, originalFilename: string) {
  return {
    dealId,
    filename: `${originalFilename}-${Math.random().toString(16).slice(2)}`,
    originalFilename,
    mimeType: "application/pdf",
    sizeBytes: 120,
    sha256: `sha-${Math.random().toString(16).slice(2)}`,
    documentType: "LOI" as const,
    documentDate: new Date("2026-09-01T00:00:00Z"),
    negotiationSide: "LANDLORD" as const,
    ingestionStatus: "COMPLETE" as const,
    graphExtractionStatus: "SUCCEEDED" as const,
    storageKey: `pending-${Math.random().toString(16).slice(2)}`,
    pageCount: 1,
  };
}

async function rentDocument(input: {
  dealId: string;
  filename: string;
  amount: number;
  roundNumber: number;
  documentDate: string;
  quote?: string;
  pageText?: string;
}) {
  const quote = input.quote ?? `Base Rent: $${input.amount.toFixed(2)}/SF`;
  const pageText = input.pageText ?? quote;
  const document = await prisma.document.create({ data: documentData(input.dealId, input.filename) });
  const page = await prisma.documentPage.create({
    data: { documentId: document.id, pageNumber: 1, text: pageText },
  });
  const start = pageText.indexOf(quote);
  const round = await prisma.negotiationRound.create({
    data: {
      dealId: input.dealId,
      side: "LANDLORD",
      roundNumber: input.roundNumber,
      documentName: input.filename,
      documentText: pageText,
      documentDate: new Date(input.documentDate),
      sourceType: "PDF",
      documentId: document.id,
      terms: {
        create: {
          canonicalType: "BASE_RENT",
          normalizedValue: `$${input.amount.toFixed(2)}/SF`,
          normalizedNumeric: input.amount,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: `$${input.amount.toFixed(2)}/SF`,
          status: "PROPOSED",
          side: "LANDLORD",
          roundNumber: input.roundNumber,
          confidence: 0.91,
          evidenceQuote: quote,
          sourceLocation: "Base Rent",
          provenanceStatus: "EXACT",
          documentPageId: page.id,
          evidenceStartOffset: start,
          evidenceEndOffset: start + quote.length,
          structuredPayload: baseRent(input.amount),
        },
      },
    },
    include: { terms: true },
  });
  return { document, page, round, term: round.terms[0]! };
}

function landlordSummary(workspace: Awaited<ReturnType<typeof getNegotiationWorkspace>>) {
  const position = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition;
  if (!position || position.kind !== "VALUE") return null;
  return position.value.summary;
}

function baseRentView(workspace: Awaited<ReturnType<typeof getNegotiationWorkspace>>) {
  return workspace?.terms.find((term) => term.canonicalType === "BASE_RENT") ?? null;
}

describe("formal negotiation truth", () => {
  test("setup", async () => {
    const db = await createTestDatabase();
    prisma = db.prisma;
    cleanup = db.cleanup;
  });

  test("unreviewed extraction keeps the current resolver behavior", async () => {
    const deal = await createTestDeal(prisma);
    await rentDocument({ dealId: deal.id, filename: "Older LOI.pdf", amount: 50, roundNumber: 1, documentDate: "2026-08-01T00:00:00Z" });
    await rentDocument({ dealId: deal.id, filename: "Acme LOI.pdf", amount: 54, roundNumber: 2, documentDate: "2026-09-01T00:00:00Z" });
    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(landlordSummary(workspace), "$54.00 / RSF / yr");
    assert.equal(baseRentView(workspace)?.history.every((item) => item.formalReview === null), true);
  });

  test("accepted extraction resolves from the raw value and leaves the row unchanged", async () => {
    const deal = await createTestDeal(prisma);
    const seeded = await rentDocument({ dealId: deal.id, filename: "Acme LOI.pdf", amount: 54, roundNumber: 1, documentDate: "2026-09-01T00:00:00Z" });
    const before = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: seeded.term.id } });
    const saved = await reviewFormalTerm(prisma, { documentId: seeded.document.id, negotiationTermId: seeded.term.id, action: "ACCEPT" });
    const after = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: seeded.term.id } });
    assert.equal(saved.review.state, "ACCEPTED");
    assert.equal(after.normalizedNumeric, before.normalizedNumeric);
    assert.deepEqual(after.structuredPayload, before.structuredPayload);
    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(landlordSummary(workspace), "$54.00 / RSF / yr");
    assert.equal(baseRentView(workspace)?.history[0]?.formalReview?.state, "ACCEPTED");
  });

  test("corrected extraction keeps raw $54, resolves $45, and reaches the brief", async () => {
    const deal = await createTestDeal(prisma);
    const pageText = `${wrongQuote}\n${rightQuote}`;
    const seeded = await rentDocument({
      dealId: deal.id,
      filename: "Acme LOI.pdf",
      amount: 54,
      roundNumber: 1,
      documentDate: "2026-09-01T00:00:00Z",
      quote: wrongQuote,
      pageText,
    });
    const before = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: seeded.term.id } });
    await correctNegotiationEvidence(prisma, {
      documentId: seeded.document.id,
      negotiationTermId: seeded.term.id,
      documentPageId: seeded.page.id,
      startOffset: pageText.indexOf(rightQuote),
      endOffset: pageText.indexOf(rightQuote) + rightQuote.length,
      evidenceQuote: rightQuote,
    });
    const saved = await reviewFormalTerm(prisma, {
      documentId: seeded.document.id,
      negotiationTermId: seeded.term.id,
      action: "CORRECT",
      amountPerRSFYear: 45,
      rawValue: rightQuote,
      note: "Document says $45.00/SF",
    });
    const repeated = await reviewFormalTerm(prisma, {
      documentId: seeded.document.id,
      negotiationTermId: seeded.term.id,
      action: "CORRECT",
      amountPerRSFYear: 45,
      rawValue: rightQuote,
      note: "Document says $45.00/SF",
    });
    const after = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: seeded.term.id } });
    assert.equal(after.normalizedNumeric, 54);
    assert.equal(after.rawValue, before.rawValue);
    assert.equal(after.evidenceQuote, wrongQuote);
    assert.equal((after.structuredPayload as { rent: { amountPerRSFYear: number } }).rent.amountPerRSFYear, 54);
    assert.equal(saved.review.state, "CORRECTED");
    assert.equal(saved.review.normalizedNumeric, 45);
    assert.equal(saved.original?.normalizedNumeric, 54);
    assert.equal(repeated.unchanged, true);
    assert.equal(await prisma.formalTermReview.count({ where: { negotiationTermId: seeded.term.id } }), 1);
    assert.equal(await prisma.formalTermReviewEvent.count({ where: { negotiationTermId: seeded.term.id } }), 1);

    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    const view = baseRentView(workspace);
    const observation = view?.history[0];
    assert.equal(landlordSummary(workspace), "$45.00 / RSF / yr");
    assert.equal(observation?.formalReview?.state, "CORRECTED");
    assert.equal(observation?.formalReview?.extractedSummary, "$54.00 / RSF / yr");
    assert.equal(observation?.formalReview?.effectiveSummary, "$45.00 / RSF / yr");
    assert.equal(observation?.value.summary, "$54.00 / RSF / yr");
    assert.equal(observation?.evidence.quote, rightQuote);
    assert.equal(observation?.evidence.originalQuote, wrongQuote);
    assert.equal(observation?.evidence.spanCorrected, true);
    assert.equal(observation?.evidence.sourceLabel.includes("Acme LOI.pdf"), true);

    const brief = await getDealBrief(prisma, deal.id, { expectedWorkspaceId: deal.workspaceId });
    const briefRent = brief?.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(briefRent?.landlordPosition?.kind, "VALUE");
    if (briefRent?.landlordPosition?.kind === "VALUE") {
      assert.equal(briefRent.landlordPosition.value.summary, "$45.00 / RSF / yr");
    }
    assert.equal(briefRent?.source?.label.includes("Acme LOI.pdf"), true);
  });

  test("rejecting the current extraction recomputes from the remaining term", async () => {
    const deal = await createTestDeal(prisma);
    const older = await rentDocument({ dealId: deal.id, filename: "Prior LOI.pdf", amount: 50, roundNumber: 1, documentDate: "2026-08-01T00:00:00Z" });
    const current = await rentDocument({ dealId: deal.id, filename: "Acme LOI.pdf", amount: 54, roundNumber: 2, documentDate: "2026-09-01T00:00:00Z" });
    await reviewFormalTerm(prisma, {
      documentId: current.document.id,
      negotiationTermId: current.term.id,
      action: "REJECT",
      note: "This extraction is not the paper term",
    });
    const raw = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: current.term.id } });
    assert.equal(raw.normalizedNumeric, 54);
    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(landlordSummary(workspace), "$50.00 / RSF / yr");
    const rejected = baseRentView(workspace)?.history.find((item) => item.id === current.term.id);
    assert.equal(rejected?.formalReview?.state, "REJECTED");
    assert.equal(rejected?.formalReview?.extractedSummary, "$54.00 / RSF / yr");
    assert.equal(rejected?.formalReview?.note, "This extraction is not the paper term");
    const brief = await getDealBrief(prisma, deal.id, { expectedWorkspaceId: deal.workspaceId });
    const briefRent = brief?.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT");
    if (briefRent?.landlordPosition?.kind === "VALUE") {
      assert.equal(briefRent.landlordPosition.value.summary, "$50.00 / RSF / yr");
    } else {
      assert.fail("expected the older formal rent");
    }
    assert.equal(briefRent?.provenance.observationIds.includes(older.term.id), true);
    assert.equal(briefRent?.source?.label.includes("Prior LOI.pdf"), true);
  });

  test("rejecting the only extraction leaves the formal position unresolved", async () => {
    const deal = await createTestDeal(prisma);
    const seeded = await rentDocument({ dealId: deal.id, filename: "Acme LOI.pdf", amount: 54, roundNumber: 1, documentDate: "2026-09-01T00:00:00Z" });
    await reviewFormalTerm(prisma, { documentId: seeded.document.id, negotiationTermId: seeded.term.id, action: "REJECT" });
    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    const view = baseRentView(workspace);
    assert.equal(view?.landlordPosition, null);
    assert.equal(view?.status, "NOT_MENTIONED");
    assert.equal(view?.history[0]?.formalReview?.state, "REJECTED");
    const brief = await getDealBrief(prisma, deal.id, { expectedWorkspaceId: deal.workspaceId });
    const briefRent = brief?.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(briefRent?.landlordPosition, null);
    assert.equal(briefRent?.status, "NOT_MENTIONED");
    assert.equal(briefRent?.briefStatus, "REJECTED");
    assert.equal(briefRent?.statusLabel, "Rejected");
    assert.equal(brief?.negotiation.summary.openCount, 0);
    assert.equal(brief?.productAttention.some((item) => item.label === "Base rent was rejected"), true);
  });

  test("an activity-fact correction cannot change the formal term", async () => {
    const deal = await createTestDeal(prisma);
    const seeded = await rentDocument({ dealId: deal.id, filename: "Acme LOI.pdf", amount: 45, roundNumber: 1, documentDate: "2026-09-01T00:00:00Z" });
    const before = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: seeded.term.id } });
    const message = await prisma.sourceMessage.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        subject: "Rent proposal",
        bodyText: "Could we get the rent down to $40/SF?",
        sourceType: "MANUAL",
      },
    });
    const fact = await prisma.activityFact.create({
      data: {
        workspaceId: deal.workspaceId,
        dealId: deal.id,
        sourceMessageId: message.id,
        factType: "NEGOTIATION_VALUE",
        canonicalType: "BASE_RENT",
        side: "TENANT",
        assertionStatus: "PROPOSED",
        structuredPayload: {
          display: "$40.00 / RSF / year",
          numeric: 40,
          unit: "USD_PER_RSF_YEAR",
          negotiation: baseRent(40),
        },
        evidenceQuote: "Could we get the rent down to $40/SF?",
        provenanceStatus: "EXACT",
        extractionMethod: "DETERMINISTIC",
      },
    });
    await reviewActivityFact(prisma, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "INCORRECT",
      correctedPayload: {
        display: "$40.00 / RSF / year",
        numeric: 40,
        unit: "USD_PER_RSF_YEAR",
        negotiation: baseRent(40),
      },
      note: "Communication proposal only",
    });
    const after = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: seeded.term.id } });
    assert.deepEqual(after, before);
    assert.equal(await prisma.formalTermReview.count({ where: { negotiationTermId: seeded.term.id } }), 0);
    assert.equal(await prisma.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), 1);
    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(landlordSummary(workspace), "$45.00 / RSF / yr");
  });

  test("formal review stays inside the document workspace", async () => {
    const deal = await createTestDeal(prisma);
    const seeded = await rentDocument({ dealId: deal.id, filename: "Acme LOI.pdf", amount: 54, roundNumber: 1, documentDate: "2026-09-01T00:00:00Z" });
    const otherWorkspace = await createWorkspace(prisma, { name: `Other ${Date.now()}` });
    const otherDeal = await prisma.deal.create({
      data: {
        name: "Other deal",
        company: "Other",
        property: "Elsewhere",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: otherWorkspace.id,
      },
    });
    const other = await rentDocument({ dealId: otherDeal.id, filename: "Other LOI.pdf", amount: 10, roundNumber: 1, documentDate: "2026-09-02T00:00:00Z" });
    await assert.rejects(
      () => reviewFormalTerm(prisma, { documentId: other.document.id, negotiationTermId: seeded.term.id, action: "REJECT" }),
      (error: unknown) => error instanceof ReviewActionError && error.code === "CROSS_DOCUMENT"
    );
    assert.equal(await prisma.formalTermReview.count({ where: { negotiationTermId: seeded.term.id } }), 0);
    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(landlordSummary(workspace), "$54.00 / RSF / yr");
    assert.equal(landlordSummary(await getNegotiationWorkspace(prisma, otherDeal.id)), "$10.00 / RSF / yr");
  });

  test("invalid corrections are refused and a later correction replaces the current one", async () => {
    const deal = await createTestDeal(prisma);
    const seeded = await rentDocument({ dealId: deal.id, filename: "Acme LOI.pdf", amount: 54, roundNumber: 1, documentDate: "2026-09-01T00:00:00Z" });
    await assert.rejects(
      () => reviewFormalTerm(prisma, { documentId: seeded.document.id, negotiationTermId: seeded.term.id, action: "CORRECT", amountPerRSFYear: 0 }),
      (error: unknown) => error instanceof ReviewActionError && error.httpStatus === 400
    );
    await assert.rejects(
      () => reviewFormalTerm(prisma, {
        documentId: seeded.document.id,
        negotiationTermId: seeded.term.id,
        action: "CORRECT",
        structuredPayload: { termType: "FREE_RENT", abatement: { kind: "contiguous", months: 2, abatementType: "FULL" } },
      }),
      (error: unknown) => error instanceof ReviewActionError && error.httpStatus === 400
    );
    assert.equal(await prisma.formalTermReview.count({ where: { negotiationTermId: seeded.term.id } }), 0);
    await reviewFormalTerm(prisma, { documentId: seeded.document.id, negotiationTermId: seeded.term.id, action: "CORRECT", amountPerRSFYear: 45 });
    await reviewFormalTerm(prisma, { documentId: seeded.document.id, negotiationTermId: seeded.term.id, action: "CORRECT", amountPerRSFYear: 46 });
    const review = await prisma.formalTermReview.findUniqueOrThrow({ where: { negotiationTermId: seeded.term.id } });
    assert.equal(review.normalizedNumeric, 46);
    assert.equal(await prisma.formalTermReviewEvent.count({ where: { negotiationTermId: seeded.term.id } }), 2);
    const workspace = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(landlordSummary(workspace), "$46.00 / RSF / yr");
    assert.equal((await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: seeded.term.id } })).normalizedNumeric, 54);
  });

  test("legacy scalar correction and resolver projection stay deterministic", () => {
    assert.throws(
      () => resolveFormalCorrection(
        { canonicalType: "LEASE_TERM", structuredPayload: null },
        { normalizedNumeric: 12, normalizedUnit: null, rawValue: "12 months" }
      ),
      FormalCorrectionError
    );
    const corrected = resolveFormalCorrection(
      { canonicalType: "LEASE_TERM", structuredPayload: null },
      { normalizedNumeric: 120, normalizedUnit: "MONTHS", normalizedValue: "120 months", rawValue: "Ten years" }
    );
    assert.equal(corrected.normalizedNumeric, 120);
    const rounds: RoundWithPayload[] = [{
      id: "round",
      side: "LANDLORD",
      roundNumber: 1,
      documentName: "LOI",
      documentText: "",
      documentDate: new Date("2026-09-01T00:00:00Z"),
      createdAt: new Date("2026-09-01T00:00:00Z"),
      terms: [{
        id: "term",
        canonicalType: "LEASE_TERM",
        normalizedValue: "7 years",
        normalizedNumeric: 7,
        normalizedUnit: "YEARS",
        rawValue: "7 years",
        status: "PROPOSED",
        side: "LANDLORD",
        roundNumber: 1,
        confidence: 1,
        evidenceQuote: "seven years",
        sourceLocation: null,
        structuredPayload: null,
      }],
    }];
    const reviews = new Map([["term", {
      state: "CORRECTED" as const,
      normalizedValue: corrected.normalizedValue,
      normalizedNumeric: corrected.normalizedNumeric,
      normalizedUnit: corrected.normalizedUnit,
      rawValue: corrected.rawValue,
      structuredPayload: null,
      note: null,
      reviewedAt: new Date("2026-09-02T00:00:00Z"),
      actor: "MANUAL_REVIEW" as const,
      reviewerUserId: null,
    }]]);
    const projected = projectEffectiveRounds(rounds, reviews);
    assert.equal(projected[0]?.terms[0]?.normalizedNumeric, 120);
    assert.equal(rounds[0]?.terms[0]?.normalizedNumeric, 7);
    assert.equal(resolveCurrentState(projected, "LEASE_TERM").currentLandlordTerm?.normalizedNumeric, 120);
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
