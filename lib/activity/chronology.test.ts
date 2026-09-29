import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { analyzeNegotiationDocument, ingestNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import type { NegotiationTermExtractor } from "@/lib/documents/ingestNegotiationPdf";
import { getDealBrief } from "@/lib/deals/brief/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { ingestEmlMessage, ingestManualMessage } from "@/lib/messages/ingest/service";
import { LocalMessageStorage } from "@/lib/messages/storage";
import { analyzeSourceMessage } from "@/lib/messages/service";
import { decideMessageReview, reviewActivityFact } from "@/lib/messages/review";
import { recordReviewDecision } from "@/lib/review/decisions";
import { reviewFormalTerm } from "@/lib/review/formalTerm";
import { getActivityPage } from "./service";
import type { ActivityEvent } from "./types";

const revisedRent = readFileSync(new URL("../../fixtures/messages/revised-rent.eml", import.meta.url));
const sentAt = new Date("2026-09-29T14:30:00.000Z");

function rentPayload(amount: number): Prisma.InputJsonValue {
  return { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: amount } };
}

function communications(events: ActivityEvent[]) {
  return events.filter((event) => event.sourceType === "SOURCE_MESSAGE");
}

function negotiationEvents(events: ActivityEvent[]) {
  return events.filter((event) => event.sourceType === "NEGOTIATION_ROUND");
}

function baseRent(event: ActivityEvent) {
  return event.details?.find((detail) => detail.canonicalType === "BASE_RENT");
}

async function activity(db: PrismaClient, dealId: string) {
  const page = await getActivityPage(db, { rootType: "DEAL", rootId: dealId, limit: 50 });
  assert.ok(page);
  return page;
}

async function formalPaper(
  db: PrismaClient,
  dealId: string,
  input: { amount: number; at: string; name: string; roundNumber: number }
) {
  const document = await db.document.create({
    data: {
      dealId,
      filename: input.name,
      originalFilename: input.name,
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: `${input.name}-${input.amount}`.padEnd(64, "a").slice(0, 64),
      documentType: input.roundNumber === 1 ? "PROPOSAL" : "COUNTERPROPOSAL",
      documentDate: new Date(input.at),
      negotiationSide: "LANDLORD",
      ingestionStatus: "COMPLETE",
      storageKey: `chronology/${input.name}`,
      createdAt: new Date(input.at),
    },
  });
  const round = await db.negotiationRound.create({
    data: {
      dealId,
      side: "LANDLORD",
      roundNumber: input.roundNumber,
      documentName: input.name,
      documentText: "Formal paper",
      documentDate: new Date(input.at),
      sourceType: "UPLOADED_PDF",
      documentId: document.id,
      createdAt: new Date(input.at),
      terms: {
        create: {
          canonicalType: "BASE_RENT",
          normalizedValue: `$${input.amount.toFixed(2)} / RSF / yr`,
          normalizedNumeric: input.amount,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: `$${input.amount.toFixed(2)}`,
          status: "PROPOSED",
          side: "LANDLORD",
          roundNumber: input.roundNumber,
          confidence: 1,
          evidenceQuote: `Base rent ${input.amount.toFixed(2)}`,
          provenanceStatus: "EXACT",
          structuredPayload: rentPayload(input.amount),
        },
      },
    },
    include: { terms: true },
  });
  return { document, round, term: round.terms[0]! };
}

describe("activity chronology", { concurrency: 1 }, () => {
  test("one imported email stays one communication event through analysis, review, correction, and acknowledgement", async () => {
    const db = await createTestDatabase();
    const storage = new LocalMessageStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-mail-")));
    try {
      const deal = await createTestDeal(db.prisma);
      const imported = await ingestEmlMessage(db.prisma, {
        dealId: deal.id,
        bytes: revisedRent,
        filename: "revised-rent.eml",
        mimeType: "message/rfc822",
        receivedAt: new Date("2026-10-02T15:00:00.000Z"),
      }, { storage });
      const before = await activity(db.prisma, deal.id);
      const email = communications(before.events);
      assert.equal(email.length, 1);
      assert.equal(email[0]?.id, `source-message:${imported.id}`);
      assert.equal(email[0]?.title, "Revised rent");
      assert.equal(email[0]?.occurredAt, sentAt.toISOString());
      assert.equal(email[0]?.sourceHref, `/messages/${imported.id}`);
      assert.notEqual(email[0]?.occurredAt, email[0]?.recordedAt);

      const analyzed = await analyzeSourceMessage(db.prisma, imported.id);
      assert.equal(analyzed.idempotent, false);
      const rerun = await analyzeSourceMessage(db.prisma, imported.id);
      assert.equal(rerun.idempotent, true);
      const fact = await db.prisma.activityFact.findFirstOrThrow({ where: { sourceMessageId: imported.id, canonicalType: "BASE_RENT" } });
      await reviewActivityFact(db.prisma, {
        sourceMessageId: imported.id,
        activityFactId: fact.id,
        state: "CONFIRMED",
        commercialReview: true,
      });
      await reviewActivityFact(db.prisma, {
        sourceMessageId: imported.id,
        activityFactId: fact.id,
        state: "INCORRECT",
        commercialReview: true,
        correctedPayload: {
          display: "$70.00 / RSF / year",
          numeric: 70,
          unit: "USD_PER_RSF_YEAR",
          negotiation: rentPayload(70),
        },
      });
      await decideMessageReview(db.prisma, { sourceMessageId: imported.id, decision: "ACKNOWLEDGED" });
      const after = await activity(db.prisma, deal.id);
      const still = communications(after.events);
      assert.equal(still.length, 1);
      assert.equal(still[0]?.id, email[0]?.id);
      assert.equal(still[0]?.occurredAt, sentAt.toISOString());
      assert.equal(await db.prisma.dealEvent.count({ where: { dealId: deal.id } }), 0);
      assert.equal(await db.prisma.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), 0);
      assert.equal(after.events.some((event) => /analyzed|acknowledged|confirmed|corrected/i.test(event.title)), false);
    } finally {
      await db.cleanup();
    }
  });

  test("communication chronology prefers sent time, then received time", async () => {
    const db = await createTestDatabase();
    try {
      const deal = await createTestDeal(db.prisma);
      const receivedAt = new Date("2026-09-29T16:00:00.000Z");
      const manual = await ingestManualMessage(db.prisma, {
        dealId: deal.id,
        subject: "Received only",
        bodyText: "No sent timestamp.",
        receivedAt,
      });
      const page = await activity(db.prisma, deal.id);
      const event = communications(page.events).find((item) => item.sourceId === manual.id);
      assert.equal(event?.occurredAt, receivedAt.toISOString());
      assert.equal(event?.recordedAt, manual.createdAt.toISOString());
    } finally {
      await db.cleanup();
    }
  });

  test("document upload, analysis, and review stay one document event and do not treat the paper date as receipt", async () => {
    const db = await createTestDatabase();
    const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-files-")));
    const quote = "Base Rent shall be $72.00 per rentable square foot.";
    const calls: string[] = [];
    const extractTerms: NegotiationTermExtractor = async () => ({
      terms: [{
        canonicalType: "BASE_RENT",
        normalizedValue: "$72.00 / RSF / yr",
        normalizedNumeric: 72,
        normalizedUnit: "USD_PER_RSF_YEAR",
        rawValue: quote,
        status: "PROPOSED",
        confidence: 1,
        evidenceQuote: quote,
        structuredPayload: {
          termType: "BASE_RENT",
          rent: { kind: "simple", amountPerRSFYear: 72 },
        },
      }],
      metadata: { model: "chronology-test", extractedAt: new Date().toISOString(), latencyMs: 1, extractionConfidence: 1, validationFailures: 0 },
    });
    try {
      const deal = await createTestDeal(db.prisma);
      const pdf = buildTextPdf(["Landlord proposal", quote]);
      const uploaded = await ingestNegotiationPdf({
        dealId: deal.id,
        bytes: pdf,
        filename: "Landlord proposal.pdf",
        mimeType: "application/pdf",
        side: "LANDLORD",
        documentDate: new Date("2026-09-15T00:00:00.000Z"),
        documentType: "PROPOSAL",
        storage,
        prisma: db.prisma,
        mode: "extract",
        extractGraph: null,
        extractTerms,
      });
      const receivedAt = new Date("2026-09-29T09:00:00.000Z");
      await db.prisma.document.update({ where: { id: uploaded.document.id }, data: { createdAt: receivedAt } });
      const uploadedPage = await activity(db.prisma, deal.id);
      const uploadedDocs = uploadedPage.events.filter((event) => event.eventType === "DOCUMENT");
      assert.equal(uploadedDocs.length, 1);
      assert.equal(uploadedDocs[0]?.occurredAt, "2026-09-15T00:00:00.000Z");
      assert.equal(uploadedDocs[0]?.recordedAt, receivedAt.toISOString());
      assert.equal(uploadedDocs[0]?.sourceHref, `/documents/${uploaded.document.id}/review`);
      assert.equal(negotiationEvents(uploadedPage.events).length, 0);
      assert.equal(uploadedPage.events.some((event) => event.title === "Document analyzed"), false);

      const analyzed = await analyzeNegotiationDocument({
        documentId: uploaded.document.id,
        prisma: db.prisma,
        extractTerms: async (input) => {
          calls.push(input.documentText);
          return extractTerms(input);
        },
      });
      assert.equal(analyzed.idempotent, false);
      const again = await analyzeNegotiationDocument({ documentId: uploaded.document.id, prisma: db.prisma, extractTerms });
      assert.equal(again.idempotent, true);
      assert.equal(calls.length, 1);
      assert.equal(await db.prisma.documentMilestone.count({ where: { documentId: uploaded.document.id, kind: "ANALYZED" } }), 1);

      const term = await db.prisma.negotiationTerm.findFirstOrThrow({ where: { round: { documentId: uploaded.document.id } } });
      await recordReviewDecision(db.prisma, {
        documentId: uploaded.document.id,
        action: "ACKNOWLEDGE",
        target: { kind: "NEGOTIATION_TERM", negotiationTermId: term.id },
      });
      await recordReviewDecision(db.prisma, {
        documentId: uploaded.document.id,
        action: "ACKNOWLEDGE",
        target: { kind: "NEGOTIATION_TERM", negotiationTermId: term.id },
      });

      const reviewed = await activity(db.prisma, deal.id);
      assert.equal(reviewed.events.filter((event) => event.id === `document:${uploaded.document.id}`).length, 1);
      assert.equal(negotiationEvents(reviewed.events).filter((event) => event.documentId === uploaded.document.id).length, 1);
      const paper = negotiationEvents(reviewed.events)[0];
      assert.equal(paper?.occurredAt, "2026-09-15T00:00:00.000Z");
      assert.equal(paper?.sourceHref, `/documents/${uploaded.document.id}/review?section=negotiation`);
      assert.equal(paper?.negotiationHref, `/deals/${deal.id}/negotiation?round=${paper?.sourceId}`);
      assert.equal(reviewed.events.some((event) => event.title === "Document analyzed"), false);
      const reviewEvents = reviewed.events.filter((event) => event.eventType === "DOCUMENT_REVIEW");
      assert.equal(new Set(reviewEvents.map((event) => event.dedupeKey)).size, reviewEvents.length);
      assert.equal(reviewEvents.some((event) => event.sourceHref === null), false);
    } finally {
      await db.cleanup();
    }
  });

  test("mixed history keeps legacy rent historical, orders formal movement, and isolates workspaces", async () => {
    const db = await createTestDatabase();
    const storage = new LocalMessageStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-mail-")));
    try {
      const deal = await createTestDeal(db.prisma);
      const otherWorkspace = await db.prisma.workspace.create({ data: { name: "Other chronology workspace" } });
      const other = await db.prisma.deal.create({
        data: { workspaceId: otherWorkspace.id, name: "Secret deal", company: "Secret Co", property: "Secret Tower", stage: "Negotiation", status: "ACTIVE" },
      });
      await ingestEmlMessage(db.prisma, {
        dealId: other.id,
        bytes: Buffer.from(revisedRent.toString("utf8").replace("Revised rent", "Secret rent email")),
        filename: "secret.eml",
        mimeType: "message/rfc822",
      }, { storage });

      await db.prisma.dealEvent.create({
        data: {
          dealId: deal.id,
          type: "EMAIL",
          description: "Landlord issued legacy counter at $72.50/RSF/year.",
          occurredAt: new Date("2026-09-29T09:00:00.000Z"),
          confidence: 1,
          evidenceQuote: "Base rent: $72.50/RSF/year",
        },
      });
      const earlier = await formalPaper(db.prisma, deal.id, { amount: 72, at: "2026-09-29T09:30:00.000Z", name: "Earlier formal.pdf", roundNumber: 1 });
      const discussing72 = await ingestEmlMessage(db.prisma, {
        dealId: deal.id,
        bytes: revisedRent,
        filename: "revised-rent.eml",
        mimeType: "message/rfc822",
      }, { storage });
      await db.prisma.sourceMessage.update({ where: { id: discussing72.id }, data: { sentAt: new Date("2026-09-29T10:00:00.000Z") } });
      const later = await formalPaper(db.prisma, deal.id, { amount: 67, at: "2026-09-29T11:00:00.000Z", name: "Later formal.pdf", roundNumber: 2 });
      const discussing70 = await ingestManualMessage(db.prisma, {
        dealId: deal.id,
        subject: "Tenant at seventy",
        bodyText: "The tenant can do $70.00 per RSF per year.",
        sentAt: new Date("2026-09-29T12:00:00.000Z"),
      });
      const tieSent = new Date("2026-09-29T08:00:00.000Z");
      const tieDocument = await db.prisma.document.create({
        data: {
          dealId: deal.id,
          filename: "tie.pdf",
          originalFilename: "Tie upload.pdf",
          mimeType: "application/pdf",
          sizeBytes: 20,
          sha256: "b".repeat(64),
          documentType: "OTHER",
          documentDate: tieSent,
          negotiationSide: null,
          ingestionStatus: "READY",
          storageKey: "chronology/tie.pdf",
          createdAt: tieSent,
        },
      });
      const tieMessage = await ingestManualMessage(db.prisma, {
        dealId: deal.id,
        subject: "Tie message",
        bodyText: "Same instant as the tie upload.",
        sentAt: tieSent,
      });
      await db.prisma.sourceMessage.update({ where: { id: tieMessage.id }, data: { createdAt: tieSent } });

      const page = await activity(db.prisma, deal.id);
      assert.equal(communications(page.events).filter((event) => event.sourceId === discussing72.id).length, 1);
      assert.equal(communications(page.events).filter((event) => event.sourceId === discussing70.id).length, 1);
      const movement = negotiationEvents(page.events).slice().sort((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""));
      assert.deepEqual(movement.map((event) => event.sourceId), [earlier.round.id, later.round.id]);
      assert.equal(baseRent(movement[0]!)?.value, "$72.00 / RSF / yr");
      assert.equal(baseRent(movement[0]!)?.previousValue, undefined);
      assert.equal(baseRent(movement[1]!)?.previousValue, "$72.00 / RSF / yr");
      assert.equal(baseRent(movement[1]!)?.value, "$67.00 / RSF / yr");
      assert.equal(movement[1]?.sourceHref, `/documents/${later.document.id}/review?section=negotiation`);

      const legacy = page.events.filter((event) => event.sourceType === "DEAL_EVENT");
      assert.equal(legacy.length, 1);
      assert.match(legacy[0]?.description ?? "", /\$72\.50/);
      assert.equal(legacy[0]?.sourceHref, null);
      assert.equal(legacy[0]?.evidence?.supports.every((support) => support.href == null && support.reviewHref == null), true);

      const workspace = await getNegotiationWorkspace(db.prisma, deal.id);
      const rent = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT");
      assert.match(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : "", /67/);
      assert.equal(JSON.stringify(workspace?.terms).includes("72.50"), false);
      assert.equal(await db.prisma.negotiationTerm.count({ where: { round: { dealId: deal.id }, rawValue: { contains: "72.50" } } }), 0);

      const tie = page.events.filter((event) => event.occurredAt === tieSent.toISOString() && event.recordedAt === tieSent.toISOString());
      assert.equal(tie.length, 2);
      assert.deepEqual(tie.map((event) => event.sourceType).sort(), ["DOCUMENT", "SOURCE_MESSAGE"]);
      assert.deepEqual(tie.map((event) => event.id), [...tie.map((event) => event.id)].sort((left, right) => left.localeCompare(right)));
      assert.equal(tie.some((event) => event.sourceId === tieDocument.id), true);

      const serialized = JSON.stringify(page);
      assert.equal(serialized.includes(other.id), false);
      assert.equal(serialized.includes("Secret rent email"), false);

      const since = new Date("2026-09-29T10:00:00.000Z");
      const brief = await getDealBrief(db.prisma, deal.id, { since, expectedWorkspaceId: deal.workspaceId });
      assert.ok(brief);
      const messageEvent = communications(page.events).find((event) => event.sourceId === discussing72.id);
      assert.equal(messageEvent?.occurredAt, "2026-09-29T10:00:00.000Z");
      assert.equal(brief.timeline.some((item) => item.id === `communication:${discussing72.id}`), false);
      assert.equal(brief.timeline.some((item) => item.id === `communication:${discussing70.id}`), true);
      assert.equal(brief.timeline.some((item) => item.id === `formal:${earlier.round.id}`), false);
      assert.equal(brief.timeline.some((item) => item.id === `formal:${later.round.id}`), true);
      assert.equal(brief.timeline.every((item) => new Date(item.occurredAt ?? item.recordedAt ?? 0) > since), true);
      const caughtUpRent = brief.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT");
      assert.match(caughtUpRent?.landlordPosition?.kind === "VALUE" ? caughtUpRent.landlordPosition.value.summary : "", /67/);
    } finally {
      await db.cleanup();
    }
  });

  test("corrected formal evidence uses the effective value and rejected evidence is not movement", async () => {
    const db = await createTestDatabase();
    try {
      const deal = await createTestDeal(db.prisma);
      const extracted = await formalPaper(db.prisma, deal.id, { amount: 76, at: "2026-09-29T09:30:00.000Z", name: "Extracted seventy-six.pdf", roundNumber: 1 });
      await reviewFormalTerm(db.prisma, {
        documentId: extracted.document.id,
        negotiationTermId: extracted.term.id,
        action: "CORRECT",
        amountPerRSFYear: 72,
        note: "Paper says seventy-two",
      });
      const moved = await formalPaper(db.prisma, deal.id, { amount: 67, at: "2026-09-29T11:00:00.000Z", name: "Later sixty-seven.pdf", roundNumber: 2 });
      const rejectedDeal = await createTestDeal(db.prisma);
      const kept = await formalPaper(db.prisma, rejectedDeal.id, { amount: 72, at: "2026-09-29T09:30:00.000Z", name: "Kept seventy-two.pdf", roundNumber: 1 });
      const rejected = await formalPaper(db.prisma, rejectedDeal.id, { amount: 80, at: "2026-09-29T11:00:00.000Z", name: "Rejected eighty.pdf", roundNumber: 2 });
      await reviewFormalTerm(db.prisma, {
        documentId: rejected.document.id,
        negotiationTermId: rejected.term.id,
        action: "REJECT",
        note: "This extraction is not the paper term",
      });

      const correctedPage = await activity(db.prisma, deal.id);
      const correctedMovement = negotiationEvents(correctedPage.events).slice().sort((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""));
      assert.equal(baseRent(correctedMovement[0]!)?.value, "$72.00 / RSF / yr");
      assert.equal(baseRent(correctedMovement[1]!)?.previousValue, "$72.00 / RSF / yr");
      assert.equal(baseRent(correctedMovement[1]!)?.value, "$67.00 / RSF / yr");
      assert.equal(correctedMovement.some((event) => event.sourceId === moved.round.id), true);
      assert.equal(correctedMovement.some((event) => event.details?.some((detail) => `${detail.value} ${detail.previousValue ?? ""}`.includes("76"))), false);
      assert.match(correctedMovement[0]?.evidence?.supports.map((support) => support.quote).join(" ") ?? "", /76/);
      const raw = await db.prisma.negotiationTerm.findUniqueOrThrow({ where: { id: extracted.term.id } });
      assert.equal(raw.normalizedNumeric, 76);

      const rejectedPage = await activity(db.prisma, rejectedDeal.id);
      const rejectedMovement = negotiationEvents(rejectedPage.events);
      assert.deepEqual(rejectedMovement.map((event) => event.sourceId), [kept.round.id]);
      assert.equal(baseRent(rejectedMovement[0]!)?.value, "$72.00 / RSF / yr");
      assert.equal(JSON.stringify(rejectedMovement).includes("80"), false);
      const rejectedRaw = await db.prisma.negotiationTerm.findUniqueOrThrow({ where: { id: rejected.term.id } });
      assert.equal(rejectedRaw.normalizedNumeric, 80);
      const current = await getNegotiationWorkspace(db.prisma, rejectedDeal.id);
      const rent = current?.terms.find((term) => term.canonicalType === "BASE_RENT");
      assert.match(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : "", /72/);
      assert.equal(JSON.stringify(rent?.landlordPosition).includes("80"), false);
    } finally {
      await db.cleanup();
    }
  });
});
