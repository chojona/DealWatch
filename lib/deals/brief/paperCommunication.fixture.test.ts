import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { extractPdfDocument } from "@/lib/documents/extractPdf";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase } from "@/lib/documents/testDb";
import { displayedComparisons } from "@/lib/deals/brief/presentation";
import { getDealBrief } from "@/lib/deals/brief/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { ingestSourceMessage } from "@/lib/messages/ingest/service";
import { analyzeSourceMessage } from "@/lib/messages/service";
import { LocalMessageStorage } from "@/lib/messages/storage";
import { decideMessageReview, reviewActivityFact } from "@/lib/messages/review";
import { reviewFormalTerm } from "@/lib/review/formalTerm";
import {
  ACME_COMMUNICATION_BODY,
  ACME_COMMUNICATION_SUBJECT,
  ACME_RENT_LINE,
  acmeLoiPdf,
  installCheckedInAcmeDeal,
  installFormalRentDocument,
  readAcmeLoiPdf,
  totalRentCompletion,
  misreadRentCompletion,
} from "./paperCommunicationFixture";

const documentRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-paper-doc-"));
const messageRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-paper-msg-"));
const documentStorage = new LocalDocumentStorage(documentRoot);
const messageStorage = new LocalMessageStorage(messageRoot);

function landlordSummary(workspace: Awaited<ReturnType<typeof getNegotiationWorkspace>>): string | null {
  const position = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition;
  return position?.kind === "VALUE" ? position.value.summary : null;
}

describe("paper versus communication evidence", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;
  let differs: Awaited<ReturnType<typeof installCheckedInAcmeDeal>>;

  test("checked-in Acme LOI matches the deterministic PDF text", async () => {
    const bytes = readAcmeLoiPdf();
    assert.equal(bytes.equals(acmeLoiPdf()), true);
    const extracted = await extractPdfDocument(bytes);
    assert.equal(extracted.pages[0]?.text.includes(ACME_RENT_LINE), true);
  });

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
    differs = await installCheckedInAcmeDeal(db, { storage: documentStorage, messageStorage });
  });

  test("unreviewed and acknowledged communication does not become a current comparison", async () => {
    const before = await getDealBrief(db, differs.dealId);
    const unreviewed = before?.comparisons.find((item) => item.communication.factId === differs.factId);
    assert.equal(unreviewed?.outcome, "NOT_COMPARABLE");
    assert.equal(unreviewed?.reason, "UNREVIEWED_COMMUNICATION");
    assert.equal(displayedComparisons(before?.comparisons ?? []).some((item) => item.communication.factId === differs.factId), false);
    assert.equal(before?.productAttention.some((item) => item.type === "COMMUNICATION_FORMAL_DIFFERENCE"), false);

    await decideMessageReview(db, { sourceMessageId: differs.messageId!, decision: "ACKNOWLEDGED" });
    const acknowledged = await getDealBrief(db, differs.dealId);
    const stillUnreviewed = acknowledged?.comparisons.find((item) => item.communication.factId === differs.factId);
    assert.equal(stillUnreviewed?.outcome, "NOT_COMPARABLE");
    assert.equal(stillUnreviewed?.reason, "UNREVIEWED_COMMUNICATION");
    assert.equal(await db.formalTermReview.count({ where: { negotiationTermId: differs.termId } }), 0);
  });

  test("$67 paper versus reviewed $72 communication differs without changing formal truth", async () => {
    const termBefore = await db.negotiationTerm.findUniqueOrThrow({ where: { id: differs.termId } });
    await reviewActivityFact(db, {
      sourceMessageId: differs.messageId!,
      activityFactId: differs.factId!,
      state: "CONFIRMED",
      expectedWorkspaceId: differs.workspaceId,
    });
    const brief = await getDealBrief(db, differs.dealId, { expectedWorkspaceId: differs.workspaceId });
    const comparison = brief?.comparisons.find((item) => item.communication.factId === differs.factId);
    assert.equal(comparison?.outcome, "DIFFERS");
    assert.equal(comparison?.reason, "EXACT_VALUE_DIFFERENCE");
    assert.equal(comparison?.formal.value, "$67.00 / RSF / yr");
    assert.equal(comparison?.formal.numeric, 67);
    assert.equal(comparison?.formal.unit, "USD_PER_RSF_YEAR");
    assert.equal(comparison?.communication.value, "$72.00 / RSF / year");
    assert.equal(comparison?.communication.numeric, 72);
    assert.equal(comparison?.communication.unit, "USD_PER_RSF_YEAR");
    assert.equal(comparison?.formal.evidenceQuote, ACME_RENT_LINE);
    assert.equal(comparison?.formal.pageLabel, "Page 1");
    assert.equal(comparison?.formal.reviewState, null);
    assert.equal(comparison?.formal.source?.documentId, differs.documentId);
    assert.equal(comparison?.formal.source?.href, `/documents/${differs.documentId}/review?section=negotiation`);
    assert.equal(comparison?.communication.subject, ACME_COMMUNICATION_SUBJECT);
    assert.equal(comparison?.communication.sender, "Derek Hollis");
    assert.equal(comparison?.communication.evidenceQuote, "The landlord can do $72.00 per RSF per year");
    assert.equal(comparison?.communication.reviewState, "CONFIRMED");
    assert.equal(comparison?.communication.source.href, `/messages/${differs.messageId}`);
    assert.equal(comparison?.communication.source.messageId, differs.messageId);
    assert.notEqual(comparison?.formal.source?.id, comparison?.communication.source.id);

    const attention = brief?.productAttention.find((item) => item.type === "COMMUNICATION_FORMAL_DIFFERENCE");
    assert.match(attention?.description ?? "", /\$67\.00 \/ RSF \/ yr/);
    assert.match(attention?.description ?? "", /\$72\.00 \/ RSF \/ year/);
    assert.equal(/override|current rent is \$72|formal rent changed/i.test(`${attention?.label} ${attention?.description}`), false);
    assert.equal(displayedComparisons(brief?.comparisons ?? []).some((item) => item.outcome === "DIFFERS"), true);

    const termAfter = await db.negotiationTerm.findUniqueOrThrow({ where: { id: differs.termId } });
    assert.equal(termAfter.normalizedNumeric, 67);
    assert.equal(termAfter.rawValue, termBefore.rawValue);
    assert.deepEqual(termAfter.structuredPayload, termBefore.structuredPayload);
    assert.equal(await db.formalTermReview.count({ where: { negotiationTermId: differs.termId } }), 0);
    const workspace = await getNegotiationWorkspace(db, differs.dealId);
    assert.equal(landlordSummary(workspace), "$67.00 / RSF / yr");
    const paper = brief?.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(paper?.landlordPosition?.kind === "VALUE" ? paper.landlordPosition.value.summary : null, "$67.00 / RSF / yr");
  });

  test("corrected communication uses the effective value and leaves raw extraction and formal truth alone", async () => {
    const formal = await installFormalRentDocument(db, {
      name: "Acme Acquisition — corrected communication",
      workspaceId: differs.workspaceId,
      storage: documentStorage,
      pdf: readAcmeLoiPdf(),
      filename: "acme-acquisition-loi.pdf",
      rentLine: ACME_RENT_LINE,
      amount: 67,
    });
    const message = await ingestSourceMessage(db, {
      dealId: formal.dealId,
      sourceType: "FIXTURE",
      sourceProvider: "paper-communication-fixture",
      externalMessageId: "corrected-rent",
      subject: ACME_COMMUNICATION_SUBJECT,
      senderName: "Derek Hollis",
      senderAddress: "derek.hollis@harborrealty.example",
      sentAt: new Date("2026-09-22T16:00:00.000Z"),
      bodyText: ACME_COMMUNICATION_BODY,
    });
    await analyzeSourceMessage(db, message.id, { complete: async () => misreadRentCompletion() });
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    const rawPayload = fact.structuredPayload;
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "INCORRECT",
      correctedPayload: {
        display: "$72.00 / RSF / year",
        numeric: 72,
        unit: "USD_PER_RSF_YEAR",
        negotiation: { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: 72 } },
      },
      note: "The email says $72.00 per RSF per year.",
      expectedWorkspaceId: formal.workspaceId,
    });
    const brief = await getDealBrief(db, formal.dealId);
    const comparison = brief?.comparisons.find((item) => item.communication.factId === fact.id);
    assert.equal(comparison?.outcome, "DIFFERS");
    assert.equal(comparison?.formal.numeric, 67);
    assert.equal(comparison?.communication.numeric, 72);
    assert.equal(comparison?.communication.corrected, true);
    assert.equal(comparison?.communication.rawValue, "$27.00 / RSF / year");
    assert.equal(comparison?.communication.reviewState, "INCORRECT");
    const stored = await db.activityFact.findUniqueOrThrow({ where: { id: fact.id } });
    assert.deepEqual(stored.structuredPayload, rawPayload);
    assert.equal((stored.structuredPayload as { numeric: number }).numeric, 27);
    const term = await db.negotiationTerm.findUniqueOrThrow({ where: { id: formal.termId } });
    assert.equal(term.normalizedNumeric, 67);
    assert.equal(await db.formalTermReview.count({ where: { negotiationTermId: formal.termId } }), 0);
  });

  test("matching reviewed communication does not create discrepancy attention or change paper", async () => {
    const formal = await installFormalRentDocument(db, {
      name: "Acme Acquisition — matching rent",
      workspaceId: differs.workspaceId,
      storage: documentStorage,
      pdf: readAcmeLoiPdf(),
      filename: "acme-acquisition-loi.pdf",
      rentLine: ACME_RENT_LINE,
      amount: 67,
    });
    const body = "The landlord can do $67.00 per RSF per year.";
    const message = await ingestSourceMessage(db, {
      dealId: formal.dealId,
      sourceType: "FIXTURE",
      sourceProvider: "paper-communication-fixture",
      externalMessageId: "matching-rent",
      subject: "Rent confirmation",
      senderName: "Derek Hollis",
      senderAddress: "derek.hollis@harborrealty.example",
      sentAt: new Date("2026-09-22T17:00:00.000Z"),
      bodyText: body,
    });
    await analyzeSourceMessage(db, message.id);
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "CONFIRMED",
    });
    const brief = await getDealBrief(db, formal.dealId);
    const comparison = brief?.comparisons.find((item) => item.communication.factId === fact.id);
    assert.equal(comparison?.outcome, "MATCH");
    assert.equal(comparison?.reason, "EXACT_VALUE_MATCH");
    assert.equal(comparison?.formal.numeric, 67);
    assert.equal(comparison?.communication.numeric, 67);
    assert.notEqual(comparison?.formal.source?.id, comparison?.communication.source.id);
    assert.equal(brief?.productAttention.some((item) => item.type === "COMMUNICATION_FORMAL_DIFFERENCE"), false);
    assert.equal(displayedComparisons(brief?.comparisons ?? []).some((item) => item.outcome === "DIFFERS"), false);
    assert.equal((await db.negotiationTerm.findUniqueOrThrow({ where: { id: formal.termId } })).normalizedNumeric, 67);
    assert.equal(await db.formalTermReview.count({ where: { negotiationTermId: formal.termId } }), 0);
  });

  test("a unit mismatch is not comparable and does not create a conflict", async () => {
    const formal = await installFormalRentDocument(db, {
      name: "Acme Acquisition — total rent",
      workspaceId: differs.workspaceId,
      storage: documentStorage,
      pdf: readAcmeLoiPdf(),
      filename: "acme-acquisition-loi.pdf",
      rentLine: ACME_RENT_LINE,
      amount: 67,
    });
    const message = await ingestSourceMessage(db, {
      dealId: formal.dealId,
      sourceType: "FIXTURE",
      sourceProvider: "paper-communication-fixture",
      externalMessageId: "total-rent",
      subject: "Monthly total",
      senderName: "Derek Hollis",
      senderAddress: "derek.hollis@harborrealty.example",
      sentAt: new Date("2026-09-22T18:00:00.000Z"),
      bodyText: "The landlord proposed $67 total monthly rent.",
    });
    await analyzeSourceMessage(db, message.id, { complete: async () => totalRentCompletion() });
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "CONFIRMED",
    });
    const brief = await getDealBrief(db, formal.dealId);
    const comparison = brief?.comparisons.find((item) => item.communication.factId === fact.id);
    assert.equal(comparison?.outcome, "NOT_COMPARABLE");
    assert.equal(comparison?.reason, "UNIT_MISMATCH");
    assert.equal(displayedComparisons(brief?.comparisons ?? []).some((item) => item.outcome === "DIFFERS" || item.outcome === "NOT_COMPARABLE"), false);
    assert.equal(brief?.productAttention.some((item) => item.type === "COMMUNICATION_FORMAL_DIFFERENCE"), false);
    assert.equal((await db.negotiationTerm.findUniqueOrThrow({ where: { id: formal.termId } })).normalizedNumeric, 67);
    assert.equal(await db.formalTermReview.count({ where: { negotiationTermId: formal.termId } }), 0);
  });

  test("rejected communication does not drive the current comparison", async () => {
    const formal = await installFormalRentDocument(db, {
      name: "Acme Acquisition — rejected rent",
      workspaceId: differs.workspaceId,
      storage: documentStorage,
      pdf: readAcmeLoiPdf(),
      filename: "acme-acquisition-loi.pdf",
      rentLine: ACME_RENT_LINE,
      amount: 67,
    });
    const message = await ingestSourceMessage(db, {
      dealId: formal.dealId,
      sourceType: "FIXTURE",
      sourceProvider: "paper-communication-fixture",
      externalMessageId: "rejected-rent",
      subject: ACME_COMMUNICATION_SUBJECT,
      senderName: "Derek Hollis",
      senderAddress: "derek.hollis@harborrealty.example",
      sentAt: new Date("2026-09-22T19:00:00.000Z"),
      bodyText: ACME_COMMUNICATION_BODY,
    });
    await analyzeSourceMessage(db, message.id);
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "INCORRECT",
    });
    const brief = await getDealBrief(db, formal.dealId);
    const comparison = brief?.comparisons.find((item) => item.communication.factId === fact.id);
    assert.equal(comparison?.outcome, "NOT_COMPARABLE");
    assert.equal(comparison?.reason, "CORRECTION_MISSING");
    assert.equal(comparison?.communication.reviewed, false);
    assert.equal(displayedComparisons(brief?.comparisons ?? []).length, 0);
    assert.equal(brief?.productAttention.some((item) => item.type === "COMMUNICATION_FORMAL_DIFFERENCE"), false);
    assert.equal((await db.negotiationTerm.findUniqueOrThrow({ where: { id: formal.termId } })).normalizedNumeric, 67);
    assert.equal(await db.formalTermReview.count({ where: { negotiationTermId: formal.termId } }), 0);
  });

  test("reconciliation uses the corrected formal value and keeps the raw extraction", async () => {
    const line = "Base Rent: $76.00 per rentable square foot per year";
    const formal = await installFormalRentDocument(db, {
      name: "Acme Acquisition — formal correction",
      workspaceId: differs.workspaceId,
      storage: documentStorage,
      pdf: buildTextPdf([["Acme Acquisition", "Letter of Intent", line].join("\n")]),
      filename: "acme-acquisition-76.pdf",
      rentLine: line,
      amount: 76,
    });
    await reviewFormalTerm(db, {
      documentId: formal.documentId,
      negotiationTermId: formal.termId,
      action: "CORRECT",
      amountPerRSFYear: 67,
      rawValue: ACME_RENT_LINE,
    });
    const message = await ingestSourceMessage(db, {
      dealId: formal.dealId,
      sourceType: "FIXTURE",
      sourceProvider: "paper-communication-fixture",
      externalMessageId: "formal-correction-email",
      subject: ACME_COMMUNICATION_SUBJECT,
      senderName: "Derek Hollis",
      senderAddress: "derek.hollis@harborrealty.example",
      sentAt: new Date("2026-09-23T15:00:00.000Z"),
      bodyText: ACME_COMMUNICATION_BODY,
    });
    await analyzeSourceMessage(db, message.id);
    const fact = await db.activityFact.findFirstOrThrow({ where: { sourceMessageId: message.id } });
    await reviewActivityFact(db, {
      sourceMessageId: message.id,
      activityFactId: fact.id,
      state: "CONFIRMED",
    });
    const brief = await getDealBrief(db, formal.dealId);
    const comparison = brief?.comparisons.find((item) => item.communication.factId === fact.id);
    assert.equal(comparison?.outcome, "DIFFERS");
    assert.equal(comparison?.formal.value, "$67.00 / RSF / yr");
    assert.equal(comparison?.formal.numeric, 67);
    assert.equal(comparison?.communication.numeric, 72);
    assert.equal(comparison?.formal.reviewState, "CORRECTED");
    const raw = await db.negotiationTerm.findUniqueOrThrow({ where: { id: formal.termId } });
    assert.equal(raw.normalizedNumeric, 76);
    assert.equal(raw.evidenceQuote, line);
    const review = await db.formalTermReview.findUniqueOrThrow({ where: { negotiationTermId: formal.termId } });
    assert.equal(review.state, "CORRECTED");
    assert.equal(review.normalizedNumeric, 67);
    assert.equal(landlordSummary(await getNegotiationWorkspace(db, formal.dealId)), "$67.00 / RSF / yr");
  });

  test("another workspace cannot read the deal, and another deal does not inherit its comparison", async () => {
    const foreign = await db.workspace.create({ data: { name: "Foreign paper workspace" } });
    assert.equal(await getDealBrief(db, differs.dealId, { expectedWorkspaceId: foreign.id }), null);
    const other = await db.deal.create({
      data: {
        name: "Other Acquisition",
        company: "Other",
        property: "2 Other Plaza",
        stage: "LOI",
        status: "ACTIVE",
        workspaceId: differs.workspaceId,
      },
    });
    const otherBrief = await getDealBrief(db, other.id);
    assert.equal(otherBrief?.comparisons.some((item) => item.communication.factId === differs.factId), false);
    assert.equal(otherBrief?.communications.some((item) => item.id === differs.messageId), false);
    const acme = await getDealBrief(db, differs.dealId);
    assert.equal(acme?.communications.some((item) => item.id === differs.messageId), true);
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
