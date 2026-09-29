import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { ingestEmlMessage, ingestSourceMessage } from "@/lib/messages/ingest/service";
import { promoteAttachmentToDocument } from "@/lib/messages/promoteAttachment";
import { LocalMessageStorage } from "@/lib/messages/storage";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/messages/acme-loi.eml"
);

describe("deal delete", { concurrency: 1 }, () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  const messageStorage = new LocalMessageStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-delete-msg-")));
  const documentStorage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-delete-doc-")));

  test("setup", async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test("deletes a deal after an attachment promotion and a reviewed fact", async () => {
    const neighbor = await createTestDeal(prisma);
    const promoted = await createTestDeal(prisma);
    const reviewed = await createTestDeal(prisma);
    const fixture = readFileSync(fixturePath);
    const imported = await ingestEmlMessage(prisma, {
      dealId: promoted.id,
      bytes: fixture,
      filename: "acme-loi.eml",
      mimeType: "message/rfc822",
    }, { storage: messageStorage });
    const attachment = imported.attachments[0]!;
    assert.equal(attachment.filename, "acme-loi.pdf");
    await promoteAttachmentToDocument(prisma, {
      messageId: imported.id,
      attachmentId: attachment.id,
      expectedWorkspaceId: promoted.workspaceId,
      messageStorage,
      documentStorage,
    });
    await reviewedFact(prisma, promoted.id, promoted.workspaceId, imported.id);

    const message = await ingestSourceMessage(prisma, {
      dealId: reviewed.id,
      sourceType: "MANUAL",
      subject: "Rent note",
      senderName: "Broker",
      senderAddress: "broker@example.test",
      sentAt: new Date("2026-09-22T15:00:00.000Z"),
      bodyText: "Landlord proposes $72.50/RSF.",
    });
    await reviewedFact(prisma, reviewed.id, reviewed.workspaceId, message.id);

    assert.equal(await prisma.attachmentDocumentPromotion.count({ where: { dealId: promoted.id } }), 1);
    assert.equal(await prisma.activityFactReview.count({ where: { activityFact: { dealId: { in: [promoted.id, reviewed.id] } } } }), 2);

    await prisma.deal.delete({ where: { id: promoted.id } });
    await prisma.deal.deleteMany({ where: { id: reviewed.id } });

    assert.equal(await prisma.deal.count({ where: { id: { in: [promoted.id, reviewed.id] } } }), 0);
    assert.equal(await prisma.document.count({ where: { dealId: promoted.id } }), 0);
    assert.equal(await prisma.sourceMessage.count({ where: { dealId: { in: [promoted.id, reviewed.id] } } }), 0);
    assert.equal(await prisma.activityFact.count({ where: { dealId: { in: [promoted.id, reviewed.id] } } }), 0);
    assert.equal(await prisma.activityFactReview.count(), 0);
    assert.equal(await prisma.activityFactCorrection.count(), 0);
    assert.equal(await prisma.attachmentDocumentPromotion.count(), 0);
    assert.equal(await prisma.deal.count({ where: { id: neighbor.id } }), 1);

    const objects = await prisma.$queryRawUnsafe<Array<{ name: string; type: string }>>(
      `SELECT name, type FROM sqlite_master WHERE name IN ('graph_edge', 'delete_deal_dependents')`
    );
    assert.deepEqual(
      objects.map((item) => `${item.type}:${item.name}`).sort(),
      ["trigger:delete_deal_dependents", "view:graph_edge"]
    );
  });

  test("cleanup", async () => {
    await cleanup();
  });
});

async function reviewedFact(prisma: PrismaClient, dealId: string, workspaceId: string, sourceMessageId: string) {
  const run = await prisma.activityExtractionRun.create({
    data: {
      workspaceId,
      sourceMessageId,
      extractor: "fixture",
      extractorVersion: "jon-70",
      contractVersion: "1",
      model: sourceMessageId,
      status: "SUCCEEDED",
      factCount: 1,
    },
  });
  const fact = await prisma.activityFact.create({
    data: {
      workspaceId,
      dealId,
      sourceMessageId,
      activityExtractionRunId: run.id,
      factType: "NEGOTIATION_VALUE",
      canonicalType: "BASE_RENT",
      side: "LANDLORD",
      assertionStatus: "PROPOSED",
      structuredPayload: {},
      evidenceQuote: "Landlord proposes $72.50/RSF.",
      provenanceStatus: "EXACT",
      extractionMethod: "DETERMINISTIC",
    },
  });
  const review = await prisma.activityFactReview.create({
    data: {
      workspaceId,
      sourceMessageId,
      activityFactId: fact.id,
      state: "INCORRECT",
    },
  });
  await prisma.activityFactCorrection.create({
    data: {
      workspaceId,
      sourceMessageId,
      activityFactId: fact.id,
      activityFactReviewId: review.id,
      structuredPayload: { display: "$67.00 / RSF / year" },
    },
  });
}
