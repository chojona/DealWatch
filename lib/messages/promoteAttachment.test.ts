import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getDealBrief } from "@/lib/deals/brief/service";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { analyzeNegotiationDocument, type NegotiationTermExtractor, receiveNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { updateDocumentMetadata } from "@/lib/documents/metadata";
import { needsStoredPageExtraction } from "@/lib/documents/readinessCopy";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { ingestEmlMessage } from "./ingest/service";
import { getMessageSource } from "./service";
import { LocalMessageStorage } from "./storage";
import { AttachmentPromotionError, promoteAttachmentToDocument, rejectPromotionRequest } from "./promoteAttachment";

function eml(input: { id: string; filename: string; contentType: string; bytes: Buffer; body?: string }) {
  return Buffer.from([
    `From: "Derek Broker" <derek@example.test>`,
    `To: Sarah <sarah@example.test>`,
    `Message-ID: <${input.id}>`,
    `Subject: Proposal attached`,
    `Date: Tue, 22 Sep 2026 11:00:00 -0400`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="outer"`,
    ``,
    `--outer`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    input.body ?? "See the attached proposal.",
    `--outer`,
    `Content-Type: ${input.contentType}; name="${input.filename}"`,
    `Content-Disposition: attachment; filename="${input.filename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    input.bytes.toString("base64"),
    `--outer--`,
    ``,
  ].join("\r\n"), "utf8");
}

const quote = "Base Rent shall be $65.00 per rentable square foot.";

function extractor(): NegotiationTermExtractor {
  return async () => ({
    terms: [{
      canonicalType: "BASE_RENT",
      normalizedValue: "$65.00/RSF/year",
      normalizedNumeric: 65,
      normalizedUnit: "USD_PER_RSF_YEAR",
      rawValue: quote,
      status: "PROPOSED",
      confidence: 1,
      evidenceQuote: quote,
      sourceLocation: "Rent",
    }],
    metadata: { model: "mock", extractedAt: new Date().toISOString(), latencyMs: 1, extractionConfidence: 1, validationFailures: 0 },
  });
}

describe("Phase 10C attachment promotion", { concurrency: 1 }, () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  const messageRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-promote-msg-"));
  const documentRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-promote-doc-"));
  const messageStorage = new LocalMessageStorage(messageRoot);
  const documentStorage = new LocalDocumentStorage(documentRoot);

  test("setup", async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test("A–O/S–V PDF promotion preserves identity, stays explicit, and does not analyze", async () => {
    const deal = await createTestDeal(prisma);
    const pdf = buildTextPdf([quote]);
    const digest = createHash("sha256").update(pdf).digest("hex");
    const message = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: eml({ id: "promote-pdf@example.test", filename: "Landlord Proposal.pdf", contentType: "application/pdf", bytes: pdf }),
      filename: "proposal.eml",
    }, { storage: messageStorage });
    const attachment = message.attachments[0]!;
    const beforeMessage = await prisma.sourceMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: { attachments: true, facts: true, extractionRuns: true },
    });
    const beforeFacts = await prisma.activityFact.count();
    const beforeTerms = await prisma.negotiationTerm.count();
    assert.equal(await prisma.attachmentDocumentPromotion.count(), 0);
    const viewed = await getMessageSource(prisma, message.id, { expectedWorkspaceId: deal.workspaceId });
    const briefBefore = await getDealBrief(prisma, deal.id, { expectedWorkspaceId: deal.workspaceId });
    assert.equal(await prisma.attachmentDocumentPromotion.count(), 0);
    assert.equal(viewed?.attachments[0]?.analysisState, "NOT_ANALYZED");
    assert.equal(briefBefore?.systemAttention.some((item) => item.type === "ATTACHMENT_PROMOTION_AVAILABLE" && item.sourceId === attachment.id), true);
    assert.equal(briefBefore?.productAttention.some((item) => item.type === "ATTACHMENT_PROMOTION_AVAILABLE"), false);

    const promoted = await promoteAttachmentToDocument(prisma, {
      messageId: message.id,
      attachmentId: attachment.id,
      expectedWorkspaceId: deal.workspaceId,
      messageStorage,
      documentStorage,
    });
    assert.equal(promoted.created, true);
    assert.equal(promoted.dealId, deal.id);
    assert.equal(promoted.sha256, digest);
    assert.equal(promoted.storageReuse, "HARDLINK");
    assert.equal(promoted.originalFilename, "Landlord Proposal.pdf");
    const document = await prisma.document.findUniqueOrThrow({ where: { id: promoted.documentId } });
    assert.equal(document.dealId, deal.id);
    assert.equal(document.sha256, attachment.sha256);
    assert.equal(document.originalFilename, attachment.filename);
    assert.equal(document.mimeType, "application/pdf");
    assert.equal(document.ingestionStatus, "UPLOADED");
    assert.equal(document.graphExtractionStatus, "NOT_RUN");
    assert.equal(document.documentType, "OTHER");
    assert.equal(document.negotiationSide, null);
    assert.equal(await prisma.documentPage.count({ where: { documentId: document.id } }), 0);
    assert.equal(await prisma.negotiationTerm.count(), beforeTerms);
    assert.equal(await prisma.activityFact.count(), beforeFacts);
    assert.equal(await prisma.activityExtractionRun.count({ where: { sourceMessageId: message.id } }), 0);
    const link = await prisma.attachmentDocumentPromotion.findUniqueOrThrow({ where: { sourceMessageAttachmentId: attachment.id } });
    assert.equal(link.workspaceId, deal.workspaceId);
    assert.equal(link.dealId, deal.id);
    assert.equal(link.sourceMessageId, message.id);
    assert.equal(link.documentId, document.id);
    assert.equal(link.sha256, digest);
    assert.equal(link.originalFilename, attachment.filename);
    assert.equal(link.sourceStorageKey, attachment.storageKey);
    const sourceStat = statSync(messageStorage.absolutePath(attachment.storageKey!));
    const documentStat = statSync(documentStorage.absolutePath(document.storageKey));
    assert.equal(sourceStat.ino, documentStat.ino);
    assert.ok(sourceStat.nlink >= 2);
    const afterMessage = await prisma.sourceMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: { attachments: true, facts: true, extractionRuns: true },
    });
    assert.deepEqual(afterMessage, beforeMessage);

    const again = await promoteAttachmentToDocument(prisma, {
      messageId: message.id,
      attachmentId: attachment.id,
      expectedWorkspaceId: deal.workspaceId,
      messageStorage,
      documentStorage,
    });
    assert.equal(again.created, false);
    assert.equal(again.documentId, promoted.documentId);
    assert.equal(await prisma.document.count({ where: { dealId: deal.id, sha256: digest } }), 1);
    const afterRead = await getMessageSource(prisma, message.id, { expectedWorkspaceId: deal.workspaceId });
    assert.equal(afterRead?.attachments[0]?.analysisState, "PROMOTED");
    assert.equal(afterRead?.attachments[0]?.promotion?.href, `/documents/${document.id}/review`);
    const briefAfter = await getDealBrief(prisma, deal.id, { expectedWorkspaceId: deal.workspaceId });
    assert.equal(briefAfter?.systemAttention.some((item) => item.type === "ATTACHMENT_PROMOTION_AVAILABLE"), false);
    assert.equal(briefAfter?.timeline.some((item) => item.type === "DOCUMENT" && item.source.id === document.id), true);
    assert.equal(await prisma.attachmentDocumentPromotion.count({ where: { sourceMessageAttachmentId: attachment.id } }), 1);
  });

  test("P concurrent promotion cannot create duplicate documents", async () => {
    const deal = await createTestDeal(prisma);
    const pdf = buildTextPdf(["Concurrent promotion"]);
    const message = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: eml({ id: "concurrent-promote@example.test", filename: "Concurrent.pdf", contentType: "application/pdf", bytes: pdf }),
      filename: "concurrent.eml",
    }, { storage: messageStorage });
    const attachment = message.attachments[0]!;
    const input = {
      messageId: message.id,
      attachmentId: attachment.id,
      expectedWorkspaceId: deal.workspaceId,
      messageStorage,
      documentStorage,
    };
    const results = await Promise.allSettled([
      promoteAttachmentToDocument(prisma, input),
      promoteAttachmentToDocument(prisma, input),
    ]);
    const fulfilled = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    assert.ok(fulfilled.length >= 1);
    assert.equal(new Set(fulfilled.map((result) => result.documentId)).size, 1);
    assert.equal(await prisma.document.count({ where: { dealId: deal.id } }), 1);
    assert.equal(await prisma.attachmentDocumentPromotion.count({ where: { sourceMessageAttachmentId: attachment.id } }), 1);
  });

  test("Q/R promoted document uses the existing analysis pipeline", async () => {
    const deal = await createTestDeal(prisma);
    const pdf = buildTextPdf([quote]);
    const message = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: eml({ id: "analyze-promote@example.test", filename: "Analyze.pdf", contentType: "application/pdf", bytes: pdf }),
      filename: "analyze.eml",
    }, { storage: messageStorage });
    const promoted = await promoteAttachmentToDocument(prisma, {
      messageId: message.id,
      attachmentId: message.attachments[0]!.id,
      expectedWorkspaceId: deal.workspaceId,
      messageStorage,
      documentStorage,
    });
    const sourceStat = statSync(documentStorage.absolutePath((await prisma.document.findUniqueOrThrow({ where: { id: promoted.documentId } })).storageKey));
    assert.equal(needsStoredPageExtraction({
      fileReady: true,
      metadataReady: false,
      analysisReady: false,
      missing: [{ code: "EXTRACTED_PAGES" }, { code: "DOCUMENT_DATE" }],
    }, "UPLOADED"), false);
    await updateDocumentMetadata(prisma, promoted.documentId, {
      documentType: "PROPOSAL",
      negotiationSide: "LANDLORD",
      documentDate: new Date("2026-09-20T00:00:00.000Z"),
    });
    assert.equal(needsStoredPageExtraction({
      fileReady: true,
      metadataReady: true,
      analysisReady: false,
      missing: [{ code: "EXTRACTED_PAGES" }],
    }, "UPLOADED"), true);
    const bytes = await documentStorage.get((await prisma.document.findUniqueOrThrow({ where: { id: promoted.documentId } })).storageKey);
    const received = await receiveNegotiationPdf({
      dealId: deal.id,
      bytes,
      filename: "Analyze.pdf",
      mimeType: "application/pdf",
      side: "LANDLORD",
      documentDate: new Date("2026-09-20T00:00:00.000Z"),
      documentType: "PROPOSAL",
      storage: documentStorage,
      prisma,
      mode: "extract",
    });
    assert.equal(received.document.id, promoted.documentId);
    assert.equal(received.document.ingestionStatus, "READY");
    const analyzed = await analyzeNegotiationDocument({
      documentId: promoted.documentId,
      prisma,
      extractTerms: extractor(),
    });
    assert.equal(analyzed.document.ingestionStatus, "COMPLETE");
    assert.equal(await prisma.negotiationRound.count({ where: { documentId: promoted.documentId, sourceType: "UPLOADED_PDF" } }), 1);
    assert.equal(await prisma.negotiationTerm.count({ where: { round: { documentId: promoted.documentId } } }), 1);
    const afterStat = statSync(documentStorage.absolutePath((await prisma.document.findUniqueOrThrow({ where: { id: promoted.documentId } })).storageKey));
    assert.equal(afterStat.ino, sourceStat.ino);

    const control = await receiveNegotiationPdf({
      dealId: deal.id,
      bytes: buildTextPdf(["Tenant proposes a different file."]),
      filename: "Direct.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-21T00:00:00.000Z"),
      documentType: "LOI",
      storage: documentStorage,
      prisma,
      mode: "extract",
    });
    const controlAnalyzed = await analyzeNegotiationDocument({
      documentId: control.document.id,
      prisma,
      extractTerms: extractor(),
    });
    assert.equal(controlAnalyzed.document.ingestionStatus, "COMPLETE");
    assert.equal(await prisma.attachmentDocumentPromotion.count({ where: { documentId: control.document.id } }), 0);
  });

  test("D/E/F/G/H/W rejected promotions do not create documents", async () => {
    assert.equal(rejectPromotionRequest({ dealId: "other-deal" }), "The document stays on the source message deal.");
    assert.equal(rejectPromotionRequest({ workspaceId: "client-workspace" }), "workspaceId is server-controlled");
    assert.equal(rejectPromotionRequest({}), null);

    const deal = await createTestDeal(prisma);
    const other = await createTestDeal(prisma);
    const foreignWorkspace = await prisma.workspace.create({ data: { name: "Foreign firm" } });
    const foreignDeal = await prisma.deal.create({
      data: {
        name: "Foreign deal",
        company: "Other",
        property: "1 Foreign Street",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: foreignWorkspace.id,
      },
    });
    const pdf = buildTextPdf(["Reject me"]);
    const message = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: eml({ id: "reject-promote@example.test", filename: "Reject.pdf", contentType: "application/pdf", bytes: pdf }),
      filename: "reject.eml",
    }, { storage: messageStorage });
    const textMessage = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: eml({ id: "text-promote@example.test", filename: "Notes.txt", contentType: "text/plain", bytes: Buffer.from("not a pdf") }),
      filename: "notes.eml",
    }, { storage: messageStorage });
    const foreign = await ingestEmlMessage(prisma, {
      dealId: foreignDeal.id,
      bytes: eml({ id: "foreign-promote@example.test", filename: "Foreign.pdf", contentType: "application/pdf", bytes: pdf }),
      filename: "foreign.eml",
    }, { storage: messageStorage });
    const otherMessage = await ingestEmlMessage(prisma, {
      dealId: other.id,
      bytes: eml({ id: "other-deal-promote@example.test", filename: "Other.pdf", contentType: "application/pdf", bytes: buildTextPdf(["Other deal"]) }),
      filename: "other.eml",
    }, { storage: messageStorage });

    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: message.id,
        attachmentId: "missing-attachment",
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "NOT_FOUND"
    );
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: foreign.id,
        attachmentId: foreign.attachments[0]!.id,
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "NOT_FOUND"
    );
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: message.id,
        attachmentId: otherMessage.attachments[0]!.id,
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "MISMATCH"
    );
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: textMessage.id,
        attachmentId: textMessage.attachments[0]!.id,
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "UNSUPPORTED_TYPE"
    );

    const broken = message.attachments[0]!;
    await prisma.sourceMessageAttachment.update({ where: { id: broken.id }, data: { storageKey: `${message.id}/attachments/${broken.id}/missing.pdf` } });
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: message.id,
        attachmentId: broken.id,
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "SOURCE_MISSING"
    );
    await prisma.sourceMessageAttachment.update({ where: { id: broken.id }, data: { storageKey: "../outside.pdf" } });
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: message.id,
        attachmentId: broken.id,
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "UNSAFE_STORAGE"
    );
    assert.equal(await prisma.document.count({ where: { dealId: { in: [deal.id, other.id, foreignDeal.id] } } }), 0);
    assert.equal(await prisma.negotiationTerm.count({ where: { round: { dealId: foreignDeal.id } } }), 0);
  });

  test("I integrity failure leaves negotiation and the attachment unchanged", async () => {
    const deal = await createTestDeal(prisma);
    const pdf = buildTextPdf(["Integrity"]);
    const message = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: eml({ id: "integrity-promote@example.test", filename: "Integrity.pdf", contentType: "application/pdf", bytes: pdf }),
      filename: "integrity.eml",
    }, { storage: messageStorage });
    const attachment = message.attachments[0]!;
    const originalSha = attachment.sha256;
    await prisma.sourceMessageAttachment.update({ where: { id: attachment.id }, data: { sha256: "f".repeat(64) } });
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: message.id,
        attachmentId: attachment.id,
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "SOURCE_INTEGRITY"
    );
    assert.equal((await prisma.sourceMessageAttachment.findUniqueOrThrow({ where: { id: attachment.id } })).sha256, "f".repeat(64));
    assert.notEqual(originalSha, "f".repeat(64));
    assert.equal(await prisma.document.count({ where: { dealId: deal.id } }), 0);
    assert.equal(await prisma.activityFact.count({ where: { sourceMessageId: message.id } }), 0);
  });

  test("X 200 Clarendon negotiation is unchanged by promoting another deal", async () => {
    const clarendon = await createTestDeal(prisma);
    await prisma.negotiationRound.create({
      data: {
        dealId: clarendon.id,
        side: "LANDLORD",
        roundNumber: 1,
        documentName: "Revised Counterproposal",
        documentText: "Stored",
        documentDate: new Date("2026-09-18T00:00:00Z"),
        sourceType: "PASTED_TEXT",
        terms: {
          create: {
            canonicalType: "BASE_RENT",
            normalizedValue: "$67.00 / RSF / year",
            normalizedNumeric: 67,
            normalizedUnit: "USD_PER_RSF_YEAR",
            rawValue: "$67.00",
            status: "PROPOSED",
            side: "LANDLORD",
            roundNumber: 1,
            confidence: 1,
            evidenceQuote: "Base rent is $67.00 per RSF.",
          },
        },
      },
    });
    await prisma.dealEvent.create({
      data: {
        dealId: clarendon.id,
        type: "EMAIL",
        description: "Landlord issued legacy counter at $72.50/RSF/year.",
        occurredAt: new Date("2026-09-16T12:00:00Z"),
        confidence: 1,
        evidenceQuote: "Base rent: $72.50/RSF/year",
      },
    });
    const before = await getNegotiationWorkspace(prisma, clarendon.id);
    const other = await createTestDeal(prisma);
    const message = await ingestEmlMessage(prisma, {
      dealId: other.id,
      bytes: eml({ id: "isolated-promote@example.test", filename: "Isolated.pdf", contentType: "application/pdf", bytes: buildTextPdf(["Isolated"]) }),
      filename: "isolated.eml",
    }, { storage: messageStorage });
    await promoteAttachmentToDocument(prisma, {
      messageId: message.id,
      attachmentId: message.attachments[0]!.id,
      expectedWorkspaceId: other.workspaceId,
      messageStorage,
      documentStorage,
    });
    const after = await getNegotiationWorkspace(prisma, clarendon.id);
    const rent = after?.terms.find((term) => term.canonicalType === "BASE_RENT");
    assert.equal(after?.conflictCount, 0);
    assert.equal(rent?.landlordPosition?.kind, "VALUE");
    assert.match(rent?.landlordPosition?.kind === "VALUE" ? rent.landlordPosition.value.summary : "", /67\.00/);
    assert.equal(before?.conflictCount, 0);
    const legacy = await prisma.dealEvent.findFirstOrThrow({ where: { dealId: clarendon.id } });
    assert.match(legacy.description, /72\.50/);
    assert.equal(await prisma.document.count({ where: { dealId: clarendon.id } }), 0);
  });

  test("cleanup", async () => {
    await cleanup();
    rmSync(messageRoot, { recursive: true, force: true });
    rmSync(documentRoot, { recursive: true, force: true });
  });
});
