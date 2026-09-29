import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { ExtractTermsOutput } from "@/lib/ai/negotiation/schemas";
import { getDealBrief } from "@/lib/deals/brief/service";
import { extractPdfDocument } from "@/lib/documents/extractPdf";
import {
  analyzeNegotiationDocument,
  receiveNegotiationPdf,
  type NegotiationTermExtractor,
} from "@/lib/documents/ingestNegotiationPdf";
import { DocumentMetadataError, updateDocumentMetadata } from "@/lib/documents/metadata";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { deriveReadiness } from "@/lib/documents/readiness";
import { needsStoredPageExtraction } from "@/lib/documents/readinessCopy";
import { inspectSourceFile } from "@/lib/documents/sourceFile";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase } from "@/lib/documents/testDb";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { getDocumentReview } from "@/lib/inbox/service";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import { reviewFormalTerm } from "@/lib/review/formalTerm";
import { parseEml } from "./ingest/eml";
import { ingestEmlMessage } from "./ingest/service";
import { isPromotablePdfAttachment } from "./promotionEligibility";
import { AttachmentPromotionError, promoteAttachmentToDocument } from "./promoteAttachment";
import { getMessageSource } from "./service";
import { LocalMessageStorage } from "./storage";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/messages/acme-loi.eml"
);
const rentLine = "Base Rent: $45.00 per rentable square foot per year";

function rentExtractor(): NegotiationTermExtractor {
  return async (input) => {
    const terms: ExtractTermsOutput["terms"] = input.documentText.includes(rentLine)
      ? [{
          canonicalType: "BASE_RENT",
          normalizedValue: "$45.00/RSF/year",
          normalizedNumeric: 45,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: rentLine,
          status: "PROPOSED",
          confidence: 1,
          evidenceQuote: rentLine,
          sourceLocation: "Letter of Intent",
          structuredPayload: {
            termType: "BASE_RENT",
            rent: { kind: "simple", amountPerRSFYear: 45 },
          },
        }]
      : [];
    return {
      terms,
      metadata: {
        model: "fixture",
        extractedAt: "2026-09-15T00:00:00.000Z",
        latencyMs: 1,
        extractionConfidence: 1,
        validationFailures: 0,
      },
    };
  };
}

function landlordSummary(workspace: Awaited<ReturnType<typeof getNegotiationWorkspace>>): string | null {
  const position = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition;
  return position?.kind === "VALUE" ? position.value.summary : null;
}

function briefSummary(brief: Awaited<ReturnType<typeof getDealBrief>>): string | null {
  const position = brief?.negotiation.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition;
  return position?.kind === "VALUE" ? position.value.summary : null;
}

describe("checked-in Acme LOI attachment promotion", { concurrency: 1 }, () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  const messageRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-acme-msg-"));
  const documentRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-acme-doc-"));
  const messageStorage = new LocalMessageStorage(messageRoot);
  const documentStorage = new LocalDocumentStorage(documentRoot);

  test("setup", async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test("fixture import, promotion, formal review, and direct-upload parity", async () => {
    const fixtureBytes = readFileSync(fixturePath);
    assert.equal(fixtureBytes.includes(Buffer.from("acme-loi.pdf")), true);
    assert.equal(fixtureBytes.includes(Buffer.from("%PDF-")), false);
    const parsed = parseEml(fixtureBytes);
    assert.equal(parsed.subject, "Acme LOI");
    assert.equal(parsed.from?.address, "broker@example.test");
    assert.equal(parsed.bodyText, "Attached is the latest Acme LOI.");
    assert.equal(parsed.attachments.length, 1);
    const parsedPdf = parsed.attachments[0]!;
    assert.equal(parsedPdf.filename, "acme-loi.pdf");
    assert.equal(parsedPdf.contentType, "application/pdf");
    assert.equal(parsedPdf.bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    const extractedFixture = await extractPdfDocument(parsedPdf.bytes);
    assert.equal(extractedFixture.pages[0]?.text.includes(rentLine), true);

    const workspace = await ensureDefaultWorkspace(prisma);
    const deal = await prisma.deal.create({
      data: {
        name: "Acme Acquisition",
        company: "Acme",
        property: "1 Acme Plaza",
        stage: "LOI",
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });
    const message = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: fixtureBytes,
      filename: "acme-loi.eml",
      mimeType: "message/rfc822",
    }, { storage: messageStorage });
    assert.equal(message.subject, "Acme LOI");
    assert.equal(message.senderAddress, "broker@example.test");
    assert.equal(message.bodyText, "Attached is the latest Acme LOI.");
    assert.equal(message.dealId, deal.id);
    assert.equal(message.workspaceId, workspace.id);
    assert.equal(await prisma.activityExtractionRun.count({ where: { sourceMessageId: message.id } }), 0);
    const attachment = message.attachments[0]!;
    assert.equal(attachment.filename, "acme-loi.pdf");
    assert.equal(attachment.contentType, "application/pdf");
    assert.equal(attachment.sha256, parsedPdf.sha256);
    const storedAttachment = await messageStorage.get(attachment.storageKey!);
    assert.equal(storedAttachment.equals(parsedPdf.bytes), true);

    const promoted = await promoteAttachmentToDocument(prisma, {
      messageId: message.id,
      attachmentId: attachment.id,
      expectedWorkspaceId: workspace.id,
      messageStorage,
      documentStorage,
    });
    assert.equal(promoted.created, true);
    assert.equal(promoted.dealId, deal.id);
    assert.equal(promoted.ingestionStatus, "UPLOADED");
    const again = await promoteAttachmentToDocument(prisma, {
      messageId: message.id,
      attachmentId: attachment.id,
      expectedWorkspaceId: workspace.id,
      messageStorage,
      documentStorage,
    });
    assert.equal(again.created, false);
    assert.equal(again.documentId, promoted.documentId);
    assert.equal(await prisma.document.count({ where: { dealId: deal.id } }), 1);

    const document = await prisma.document.findUniqueOrThrow({ where: { id: promoted.documentId } });
    assert.equal(document.dealId, deal.id);
    assert.equal(document.originalFilename, "acme-loi.pdf");
    assert.equal(document.mimeType, "application/pdf");
    assert.equal(document.ingestionStatus, "UPLOADED");
    assert.equal(document.negotiationSide, null);
    assert.equal(document.documentDate, null);
    assert.equal(document.sha256, attachment.sha256);
    const storedDocument = await documentStorage.get(document.storageKey);
    assert.equal(storedDocument.equals(parsedPdf.bytes), true);
    const link = await prisma.attachmentDocumentPromotion.findUniqueOrThrow({
      where: { sourceMessageAttachmentId: attachment.id },
    });
    assert.equal(link.workspaceId, workspace.id);
    assert.equal(link.dealId, deal.id);
    assert.equal(link.sourceMessageId, message.id);
    assert.equal(link.documentId, document.id);

    const viewed = await getMessageSource(prisma, message.id, { expectedWorkspaceId: workspace.id });
    assert.equal(viewed?.attachments[0]?.analysisState, "PROMOTED");
    assert.equal(viewed?.attachments[0]?.promotion?.href, `/documents/${document.id}/review`);
    const reviewBefore = await getDocumentReview(prisma, workspace.id, document.id);
    assert.equal(reviewBefore?.promotionSources.length, 1);
    assert.equal(reviewBefore?.promotionSources[0]?.messageSubject, "Acme LOI");
    assert.equal(reviewBefore?.promotionSources[0]?.messageHref, `/messages/${message.id}`);
    assert.equal(reviewBefore?.promotionSources[0]?.attachmentFilename, "acme-loi.pdf");
    assert.equal(await getDocumentReview(prisma, "someone-else", document.id), null);

    const beforeMetadata = deriveReadiness({
      mimeType: document.mimeType,
      sourceFileState: await inspectSourceFile(documentStorage, document.storageKey),
      hasUsableText: false,
      negotiationSide: document.negotiationSide,
      documentDate: document.documentDate,
      dealId: document.dealId,
      ingestionStatus: document.ingestionStatus,
      failureCode: document.failureCode,
    });
    assert.equal(beforeMetadata.metadataReady, false);
    assert.equal(beforeMetadata.analysisReady, false);
    assert.equal(needsStoredPageExtraction(beforeMetadata, "UPLOADED"), false);
    await assert.rejects(
      () => updateDocumentMetadata(prisma, document.id, { documentDate: new Date("not-a-date") }),
      (error: unknown) => error instanceof DocumentMetadataError && error.code === "INVALID"
    );
    await updateDocumentMetadata(prisma, document.id, {
      documentType: "LOI",
      negotiationSide: "LANDLORD",
      documentDate: new Date("2026-09-15T00:00:00.000Z"),
    });
    const prepared = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    assert.equal(prepared.ingestionStatus, "UPLOADED");
    assert.equal(prepared.documentType, "LOI");
    assert.equal(prepared.negotiationSide, "LANDLORD");
    const afterMetadata = deriveReadiness({
      mimeType: prepared.mimeType,
      sourceFileState: await inspectSourceFile(documentStorage, prepared.storageKey),
      hasUsableText: false,
      negotiationSide: prepared.negotiationSide,
      documentDate: prepared.documentDate,
      dealId: prepared.dealId,
      ingestionStatus: prepared.ingestionStatus,
      failureCode: prepared.failureCode,
    });
    assert.equal(afterMetadata.metadataReady, true);
    assert.equal(needsStoredPageExtraction(afterMetadata, "UPLOADED"), true);

    const received = await receiveNegotiationPdf({
      dealId: deal.id,
      bytes: await documentStorage.get(prepared.storageKey),
      filename: prepared.originalFilename,
      mimeType: prepared.mimeType,
      side: "LANDLORD",
      documentDate: prepared.documentDate!,
      documentType: prepared.documentType,
      storage: documentStorage,
      prisma,
      mode: "extract",
    });
    assert.equal(received.document.id, document.id);
    assert.equal(received.document.ingestionStatus, "READY");
    const page = await prisma.documentPage.findFirstOrThrow({ where: { documentId: document.id } });
    assert.equal(page.text.includes(rentLine), true);

    const analyzed = await analyzeNegotiationDocument({
      documentId: document.id,
      prisma,
      extractTerms: rentExtractor(),
    });
    assert.equal(analyzed.document.ingestionStatus, "COMPLETE");
    const term = await prisma.negotiationTerm.findFirstOrThrow({
      where: { round: { documentId: document.id } },
      include: { round: true },
    });
    assert.equal(term.canonicalType, "BASE_RENT");
    assert.equal(term.normalizedNumeric, 45);
    assert.equal(term.evidenceQuote, rentLine);
    assert.equal(term.provenanceStatus, "EXACT");
    assert.equal(term.round.sourceType, "UPLOADED_PDF");
    assert.equal(term.round.documentId, document.id);
    assert.equal(await prisma.activityFact.count({ where: { sourceMessageId: message.id } }), 0);
    assert.equal((await getMessageSource(prisma, message.id, { expectedWorkspaceId: workspace.id }))?.analysisState, "NOT_ANALYZED");

    const unreviewed = await getNegotiationWorkspace(prisma, deal.id);
    assert.equal(landlordSummary(unreviewed), "$45.00 / RSF / yr");
    const unreviewedBrief = await getDealBrief(prisma, deal.id, { expectedWorkspaceId: workspace.id });
    assert.equal(briefSummary(unreviewedBrief), "$45.00 / RSF / yr");

    await reviewFormalTerm(prisma, {
      documentId: document.id,
      negotiationTermId: term.id,
      action: "ACCEPT",
      note: "Matches the LOI",
    });
    const acceptedRaw = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: term.id } });
    assert.equal(acceptedRaw.normalizedNumeric, 45);
    assert.equal(acceptedRaw.evidenceQuote, rentLine);
    assert.equal(landlordSummary(await getNegotiationWorkspace(prisma, deal.id)), "$45.00 / RSF / yr");
    assert.equal(briefSummary(await getDealBrief(prisma, deal.id, { expectedWorkspaceId: workspace.id })), "$45.00 / RSF / yr");
    assert.equal(await prisma.activityFactReview.count({ where: { activityFact: { sourceMessageId: message.id } } }), 0);

    await reviewFormalTerm(prisma, {
      documentId: document.id,
      negotiationTermId: term.id,
      action: "CORRECT",
      amountPerRSFYear: 50,
      rawValue: "Base Rent: $50.00 per rentable square foot per year",
      note: "Corrected from the paper",
    });
    const correctedRaw = await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: term.id } });
    assert.equal(correctedRaw.normalizedNumeric, 45);
    assert.equal(correctedRaw.evidenceQuote, rentLine);
    assert.equal(landlordSummary(await getNegotiationWorkspace(prisma, deal.id)), "$50.00 / RSF / yr");
    assert.equal(briefSummary(await getDealBrief(prisma, deal.id, { expectedWorkspaceId: workspace.id })), "$50.00 / RSF / yr");
    const correctedView = (await getNegotiationWorkspace(prisma, deal.id))?.terms.find((item) => item.canonicalType === "BASE_RENT");
    assert.equal(correctedView?.history[0]?.formalReview?.state, "CORRECTED");
    assert.equal(correctedView?.history[0]?.formalReview?.extractedSummary, "$45.00 / RSF / yr");

    await reviewFormalTerm(prisma, {
      documentId: document.id,
      negotiationTermId: term.id,
      action: "REJECT",
      note: "Not the operative term",
    });
    assert.equal((await prisma.negotiationTerm.findUniqueOrThrow({ where: { id: term.id } })).normalizedNumeric, 45);
    assert.equal(landlordSummary(await getNegotiationWorkspace(prisma, deal.id)), null);
    assert.equal(briefSummary(await getDealBrief(prisma, deal.id, { expectedWorkspaceId: workspace.id })), null);
    assert.equal(await prisma.activityFact.count({ where: { sourceMessageId: message.id } }), 0);

    const directDeal = await prisma.deal.create({
      data: {
        name: "Acme Acquisition Direct",
        company: "Acme",
        property: "1 Acme Plaza",
        stage: "LOI",
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });
    const direct = await receiveNegotiationPdf({
      dealId: directDeal.id,
      bytes: parsedPdf.bytes,
      filename: "acme-loi.pdf",
      mimeType: "application/pdf",
      side: "LANDLORD",
      documentDate: new Date("2026-09-15T00:00:00.000Z"),
      documentType: "LOI",
      storage: documentStorage,
      prisma,
      mode: "extract",
    });
    const directAnalyzed = await analyzeNegotiationDocument({
      documentId: direct.document.id,
      prisma,
      extractTerms: rentExtractor(),
    });
    assert.equal(directAnalyzed.document.ingestionStatus, "COMPLETE");
    const directTerm = await prisma.negotiationTerm.findFirstOrThrow({
      where: { round: { documentId: direct.document.id } },
    });
    assert.equal(directTerm.canonicalType, term.canonicalType);
    assert.equal(directTerm.normalizedNumeric, 45);
    assert.equal(directTerm.evidenceQuote, rentLine);
    assert.equal(directTerm.provenanceStatus, "EXACT");
    assert.equal(landlordSummary(await getNegotiationWorkspace(prisma, directDeal.id)), "$45.00 / RSF / yr");
    assert.equal(briefSummary(await getDealBrief(prisma, directDeal.id, { expectedWorkspaceId: workspace.id })), "$45.00 / RSF / yr");
    assert.equal(await prisma.attachmentDocumentPromotion.count({ where: { documentId: direct.document.id } }), 0);
    const directReview = await getDocumentReview(prisma, workspace.id, direct.document.id);
    assert.equal(directReview?.promotionSources.length, 0);
    assert.equal(await prisma.attachmentDocumentPromotion.count({ where: { documentId: document.id } }), 1);
  });

  test("another workspace cannot promote the Acme attachment", async () => {
    const foreign = await prisma.workspace.create({ data: { name: "Other firm" } });
    const foreignDeal = await prisma.deal.create({
      data: {
        name: "Other Acquisition",
        company: "Other",
        property: "9 Other Street",
        stage: "LOI",
        status: "ACTIVE",
        workspaceId: foreign.id,
      },
    });
    const home = await prisma.deal.findFirstOrThrow({ where: { name: "Acme Acquisition" } });
    const attachment = await prisma.sourceMessageAttachment.findFirstOrThrow({
      where: { sourceMessage: { dealId: home.id, subject: "Acme LOI" } },
    });
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: attachment.sourceMessageId,
        attachmentId: attachment.id,
        expectedWorkspaceId: foreign.id,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "NOT_FOUND"
    );
    assert.equal(await prisma.document.count({ where: { dealId: foreignDeal.id } }), 0);
  });

  test("non-PDF and empty-text attachments stay out of the formal workflow", async () => {
    const deal = await prisma.deal.findFirstOrThrow({ where: { name: "Acme Acquisition" } });
    const docx = Buffer.from([
      "From: Broker <broker@example.test>",
      "Message-ID: <acme-docx@example.test>",
      "Subject: Acme spreadsheet",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="docx"',
      "",
      "--docx",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See the spreadsheet.",
      "--docx",
      'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="acme.docx"',
      'Content-Disposition: attachment; filename="acme.docx"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("not a pdf").toString("base64"),
      "--docx--",
      "",
    ].join("\r\n"));
    const imported = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: docx,
      filename: "acme-docx.eml",
    }, { storage: messageStorage });
    const attachment = imported.attachments[0]!;
    assert.equal(isPromotablePdfAttachment(attachment), false);
    await assert.rejects(
      () => promoteAttachmentToDocument(prisma, {
        messageId: imported.id,
        attachmentId: attachment.id,
        expectedWorkspaceId: deal.workspaceId,
        messageStorage,
        documentStorage,
      }),
      (error: unknown) => error instanceof AttachmentPromotionError && error.code === "UNSUPPORTED_TYPE"
    );

    const blank = buildTextPdf(["   "]);
    const blankMessage = await ingestEmlMessage(prisma, {
      dealId: deal.id,
      bytes: Buffer.from([
        "From: Broker <broker@example.test>",
        "Message-ID: <acme-scan@example.test>",
        "Subject: Scanned LOI",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="scan"',
        "",
        "--scan",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Scan attached.",
        "--scan",
        'Content-Type: application/pdf; name="scan.pdf"',
        'Content-Disposition: attachment; filename="scan.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        blank.toString("base64"),
        "--scan--",
        "",
      ].join("\r\n")),
      filename: "scan.eml",
    }, { storage: messageStorage });
    const promotedBlank = await promoteAttachmentToDocument(prisma, {
      messageId: blankMessage.id,
      attachmentId: blankMessage.attachments[0]!.id,
      expectedWorkspaceId: deal.workspaceId,
      messageStorage,
      documentStorage,
    });
    await updateDocumentMetadata(prisma, promotedBlank.documentId, {
      documentType: "LOI",
      negotiationSide: "LANDLORD",
      documentDate: new Date("2026-09-15T00:00:00.000Z"),
    });
    const stored = await prisma.document.findUniqueOrThrow({ where: { id: promotedBlank.documentId } });
    const extracted = await receiveNegotiationPdf({
      dealId: deal.id,
      bytes: await documentStorage.get(stored.storageKey),
      filename: stored.originalFilename,
      mimeType: stored.mimeType,
      side: "LANDLORD",
      documentDate: stored.documentDate!,
      documentType: stored.documentType,
      storage: documentStorage,
      prisma,
      mode: "extract",
    });
    assert.equal(extracted.document.ingestionStatus, "FAILED");
    assert.equal(extracted.document.failureCode, "SCANNED_OR_EMPTY");
    const analyzed = await analyzeNegotiationDocument({
      documentId: promotedBlank.documentId,
      prisma,
      extractTerms: rentExtractor(),
    });
    assert.equal(analyzed.document.failureCode, "SCANNED_OR_EMPTY");
    assert.equal(await prisma.negotiationTerm.count({ where: { round: { documentId: promotedBlank.documentId } } }), 0);
  });

  test("cleanup", async () => {
    await cleanup();
    rmSync(messageRoot, { recursive: true, force: true });
    rmSync(documentRoot, { recursive: true, force: true });
  });
});

test("promotion is offered only for PDF attachments", () => {
  assert.equal(isPromotablePdfAttachment({ filename: "acme-loi.pdf", contentType: "application/pdf" }), true);
  assert.equal(isPromotablePdfAttachment({ filename: "acme-loi.pdf", contentType: "application/octet-stream" }), true);
  assert.equal(isPromotablePdfAttachment({ filename: "acme.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), false);
  assert.equal(isPromotablePdfAttachment({ filename: "acme.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), false);
  assert.equal(isPromotablePdfAttachment({ filename: "acme.xls", contentType: "application/vnd.ms-excel" }), false);
  assert.equal(isPromotablePdfAttachment({ filename: "acme.doc", contentType: "application/msword" }), false);
  assert.equal(isPromotablePdfAttachment({ filename: "photo.png", contentType: "image/png" }), false);
  assert.equal(isPromotablePdfAttachment({ filename: "mislabeled.pdf", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), false);
  assert.equal(isPromotablePdfAttachment({ filename: "notes.txt", contentType: "text/plain" }), false);
  assert.throws(() => parseEml(Buffer.from("not an email")), /malformed|missing/i);
});
