import type { PrismaClient } from "@prisma/client";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import {
  analyzeNegotiationDocument,
  receiveNegotiationPdf,
} from "@/lib/documents/ingestNegotiationPdf";
import type { DocumentStorage } from "@/lib/documents/storage";
import {
  ACME_RENT_LINE,
  readAcmeLoiPdf,
  readAcmeRentEml,
  rentExtractor,
} from "@/lib/deals/brief/paperCommunicationFixture";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { reviewActionEvidence } from "@/lib/deals/actions/evidenceReview";
import { ingestEmlMessage, ingestSourceMessage } from "@/lib/messages/ingest/service";
import { decideMessageReview, reviewActivityFact } from "@/lib/messages/review";
import { analyzeSourceMessage } from "@/lib/messages/service";
import type { MessageStorage } from "@/lib/messages/storage";
import { reviewFormalTerm } from "@/lib/review/formalTerm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_DEMO_COMPANY,
  CANONICAL_DEMO_DEAL_ID,
  CANONICAL_DEMO_DEAL_NAME,
  CANONICAL_DEMO_PROPERTY,
  CANONICAL_DEMO_SOURCE_PROVIDER,
  DEMO_EARLIER_RENT_LINE,
  DEMO_FULFILLMENT,
  DEMO_LEGACY_DESCRIPTION,
  DEMO_LEGACY_QUOTE,
  DEMO_OPEN_REQUEST,
  DEMO_PROPOSAL_REQUEST,
} from "./identity";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const acmeLoiEml = path.join(repoRoot, "fixtures/messages/acme-loi.eml");

export interface CanonicalDemoBuildInput {
  documentStorage: DocumentStorage;
  messageStorage: MessageStorage;
}

async function installPaper(
  db: PrismaClient,
  input: CanonicalDemoBuildInput & {
    bytes: Buffer;
    filename: string;
    rentLine: string;
    amount: number;
    documentDate: string;
    documentType: "PROPOSAL" | "LOI";
  }
) {
  const received = await receiveNegotiationPdf({
    dealId: CANONICAL_DEMO_DEAL_ID,
    bytes: input.bytes,
    filename: input.filename,
    mimeType: "application/pdf",
    side: "LANDLORD",
    documentDate: new Date(input.documentDate),
    documentType: input.documentType,
    storage: input.documentStorage,
    prisma: db,
    mode: "extract",
  });
  const analyzed = await analyzeNegotiationDocument({
    documentId: received.document.id,
    prisma: db,
    extractTerms: rentExtractor(input.amount, input.rentLine),
  });
  if (analyzed.document.ingestionStatus !== "COMPLETE") {
    throw new Error(`Formal analysis did not complete for ${input.filename}`);
  }
  const term = await db.negotiationTerm.findFirstOrThrow({
    where: { canonicalType: "BASE_RENT", round: { documentId: received.document.id } },
  });
  await reviewFormalTerm(db, {
    documentId: received.document.id,
    negotiationTermId: term.id,
    action: "ACCEPT",
    note: "Canonical demo accepts this paper extraction.",
  });
  return { documentId: received.document.id, termId: term.id };
}

async function reviewedDirective(
  db: PrismaClient,
  workspaceId: string,
  input: {
    externalMessageId: string;
    subject: string;
    body: string;
    sentAt: string;
    senderName: string;
    senderAddress: string;
  }
) {
  const message = await ingestSourceMessage(db, {
    dealId: CANONICAL_DEMO_DEAL_ID,
    sourceType: "FIXTURE",
    sourceProvider: CANONICAL_DEMO_SOURCE_PROVIDER,
    externalMessageId: input.externalMessageId,
    subject: input.subject,
    senderName: input.senderName,
    senderAddress: input.senderAddress,
    sentAt: new Date(input.sentAt),
    bodyText: input.body,
  });
  await analyzeSourceMessage(db, message.id, { speakerSide: "COUNTERPARTY" });
  const fact = await db.activityFact.findFirstOrThrow({
    where: { sourceMessageId: message.id },
    orderBy: { id: "asc" },
  });
  await reviewActionEvidence(db, {
    dealId: CANONICAL_DEMO_DEAL_ID,
    sourceMessageId: message.id,
    activityFactId: fact.id,
    decision: "confirm",
    expectedWorkspaceId: workspaceId,
  });
  await decideMessageReview(db, {
    sourceMessageId: message.id,
    decision: "ACKNOWLEDGED",
    expectedWorkspaceId: workspaceId,
  });
  return { messageId: message.id, factId: fact.id };
}

/**
 * Builds the canonical demo through ingestion, deterministic extraction,
 * and the existing review services. Caller must delete any previous demo deal first.
 */
export async function buildCanonicalDemo(db: PrismaClient, input: CanonicalDemoBuildInput) {
  const workspace = await ensureDefaultWorkspace(db);
  const occupied = await db.deal.findFirst({
    where: { name: CANONICAL_DEMO_DEAL_NAME, NOT: { id: CANONICAL_DEMO_DEAL_ID } },
    select: { id: true },
  });
  if (occupied) {
    throw new Error(
      `Refused: another deal is already named ${CANONICAL_DEMO_DEAL_NAME} (${occupied.id}). Reset will not rename or delete it.`
    );
  }
  const existing = await db.deal.findUnique({ where: { id: CANONICAL_DEMO_DEAL_ID }, select: { id: true } });
  if (existing) {
    throw new Error("Canonical demo deal already exists. Reset must remove it before building.");
  }

  await db.deal.create({
    data: {
      id: CANONICAL_DEMO_DEAL_ID,
      name: CANONICAL_DEMO_DEAL_NAME,
      company: CANONICAL_DEMO_COMPANY,
      property: CANONICAL_DEMO_PROPERTY,
      stage: "LOI",
      status: "ACTIVE",
      workspaceId: workspace.id,
    },
  });

  await db.dealEvent.create({
    data: {
      dealId: CANONICAL_DEMO_DEAL_ID,
      type: "EMAIL",
      description: DEMO_LEGACY_DESCRIPTION,
      occurredAt: new Date("2026-09-01T15:00:00.000Z"),
      confidence: 1,
      evidenceQuote: DEMO_LEGACY_QUOTE,
    },
  });

  const earlier = await installPaper(db, {
    ...input,
    bytes: buildTextPdf([["Acme Acquisition", "Earlier proposal", DEMO_EARLIER_RENT_LINE].join("\n")]),
    filename: "acme-earlier-proposal.pdf",
    rentLine: DEMO_EARLIER_RENT_LINE,
    amount: 72,
    documentDate: "2026-09-08T00:00:00.000Z",
    documentType: "PROPOSAL",
  });
  const current = await installPaper(db, {
    ...input,
    bytes: readAcmeLoiPdf(),
    filename: "acme-acquisition-loi.pdf",
    rentLine: ACME_RENT_LINE,
    amount: 67,
    documentDate: "2026-09-20T00:00:00.000Z",
    documentType: "LOI",
  });

  const rentMessage = await ingestEmlMessage(db, {
    dealId: CANONICAL_DEMO_DEAL_ID,
    bytes: readAcmeRentEml(),
    filename: "acme-revised-rent.eml",
    mimeType: "message/rfc822",
    sourceProvider: CANONICAL_DEMO_SOURCE_PROVIDER,
    externalMessageId: "acme-revised-rent",
  }, { storage: input.messageStorage });
  await analyzeSourceMessage(db, rentMessage.id);
  const rentFact = await db.activityFact.findFirstOrThrow({
    where: { sourceMessageId: rentMessage.id, factType: "NEGOTIATION_VALUE", canonicalType: "BASE_RENT" },
  });
  await reviewActivityFact(db, {
    sourceMessageId: rentMessage.id,
    activityFactId: rentFact.id,
    state: "CONFIRMED",
    commercialReview: true,
    expectedWorkspaceId: workspace.id,
  });
  await decideMessageReview(db, {
    sourceMessageId: rentMessage.id,
    decision: "ACKNOWLEDGED",
    expectedWorkspaceId: workspace.id,
  });

  const proposal = await reviewedDirective(db, workspace.id, {
    externalMessageId: "directive-revised-proposal",
    subject: "Revised proposal",
    body: DEMO_PROPOSAL_REQUEST,
    sentAt: "2026-09-23T15:00:00.000Z",
    senderName: "Derek Hollis",
    senderAddress: "derek.hollis@harborrealty.example",
  });
  const insurance = await reviewedDirective(db, workspace.id, {
    externalMessageId: "directive-insurance-certificate",
    subject: "Insurance certificate",
    body: DEMO_OPEN_REQUEST,
    sentAt: "2026-09-24T15:00:00.000Z",
    senderName: "John Doe",
    senderAddress: "john.doe@harborrealty.example",
  });

  const fulfillment = await ingestSourceMessage(db, {
    dealId: CANONICAL_DEMO_DEAL_ID,
    sourceType: "FIXTURE",
    sourceProvider: CANONICAL_DEMO_SOURCE_PROVIDER,
    externalMessageId: "fulfillment-revised-proposal",
    subject: "Revised proposal attached",
    senderName: "Alex Chen",
    senderAddress: "alex.chen@acme.example",
    sentAt: new Date("2026-09-25T15:00:00.000Z"),
    bodyText: DEMO_FULFILLMENT,
  });
  await analyzeSourceMessage(db, fulfillment.id, { speakerSide: "OUR_SIDE" });
  const fulfillmentFact = await db.activityFact.findFirstOrThrow({
    where: { sourceMessageId: fulfillment.id },
    orderBy: { id: "asc" },
  });
  await reviewActionEvidence(db, {
    dealId: CANONICAL_DEMO_DEAL_ID,
    sourceMessageId: fulfillment.id,
    activityFactId: fulfillmentFact.id,
    decision: "confirm",
    expectedWorkspaceId: workspace.id,
  });
  await decideMessageReview(db, {
    sourceMessageId: fulfillment.id,
    decision: "ACKNOWLEDGED",
    expectedWorkspaceId: workspace.id,
  });

  await ingestEmlMessage(db, {
    dealId: CANONICAL_DEMO_DEAL_ID,
    bytes: readFileSync(acmeLoiEml),
    filename: "acme-loi.eml",
    mimeType: "message/rfc822",
    sourceProvider: CANONICAL_DEMO_SOURCE_PROVIDER,
    externalMessageId: "acme-loi-eml",
  }, { storage: input.messageStorage });

  return {
    workspaceId: workspace.id,
    dealId: CANONICAL_DEMO_DEAL_ID,
    earlierDocumentId: earlier.documentId,
    currentDocumentId: current.documentId,
    currentTermId: current.termId,
    rentMessageId: rentMessage.id,
    rentFactId: rentFact.id,
    proposalFactId: proposal.factId,
    insuranceFactId: insurance.factId,
    fulfillmentFactId: fulfillmentFact.id,
  };
}
