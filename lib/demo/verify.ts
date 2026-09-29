import type { PrismaClient } from "@prisma/client";
import { getActivityPage } from "@/lib/activity/service";
import { getDealBrief } from "@/lib/deals/brief/service";
import { ACME_COMMUNICATION_BODY, ACME_RENT_LINE } from "@/lib/deals/brief/paperCommunicationFixture";
import { getDealActionState } from "@/lib/deals/actions/service";
import { comparisonOutcomeLabel } from "@/lib/deals/brief/presentation";
import { isPromotablePdfAttachment } from "@/lib/messages/promotionEligibility";
import { getNegotiationWorkspace } from "@/lib/negotiation/intelligence/service";
import {
  CANONICAL_DEMO_DEAL_ID,
  CANONICAL_DEMO_DEAL_NAME,
  DEMO_EARLIER_RENT_LINE,
  DEMO_FULFILLMENT,
  DEMO_LEGACY_QUOTE,
  DEMO_OPEN_REQUEST,
  DEMO_PROPOSAL_REQUEST,
  DEMO_VERIFY_NOW,
} from "./identity";

export interface CanonicalDemoFingerprint {
  dealId: string;
  dealName: string;
  formalRent: string | null;
  earlierFormalRent: string | null;
  legacyQuote: string | null;
  communicationValue: string | null;
  reconciliation: string | null;
  proposalStatus: string | null;
  proposalFulfillment: string | null;
  insuranceStatus: string | null;
  attachment: string | null;
  promotions: number;
  counts: {
    deals: number;
    documents: number;
    messages: number;
    baseRentTerms: number;
    legacyEvents: number;
    formalReviews: number;
  };
}

function landlordSummary(workspace: Awaited<ReturnType<typeof getNegotiationWorkspace>>): string | null {
  const position = workspace?.terms.find((term) => term.canonicalType === "BASE_RENT")?.landlordPosition;
  return position?.kind === "VALUE" ? position.value.summary : null;
}

export async function canonicalDemoFingerprint(db: PrismaClient): Promise<CanonicalDemoFingerprint> {
  const workspace = await getNegotiationWorkspace(db, CANONICAL_DEMO_DEAL_ID);
  const brief = await getDealBrief(db, CANONICAL_DEMO_DEAL_ID);
  const actions = await getDealActionState(db, CANONICAL_DEMO_DEAL_ID, { now: DEMO_VERIFY_NOW });
  const activity = await getActivityPage(db, { rootType: "DEAL", rootId: CANONICAL_DEMO_DEAL_ID, limit: 100 });
  const comparison = brief?.comparisons.find((item) => item.outcome === "DIFFERS") ?? null;
  const legacy = activity?.events.find((event) => event.sourceType === "DEAL_EVENT") ?? null;
  const movement = (activity?.events ?? [])
    .filter((event) => event.sourceType === "NEGOTIATION_ROUND")
    .slice()
    .sort((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""));
  const earlier = movement[0]?.details?.find((detail) => detail.canonicalType === "BASE_RENT");
  const proposal = actions?.actions.find((action) => action.source.evidenceQuote === DEMO_PROPOSAL_REQUEST) ?? null;
  const insurance = actions?.actions.find((action) => action.source.evidenceQuote === DEMO_OPEN_REQUEST) ?? null;
  const attachment = await db.sourceMessageAttachment.findFirst({
    where: { sourceMessage: { dealId: CANONICAL_DEMO_DEAL_ID } },
    select: { filename: true, contentType: true },
  });
  return {
    dealId: CANONICAL_DEMO_DEAL_ID,
    dealName: CANONICAL_DEMO_DEAL_NAME,
    formalRent: landlordSummary(workspace),
    earlierFormalRent: earlier?.value ?? null,
    legacyQuote: legacy?.description ?? null,
    communicationValue: comparison?.communication.value ?? null,
    reconciliation: comparison?.outcome ?? null,
    proposalStatus: proposal?.status ?? null,
    proposalFulfillment: proposal?.fulfillment?.evidenceQuote ?? null,
    insuranceStatus: insurance?.status ?? null,
    attachment: attachment ? `${attachment.filename}:${attachment.contentType}` : null,
    promotions: await db.attachmentDocumentPromotion.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } }),
    counts: {
      deals: await db.deal.count({ where: { id: CANONICAL_DEMO_DEAL_ID } }),
      documents: await db.document.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } }),
      messages: await db.sourceMessage.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } }),
      baseRentTerms: await db.negotiationTerm.count({
        where: { canonicalType: "BASE_RENT", round: { dealId: CANONICAL_DEMO_DEAL_ID } },
      }),
      legacyEvents: await db.dealEvent.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } }),
      formalReviews: await db.formalTermReview.count({
        where: { negotiationTerm: { round: { dealId: CANONICAL_DEMO_DEAL_ID } } },
      }),
    },
  };
}

export async function verifyCanonicalDemo(db: PrismaClient): Promise<CanonicalDemoFingerprint> {
  const failures: string[] = [];
  const expect = (condition: unknown, message: string) => {
    if (!condition) failures.push(message);
  };

  const deals = await db.deal.findMany({
    where: { OR: [{ id: CANONICAL_DEMO_DEAL_ID }, { name: CANONICAL_DEMO_DEAL_NAME }] },
    select: { id: true, name: true },
  });
  expect(deals.length === 1 && deals[0]?.id === CANONICAL_DEMO_DEAL_ID, "exactly one canonical demo deal");

  const workspace = await getNegotiationWorkspace(db, CANONICAL_DEMO_DEAL_ID);
  const formal = landlordSummary(workspace);
  expect(formal === "$67.00 / RSF / yr", `formal Base Rent is $67 (saw ${formal})`);
  expect(JSON.stringify(workspace?.terms).includes("72.50") === false, "legacy $72.50 is not a formal term");

  const legacyTerms = await db.negotiationTerm.count({
    where: { round: { dealId: CANONICAL_DEMO_DEAL_ID }, OR: [{ rawValue: { contains: "72.50" } }, { evidenceQuote: { contains: "72.50" } }] },
  });
  expect(legacyTerms === 0, "legacy $72.50 did not create a NegotiationTerm");

  const current = await db.negotiationTerm.findFirst({
    where: { canonicalType: "BASE_RENT", normalizedNumeric: 67, round: { dealId: CANONICAL_DEMO_DEAL_ID } },
  });
  expect(current?.evidenceQuote === ACME_RENT_LINE, "current $67 comes from the checked-in LOI line");
  expect(current?.rawValue === ACME_RENT_LINE, "current $67 raw extraction is the paper line");

  const brief = await getDealBrief(db, CANONICAL_DEMO_DEAL_ID);
  const comparison = brief?.comparisons.find((item) => item.communication.evidenceQuote.includes("$72.00"));
  expect(comparison?.outcome === "DIFFERS", "paper and communication reconciliation is DIFFERS");
  expect(comparison?.formal.numeric === 67, "comparison formal value is 67");
  expect(comparison?.communication.numeric === 72, "reviewed communication value is 72");
  expect(comparison?.communication.reviewState === "CONFIRMED", "communication fact is confirmed");
  expect(comparison?.communication.evidenceQuote === ACME_COMMUNICATION_BODY.replace(/\.$/, ""), "communication quote is the email sentence");
  const attention = brief?.productAttention.find((item) => item.type === "COMMUNICATION_FORMAL_DIFFERENCE");
  expect(comparisonOutcomeLabel(comparison?.outcome ?? "NOT_COMPARABLE") === "Paper and communication differ", "brief labels the paper/communication difference");
  expect(attention?.label.includes("differs between paper and communication") === true, "brief attention names the paper/communication difference");
  expect(
    await db.formalTermReview.count({ where: { negotiationTermId: current?.id ?? "missing" } }) === 1,
    "the $67 paper term has its own formal acceptance"
  );
  const communicationReviews = await db.formalTermReview.count({
    where: { negotiationTerm: { evidenceQuote: { contains: "landlord can do" } } },
  });
  expect(communicationReviews === 0, "communication review did not create a FormalTermReview");

  const activity = await getActivityPage(db, { rootType: "DEAL", rootId: CANONICAL_DEMO_DEAL_ID, limit: 100 });
  const legacy = activity?.events.filter((event) => event.sourceType === "DEAL_EVENT") ?? [];
  expect(
    legacy.length === 1 && legacy[0]?.evidence?.supports.some((support) => support.quote === DEMO_LEGACY_QUOTE) === true,
    "historical $72.50 activity exists once"
  );
  const movement = (activity?.events ?? [])
    .filter((event) => event.sourceType === "NEGOTIATION_ROUND")
    .slice()
    .sort((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""));
  const earlierTerm = await db.negotiationTerm.findFirst({
    where: { canonicalType: "BASE_RENT", normalizedNumeric: 72, round: { dealId: CANONICAL_DEMO_DEAL_ID } },
  });
  expect(earlierTerm?.evidenceQuote === DEMO_EARLIER_RENT_LINE, "earlier formal paper quotes the $72 line");
  expect(movement[0]?.details?.find((detail) => detail.canonicalType === "BASE_RENT")?.value?.includes("72.00") === true, "earlier formal paper is $72");
  expect(movement.at(-1)?.details?.find((detail) => detail.canonicalType === "BASE_RENT")?.value?.includes("67.00") === true, "later formal paper is $67");

  const actions = await getDealActionState(db, CANONICAL_DEMO_DEAL_ID, { now: DEMO_VERIFY_NOW });
  const proposal = actions?.actions.find((action) => action.source.evidenceQuote === DEMO_PROPOSAL_REQUEST);
  const insurance = actions?.actions.find((action) => action.source.evidenceQuote === DEMO_OPEN_REQUEST);
  expect(proposal?.confidence === "REVIEWED" && proposal.status === "CLOSED", "proposal request is a reviewed closed action");
  expect(proposal?.fulfillment?.evidenceQuote === DEMO_FULFILLMENT, "fulfillment targets the proposal request");
  expect(insurance?.confidence === "REVIEWED" && insurance.status === "OPEN", "insurance request stays open");
  expect(actions?.outstandingActions.some((action) => action.source.evidenceQuote === DEMO_PROPOSAL_REQUEST) === false, "fulfilled proposal is not outstanding");
  expect(actions?.outstandingActions.some((action) => action.source.evidenceQuote === DEMO_OPEN_REQUEST) === true, "insurance request is outstanding");

  const fulfillmentFact = await db.activityFact.findFirst({
    where: { sourceMessage: { dealId: CANONICAL_DEMO_DEAL_ID }, evidenceQuote: DEMO_FULFILLMENT },
  });
  const linked = (fulfillmentFact?.structuredPayload as { action?: { fulfillsFactId?: string | null } } | null)?.action?.fulfillsFactId;
  expect(linked === proposal?.source.factId, "fulfillment fact links to the proposal request");

  const attachments = await db.sourceMessageAttachment.findMany({
    where: { sourceMessage: { dealId: CANONICAL_DEMO_DEAL_ID } },
    include: { promotion: true, sourceMessage: { select: { subject: true } } },
  });
  expect(attachments.length === 1, "one PDF attachment");
  expect(attachments[0]?.filename === "acme-loi.pdf", "attachment is acme-loi.pdf");
  expect(attachments[0]?.sourceMessage.subject === "Acme LOI", "attachment arrived on the Acme LOI email");
  expect(
    isPromotablePdfAttachment({ filename: attachments[0]?.filename ?? "", contentType: attachments[0]?.contentType }),
    "attachment is eligible to promote"
  );
  expect(attachments[0]?.promotion == null, "reset leaves the attachment unpromoted");
  expect(await db.attachmentDocumentPromotion.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } }) === 0, "no promotion provenance row");

  const messageCount = await db.sourceMessage.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } });
  const documentCount = await db.document.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } });
  expect(messageCount === 5, `five source messages (saw ${messageCount})`);
  expect(documentCount === 2, `two formal documents (saw ${documentCount})`);
  expect(
    await db.negotiationTerm.count({ where: { canonicalType: "BASE_RENT", round: { dealId: CANONICAL_DEMO_DEAL_ID } } }) === 2,
    "two Base Rent terms"
  );

  const loi = await db.sourceMessage.findFirst({
    where: { dealId: CANONICAL_DEMO_DEAL_ID, subject: "Acme LOI" },
    select: { extractionRuns: { select: { id: true } } },
  });
  expect((loi?.extractionRuns.length ?? -1) === 0, "Acme LOI email is waiting, not analyzed");

  if (failures.length > 0) {
    throw new Error(`Canonical demo verification failed:\n- ${failures.join("\n- ")}`);
  }
  return canonicalDemoFingerprint(db);
}
