import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { decideMessageReview, reviewActivityFact } from "@/lib/messages/review";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { DealBriefQueryError, parseDealBriefQuery } from "./query";
import { getDealBrief } from "./service";

function rentPayload(amount: number): Prisma.InputJsonValue {
  return {
    termType: "BASE_RENT",
    rent: { kind: "simple", amountPerRSFYear: amount },
  };
}

function activityPayload(amount: number, unit = "USD_PER_RSF_YEAR"): Prisma.InputJsonValue {
  return {
    display: unit === "USD" ? `$${amount.toFixed(2)} total` : `$${amount.toFixed(2)} / RSF / year`,
    numeric: amount,
    unit,
    negotiation: null,
  };
}

async function formalRound(
  db: PrismaClient,
  dealId: string,
  input: {
    amount: number;
    side?: "TENANT" | "LANDLORD";
    roundNumber?: number;
    date?: string;
    documentId?: string;
    secondAmount?: number;
  }
) {
  const side = input.side ?? "LANDLORD";
  const roundNumber = input.roundNumber ?? 1;
  const values = [input.amount, ...(input.secondAmount === undefined ? [] : [input.secondAmount])];
  return db.negotiationRound.create({
    data: {
      dealId,
      side,
      roundNumber,
      documentName: `${side} formal round ${roundNumber}`,
      documentText: "Formal source",
      documentDate: new Date(input.date ?? "2026-09-18T12:00:00Z"),
      sourceType: input.documentId ? "PDF_UPLOAD" : "PASTED_TEXT",
      documentId: input.documentId,
      terms: {
        create: values.map((amount) => ({
          canonicalType: "BASE_RENT",
          normalizedValue: `$${amount.toFixed(2)} / RSF / year`,
          normalizedNumeric: amount,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: `$${amount}`,
          status: "PROPOSED",
          side,
          roundNumber,
          confidence: 1,
          evidenceQuote: `Base rent is $${amount.toFixed(2)} / RSF / year`,
          provenanceStatus: "EXACT",
          structuredPayload: rentPayload(amount),
        })),
      },
    },
    include: { terms: true },
  });
}

async function sourceMessage(
  db: PrismaClient,
  deal: { id: string; workspaceId: string },
  input: {
    subject: string;
    amount?: number;
    sentAt: string;
    runStatus?: "SUCCEEDED" | "FAILED";
    externalMessageId: string;
    unit?: string;
  }
) {
  const message = await db.sourceMessage.create({
    data: {
      workspaceId: deal.workspaceId,
      dealId: deal.id,
      sourceType: "FIXTURE",
      sourceProvider: "phase10a-test",
      externalMessageId: input.externalMessageId,
      subject: input.subject,
      senderName: "Derek Broker",
      senderAddress: "derek@example.test",
      sentAt: new Date(input.sentAt),
      bodyText: input.amount === undefined ? "Analysis failed." : `Landlord proposes $${input.amount.toFixed(2)}/RSF/year.`,
      participants: {
        create: [{ role: "TO", displayName: "Sarah", address: "sarah@example.test" }],
      },
    },
  });
  const status = input.runStatus ?? "SUCCEEDED";
  const run = await db.activityExtractionRun.create({
    data: {
      workspaceId: deal.workspaceId,
      sourceMessageId: message.id,
      extractor: "fixture",
      extractorVersion: "phase10a",
      contractVersion: "1",
      model: input.externalMessageId,
      status,
      failureCode: status === "FAILED" ? "EXTRACTION_FAILED" : null,
      failureReason: status === "FAILED" ? "Fixture extraction failure" : null,
      factCount: status === "SUCCEEDED" && input.amount !== undefined ? 1 : 0,
      completedAt: new Date(input.sentAt),
    },
  });
  const fact = status === "SUCCEEDED" && input.amount !== undefined
    ? await db.activityFact.create({
        data: {
          workspaceId: deal.workspaceId,
          dealId: deal.id,
          sourceMessageId: message.id,
          activityExtractionRunId: run.id,
          factType: "NEGOTIATION_VALUE",
          canonicalType: "BASE_RENT",
          side: "LANDLORD",
          assertionStatus: "PROPOSED",
          structuredPayload: activityPayload(input.amount, input.unit),
          evidenceQuote: `Landlord proposes $${input.amount.toFixed(2)}/RSF/year.`,
          provenanceStatus: "EXACT",
          extractionMethod: "DETERMINISTIC",
          extractorVersion: "phase10a",
          model: input.externalMessageId,
        },
      })
    : null;
  return { message, run, fact };
}

async function document(
  db: PrismaClient,
  dealId: string,
  input: { name: string; status: "COMPLETE" | "FAILED"; sha: string }
) {
  return db.document.create({
    data: {
      dealId,
      filename: input.name,
      originalFilename: input.name,
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: input.sha,
      documentType: "PROPOSAL",
      documentDate: new Date("2026-09-19T12:00:00Z"),
      negotiationSide: "LANDLORD",
      ingestionStatus: input.status,
      failureCode: input.status === "FAILED" ? "ANALYSIS_FAILED" : null,
      failureReason: input.status === "FAILED" ? "Fixture document failure" : null,
      storageKey: `${input.sha}/${input.name}`,
      graphExtractionStatus: "SUCCEEDED",
      pages: { create: [{ pageNumber: 1, text: "Base rent proposal." }] },
    },
  });
}

describe("Phase 10A deterministic Deal Brief", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;
  let deal: Awaited<ReturnType<typeof createTestDeal>>;
  let rentFactId: string;
  let matchingFactId: string;
  let nonComparableFactId: string;
  const fixedNow = new Date("2026-09-29T16:00:00Z");

  test("setup deterministic formal, message, correction, document, and legacy evidence", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
    deal = await createTestDeal(db);

    const reviewDocument = await document(db, deal.id, {
      name: "formal-proposal.pdf",
      status: "COMPLETE",
      sha: "a".repeat(64),
    });
    await document(db, deal.id, {
      name: "failed-proposal.pdf",
      status: "FAILED",
      sha: "b".repeat(64),
    });
    await formalRound(db, deal.id, {
      amount: 67,
      date: "2026-09-19T12:00:00Z",
      documentId: reviewDocument.id,
    });
    await formalRound(db, deal.id, {
      amount: 65,
      side: "TENANT",
      roundNumber: 1,
      date: "2026-09-17T12:00:00Z",
    });

    const reviewed = await sourceMessage(db, deal, {
      subject: "Email rent discussion",
      amount: 72.5,
      sentAt: "2026-09-22T15:00:00Z",
      externalMessageId: "reviewed-message",
    });
    rentFactId = reviewed.fact!.id;
    await reviewActivityFact(db, {
      sourceMessageId: reviewed.message.id,
      activityFactId: reviewed.fact!.id,
      state: "INCORRECT",
      correctedPayload: activityPayload(72),
      note: "Reviewed to $72.00",
      expectedWorkspaceId: deal.workspaceId,
    });
    const matching = await sourceMessage(db, deal, {
      subject: "Reviewed rent confirmation",
      amount: 67,
      sentAt: "2026-09-23T14:00:00Z",
      externalMessageId: "matching-message",
    });
    matchingFactId = matching.fact!.id;
    await reviewActivityFact(db, {
      sourceMessageId: matching.message.id,
      activityFactId: matching.fact!.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    const nonComparable = await sourceMessage(db, deal, {
      subject: "Reviewed total rent",
      amount: 67,
      unit: "USD",
      sentAt: "2026-09-23T13:00:00Z",
      externalMessageId: "non-comparable-message",
    });
    nonComparableFactId = nonComparable.fact!.id;
    await reviewActivityFact(db, {
      sourceMessageId: nonComparable.message.id,
      activityFactId: nonComparable.fact!.id,
      state: "CONFIRMED",
      expectedWorkspaceId: deal.workspaceId,
    });
    const followUp = await sourceMessage(db, deal, {
      subject: "Message requiring review",
      amount: 70,
      sentAt: "2026-09-24T15:00:00Z",
      externalMessageId: "needs-review",
    });
    await decideMessageReview(db, {
      sourceMessageId: followUp.message.id,
      decision: "NEEDS_FOLLOW_UP",
      expectedWorkspaceId: deal.workspaceId,
    });
    await sourceMessage(db, deal, {
      subject: "Failed analysis",
      sentAt: "2026-09-25T15:00:00Z",
      runStatus: "FAILED",
      externalMessageId: "failed-analysis",
    });

    await db.documentMilestone.create({
      data: {
        documentId: reviewDocument.id,
        kind: "ANALYZED",
        dedupeKey: `phase10a:${reviewDocument.id}:analyzed`,
        occurredAt: new Date("2026-09-20T12:00:00Z"),
      },
    });
    await db.dealEvent.create({
      data: {
        dealId: deal.id,
        type: "EMAIL",
        description: "Landlord issued legacy counter at $72.50/RSF/year.",
        occurredAt: new Date("2026-09-16T12:00:00Z"),
        confidence: 1,
        evidenceQuote: "Base rent: $72.50/RSF/year",
      },
    });
  });

  test("A/B/C/E/M/N read is write-free, idempotent, resolver-identical, and message facts cannot alter formal truth", async () => {
    const before = {
      terms: await db.negotiationTerm.count(),
      facts: await db.activityFact.count(),
      runs: await db.activityExtractionRun.count(),
      reviews: await db.activityFactReview.count(),
      corrections: await db.activityFactCorrection.count(),
      milestones: await db.documentMilestone.count(),
    };
    const [brief, workspace] = await Promise.all([
      getDealBrief(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow }),
      getNegotiationWorkspace(db, deal.id),
    ]);
    assert.ok(brief);
    assert.ok(workspace);
    const briefRent = brief.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT")!;
    const resolvedRent = workspace.terms.find((term) => term.canonicalType === "BASE_RENT")!;
    assert.deepEqual(briefRent.landlordPosition, resolvedRent.landlordPosition);
    assert.deepEqual(briefRent.tenantPosition, resolvedRent.tenantPosition);
    assert.equal(briefRent.landlordPosition?.kind, "VALUE");
    assert.match(briefRent.landlordPosition?.kind === "VALUE" ? briefRent.landlordPosition.value.summary : "", /67/);
    assert.equal(brief.negotiation.summary.conflictCount, workspace.conflictCount);
    const second = await getDealBrief(db, deal.id, { expectedWorkspaceId: deal.workspaceId, now: fixedNow });
    assert.deepEqual(second, brief);
    assert.deepEqual({
      terms: await db.negotiationTerm.count(),
      facts: await db.activityFact.count(),
      runs: await db.activityExtractionRun.count(),
      reviews: await db.activityFactReview.count(),
      corrections: await db.activityFactCorrection.count(),
      milestones: await db.documentMilestone.count(),
    }, before);
  });

  test("D/E corrected facts preserve raw extraction, change presentation, and never become NegotiationTerms", async () => {
    const original = await db.activityFact.findUniqueOrThrow({ where: { id: rentFactId } });
    const termCount = await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } });
    const brief = await getDealBrief(db, deal.id, { now: fixedNow });
    const fact = brief?.communications.flatMap((item) => item.facts).find((item) => item.id === rentFactId);
    assert.equal(fact?.raw.value.numeric, 72.5);
    assert.equal(fact?.correction?.value.numeric, 72);
    assert.equal(fact?.presentation.value, "$72.00 / RSF / year");
    assert.equal(fact?.presentation.corrected, true);
    assert.deepEqual((await db.activityFact.findUniqueOrThrow({ where: { id: rentFactId } })).structuredPayload, original.structuredPayload);
    assert.equal(await db.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), termCount);
    assert.equal(brief?.recentChanges.some((change) => change.type === "MESSAGE_FACT_CORRECTED" && change.source.id === original.sourceMessageId), true);
  });

  test("E/F/G/H/I/J/K reviewed comparisons are exact, correction-aware, source-backed, and conservative", async () => {
    const brief = await getDealBrief(db, deal.id, { now: fixedNow });
    assert.ok(brief);
    const match = brief.comparisons.find((item) => item.communication.factId === matchingFactId);
    assert.equal(match?.outcome, "MATCH");
    assert.equal(match?.reason, "EXACT_VALUE_MATCH");
    assert.equal(match?.formal.numeric, 67);
    assert.equal(match?.communication.numeric, 67);
    assert.ok(match?.formal.source?.id);
    assert.ok(match?.communication.source.id);
    assert.notEqual(match?.formal.source?.id, match?.communication.source.id);

    const corrected = brief.comparisons.find((item) => item.communication.factId === rentFactId);
    assert.equal(corrected?.outcome, "DIFFERS");
    assert.equal(corrected?.communication.numeric, 72);
    assert.equal(corrected?.communication.corrected, true);
    assert.notEqual(corrected?.communication.numeric, 72.5);

    const unreviewed = brief.comparisons.find((item) => item.communication.value.includes("70.00"));
    assert.equal(unreviewed?.outcome, "NOT_COMPARABLE");
    assert.equal(unreviewed?.reason, "UNREVIEWED_COMMUNICATION");
    assert.equal(brief.productAttention.some((item) => item.type === "COMMUNICATION_FORMAL_DIFFERENCE" && item.sourceId === unreviewed?.communication.factId), false);

    const incompatible = brief.comparisons.find((item) => item.communication.factId === nonComparableFactId);
    assert.equal(incompatible?.outcome, "NOT_COMPARABLE");
    assert.equal(incompatible?.reason, "UNIT_MISMATCH");
  });

  test("A/B product attention is isolated from system review debt and ranked by deal consequence", async () => {
    const brief = await getDealBrief(db, deal.id, { now: fixedNow });
    assert.ok(brief);
    assert.ok(brief.systemAttention.some((item) => item.type === "MESSAGE_REVIEW_REQUIRED" && item.sourceKind === "COMMUNICATION_EVIDENCE"));
    assert.ok(brief.productAttention.some((item) => item.type === "MESSAGE_FOLLOW_UP"));
    assert.ok(brief.productAttention.some((item) => item.type === "NEW_COMMERCIAL_EVIDENCE" && item.href.includes("/documents/")));
    assert.equal(brief.productAttention.some((item) => item.type === "MESSAGE_ANALYSIS_FAILED" || item.type === "DOCUMENT_ANALYSIS_FAILED"), false);
    assert.ok(brief.systemAttention.some((item) => item.type === "MESSAGE_ANALYSIS_FAILED" && item.description === "Fixture extraction failure"));
    assert.ok(brief.systemAttention.some((item) => item.type === "DOCUMENT_ANALYSIS_FAILED"));
    assert.equal(brief.productAttention[0]?.priority, 1);
    assert.equal(brief.productAttention.every((item) => item.category === "PRODUCT"), true);
    assert.equal(brief.systemAttention.every((item) => item.category === "SYSTEM_REVIEW"), true);
    const hygiene = new Set(["ENTITY_REVIEW_REQUIRED", "RELATIONSHIP_REVIEW_REQUIRED", "PROVENANCE_REVIEW_REQUIRED"]);
    assert.equal(brief.productAttention.some((item) => hygiene.has(item.type)), false);
    assert.deepEqual(brief.attention, [...brief.productAttention, ...brief.systemAttention]);
  });

  test("I negotiation conflict and unresolved state are sourced only from formal terms", async () => {
    const conflictDeal = await createTestDeal(db);
    await formalRound(db, conflictDeal.id, {
      amount: 68,
      secondAmount: 69,
      date: "2026-09-26T12:00:00Z",
    });
    const brief = await getDealBrief(db, conflictDeal.id, { now: fixedNow });
    assert.equal(brief?.negotiation.summary.conflictCount, 1);
    assert.ok(brief?.attention.some((item) => item.type === "NEGOTIATION_CONFLICT" && item.sourceKind === "FORMAL_NEGOTIATION"));
  });

  test("J/K recent changes preserve source identity and since filters communications, changes, and timeline", async () => {
    const since = new Date("2026-09-23T00:00:00Z");
    const brief = await getDealBrief(db, deal.id, { since, now: fixedNow });
    assert.ok(brief);
    assert.equal(brief.since, since.toISOString());
    assert.equal(brief.communications.some((item) => item.subject === "Email rent discussion"), false);
    assert.equal(brief.communications.some((item) => item.subject === "Message requiring review"), true);
    assert.equal(brief.recentChanges.every((item) => new Date(item.timestamp) > since), true);
    assert.equal(brief.timeline.every((item) => new Date(item.occurredAt ?? item.recordedAt ?? 0) > since), true);
    assert.equal(brief.recentChanges.every((item) => Boolean(item.source.id) && item.source.kind === item.sourceKind), true);
  });

  test("L/M/N meaningful changes outrank housekeeping and empty since reads stay calm", async () => {
    const brief = await getDealBrief(db, deal.id, { now: fixedNow });
    assert.ok(brief);
    assert.equal(brief.recentChanges[0]?.sourceKind, "FORMAL_NEGOTIATION");
    assert.equal(brief.recentChanges.some((item) => item.type === "DOCUMENT_MILESTONE" && item.label === "Analyzed"), false);
    assert.ok(brief.recentChanges.some((item) => item.type === "MESSAGE_FACTS_ADDED"));
    assert.ok(brief.recentChanges.some((item) => item.type === "MESSAGE_FACT_CORRECTED"));

    const since = new Date("2030-01-01T00:00:00Z");
    const empty = await getDealBrief(db, deal.id, { since, now: fixedNow });
    assert.ok(empty);
    assert.deepEqual(empty.recentChanges, []);
    assert.equal(empty.changeSummary.meaningfulCount, 0);
    assert.equal(empty.changeSummary.emptyState, `No meaningful changes since ${since.toISOString()}.`);
    assert.ok(empty.negotiation.terms.length > 0);
  });

  test("L invalid query and cross-workspace access are rejected safely", async () => {
    assert.throws(
      () => parseDealBriefQuery(new URLSearchParams("since=not-a-date")),
      (error) => error instanceof DealBriefQueryError
    );
    assert.throws(
      () => parseDealBriefQuery(new URLSearchParams("workspaceId=client-controlled")),
      (error) => error instanceof DealBriefQueryError
    );
    const foreign = await db.workspace.create({ data: { name: "Foreign brief workspace" } });
    assert.equal(await getDealBrief(db, deal.id, { expectedWorkspaceId: foreign.id, now: fixedNow }), null);
  });

  test("O legacy activity remains one fallback timeline item and is not promoted to formal negotiation", async () => {
    const brief = await getDealBrief(db, deal.id, { now: fixedNow });
    const legacy = brief?.timeline.filter((item) => item.type === "LEGACY_ACTIVITY") ?? [];
    assert.equal(legacy.length, 1);
    assert.match(legacy[0]?.description ?? "", /72\.50/);
    assert.equal(legacy[0]?.source.kind, "LEGACY_ACTIVITY");
    const landlord = brief?.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition;
    assert.match(landlord?.kind === "VALUE" ? landlord.value.summary : "", /67/);
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
