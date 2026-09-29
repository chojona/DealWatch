import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { ExtractTermsOutput } from "@/lib/ai/negotiation/schemas";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import {
  analyzeNegotiationDocument,
  receiveNegotiationPdf,
  type NegotiationTermExtractor,
} from "@/lib/documents/ingestNegotiationPdf";
import type { DocumentStorage } from "@/lib/documents/storage";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { ingestEmlMessage, ingestSourceMessage } from "@/lib/messages/ingest/service";
import { analyzeSourceMessage } from "@/lib/messages/service";
import type { MessageStorage } from "@/lib/messages/storage";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const ACME_DEAL_NAME = "Acme Acquisition";
export const ACME_MISREAD_DEAL_NAME = "Acme Acquisition — misread rent";
export const ACME_RENT_LINE = "Base Rent: $67.00 per rentable square foot per year";
export const ACME_COMMUNICATION_SUBJECT = "Revised rent";
export const ACME_COMMUNICATION_BODY = "The landlord can do $72.00 per RSF per year.";
export const ACME_LOI_PDF_PATH = path.join(repoRoot, "fixtures/documents/acme-acquisition-loi.pdf");
export const ACME_RENT_EML_PATH = path.join(repoRoot, "fixtures/messages/acme-revised-rent.eml");

/**
 * Communication may be compared with formal paper only when the existing
 * brief comparator says so:
 * fact type NEGOTIATION_VALUE, a canonical type, side TENANT or LANDLORD,
 * and a fact review of CONFIRMED or INCORRECT-with-correction.
 * Unreviewed facts, superseded facts, and incorrect facts without a
 * correction stay NOT_COMPARABLE. A message acknowledgement does not
 * review the fact. Units must match the effective formal scalar.
 */
export function acmeLoiPdf(): Buffer {
  return buildTextPdf([["Acme Acquisition", "Letter of Intent", ACME_RENT_LINE].join("\n")]);
}

export function readAcmeLoiPdf(): Buffer {
  return readFileSync(ACME_LOI_PDF_PATH);
}

export function readAcmeRentEml(): Buffer {
  return readFileSync(ACME_RENT_EML_PATH);
}

export function rentExtractor(amount: number, line: string): NegotiationTermExtractor {
  return async (input) => {
    const terms: ExtractTermsOutput["terms"] = input.documentText.includes(line)
      ? [{
          canonicalType: "BASE_RENT",
          normalizedValue: `$${amount.toFixed(2)}/RSF/year`,
          normalizedNumeric: amount,
          normalizedUnit: "USD_PER_RSF_YEAR",
          rawValue: line,
          status: "PROPOSED",
          confidence: 1,
          evidenceQuote: line,
          sourceLocation: "Letter of Intent",
          structuredPayload: {
            termType: "BASE_RENT",
            rent: { kind: "simple", amountPerRSFYear: amount },
          },
        }]
      : [];
    return {
      terms,
      metadata: {
        model: "paper-communication-fixture",
        extractedAt: "2026-09-15T00:00:00.000Z",
        latencyMs: 1,
        extractionConfidence: 1,
        validationFailures: 0,
      },
    };
  };
}

export function misreadRentCompletion(): string {
  return JSON.stringify({
    facts: [{
      factType: "NEGOTIATION_VALUE",
      canonicalType: "BASE_RENT",
      side: "LANDLORD",
      assertionStatus: "PROPOSED",
      evidenceQuote: ACME_COMMUNICATION_BODY,
      display: "$27.00 / RSF / year",
      numeric: 27,
      unit: "USD_PER_RSF_YEAR",
      negotiation: {
        termType: "BASE_RENT",
        rent: { kind: "simple", amountPerRSFYear: 27 },
      },
    }],
  });
}

export function totalRentCompletion(): string {
  return JSON.stringify({
    facts: [{
      factType: "NEGOTIATION_VALUE",
      canonicalType: "BASE_RENT",
      side: "LANDLORD",
      assertionStatus: "PROPOSED",
      evidenceQuote: "The landlord proposed $67 total monthly rent.",
      display: "$67.00 total",
      numeric: 67,
      unit: "USD",
      negotiation: null,
    }],
  });
}

export interface PaperRentDeal {
  dealId: string;
  workspaceId: string;
  documentId: string;
  termId: string;
  messageId: string | null;
  factId: string | null;
}

async function workspaceIdFor(db: PrismaClient, workspaceId?: string): Promise<string> {
  if (workspaceId) return workspaceId;
  return (await ensureDefaultWorkspace(db)).id;
}

export async function installFormalRentDocument(
  db: PrismaClient,
  input: {
    name: string;
    workspaceId?: string;
    storage: DocumentStorage;
    pdf: Buffer;
    filename: string;
    rentLine: string;
    amount: number;
  }
): Promise<Omit<PaperRentDeal, "messageId" | "factId"> & { messageId: null; factId: null }> {
  const workspaceId = await workspaceIdFor(db, input.workspaceId);
  const deal = await db.deal.create({
    data: {
      name: input.name,
      company: "Acme",
      property: "1 Acme Plaza",
      stage: "LOI",
      status: "ACTIVE",
      workspaceId,
    },
  });
  const received = await receiveNegotiationPdf({
    dealId: deal.id,
    bytes: input.pdf,
    filename: input.filename,
    mimeType: "application/pdf",
    side: "LANDLORD",
    documentDate: new Date("2026-09-15T00:00:00.000Z"),
    documentType: "LOI",
    storage: input.storage,
    prisma: db,
    mode: "extract",
  });
  const analyzed = await analyzeNegotiationDocument({
    documentId: received.document.id,
    prisma: db,
    extractTerms: rentExtractor(input.amount, input.rentLine),
  });
  if (analyzed.document.ingestionStatus !== "COMPLETE") {
    throw new Error(`Formal analysis did not complete for ${input.name}`);
  }
  const term = await db.negotiationTerm.findFirstOrThrow({
    where: { canonicalType: "BASE_RENT", round: { documentId: received.document.id } },
  });
  return {
    dealId: deal.id,
    workspaceId,
    documentId: received.document.id,
    termId: term.id,
    messageId: null,
    factId: null,
  };
}

async function rememberFact(db: PrismaClient, messageId: string): Promise<string> {
  const fact = await db.activityFact.findFirstOrThrow({
    where: { sourceMessageId: messageId, factType: "NEGOTIATION_VALUE" },
    orderBy: { id: "asc" },
  });
  return fact.id;
}

export async function installCheckedInAcmeDeal(
  db: PrismaClient,
  input: { storage: DocumentStorage; messageStorage: MessageStorage; workspaceId?: string }
): Promise<PaperRentDeal> {
  const formal = await installFormalRentDocument(db, {
    name: ACME_DEAL_NAME,
    workspaceId: input.workspaceId,
    storage: input.storage,
    pdf: readAcmeLoiPdf(),
    filename: "acme-acquisition-loi.pdf",
    rentLine: ACME_RENT_LINE,
    amount: 67,
  });
  const message = await ingestEmlMessage(db, {
    dealId: formal.dealId,
    bytes: readAcmeRentEml(),
    filename: "acme-revised-rent.eml",
    mimeType: "message/rfc822",
    sourceProvider: "paper-communication-fixture",
    externalMessageId: "acme-revised-rent",
  }, { storage: input.messageStorage });
  await analyzeSourceMessage(db, message.id);
  return { ...formal, messageId: message.id, factId: await rememberFact(db, message.id) };
}

export async function installMisreadRentDeal(
  db: PrismaClient,
  input: { storage: DocumentStorage; workspaceId?: string }
): Promise<PaperRentDeal> {
  const formal = await installFormalRentDocument(db, {
    name: ACME_MISREAD_DEAL_NAME,
    workspaceId: input.workspaceId,
    storage: input.storage,
    pdf: readAcmeLoiPdf(),
    filename: "acme-acquisition-loi.pdf",
    rentLine: ACME_RENT_LINE,
    amount: 67,
  });
  const message = await ingestSourceMessage(db, {
    dealId: formal.dealId,
    sourceType: "FIXTURE",
    sourceProvider: "paper-communication-fixture",
    externalMessageId: `misread-${formal.dealId}`,
    subject: ACME_COMMUNICATION_SUBJECT,
    senderName: "Derek Hollis",
    senderAddress: "derek.hollis@harborrealty.example",
    sentAt: new Date("2026-09-22T15:00:00.000Z"),
    bodyText: ACME_COMMUNICATION_BODY,
  });
  await analyzeSourceMessage(db, message.id, { complete: async () => misreadRentCompletion() });
  return { ...formal, messageId: message.id, factId: await rememberFact(db, message.id) };
}

export async function installBrowserPaperCommunicationDeals(
  db: PrismaClient,
  input: { storage: DocumentStorage; messageStorage: MessageStorage }
): Promise<{ differs: PaperRentDeal; misread: PaperRentDeal }> {
  const workspaceId = (await ensureDefaultWorkspace(db)).id;
  const existingDiffers = await db.deal.findFirst({
    where: { workspaceId, name: ACME_DEAL_NAME },
    select: { id: true },
  });
  const existingMisread = await db.deal.findFirst({
    where: { workspaceId, name: ACME_MISREAD_DEAL_NAME },
    select: { id: true },
  });
  if (existingDiffers || existingMisread) {
    throw new Error("Acme paper-vs-communication deals already exist. Remove them before reseeding.");
  }
  const differs = await installCheckedInAcmeDeal(db, { ...input, workspaceId });
  const misread = await installMisreadRentDeal(db, { storage: input.storage, workspaceId });
  return { differs, misread };
}
