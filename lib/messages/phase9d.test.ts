import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { FIXTURE_500_TEST_STREET } from "@/lib/ai/activity/fixtures";
import { deterministicExtractorIdentity } from "@/lib/ai/activity/extractActivityFacts";
import { getActivityPage } from "@/lib/activity/service";
import { getDealReconciliation } from "@/lib/deals/reconciliation/service";
import { createTestDatabase, createTestDeal } from "@/lib/documents/testDb";
import { getInbox } from "@/lib/inbox/service";
import { EmlValidationError, htmlToSafeText, parseAddresses, parseEml } from "./ingest/eml";
import { ingestEmlMessage, ingestManualMessage, ingestSourceMessage } from "./ingest/service";
import { decideMessageReview, reviewActivityFact } from "./review";
import { analyzeSourceMessage, getMessageSource } from "./service";
import { getOriginalMessageSource } from "./source";
import { LocalMessageStorage } from "./storage";

function eml(input: { id?: string; subject?: string; body?: string; html?: string; attachment?: boolean }) {
  const body = input.body ?? "Landlord proposes $72.50/RSF/year.";
  const html = input.html ?? "<p>HTML fallback</p>";
  return Buffer.from([
    `From: \"Derek Broker\" <derek@example.test>`,
    `To: Sarah <sarah@example.test>, team@example.test`,
    `Cc: legal@example.test`,
    `Bcc: archive@example.test`,
    ...(input.id ? [`Message-ID: <${input.id}>`] : []),
    `References: <root@example.test>`,
    `Subject: ${input.subject ?? "Re: Counter"}`,
    `Date: Tue, 22 Sep 2026 11:00:00 -0400`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="outer"`,
    ``,
    `--outer`,
    `Content-Type: multipart/alternative; boundary="alt"`,
    ``,
    `--alt`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    `${html}`,
    `--alt`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `${body}`,
    `--alt--`,
    ...(input.attachment ? [
      `--outer`,
      `Content-Type: application/pdf; name="../Economics.pdf"`,
      `Content-Disposition: attachment; filename="../Economics.pdf"`,
      `Content-Transfer-Encoding: base64`,
      `Content-ID: <attachment-1>`,
      ``,
      `JVBERi0xLjQ=`,
    ] : []),
    `--outer--`,
    ``,
  ].join("\r\n"), "utf8");
}

async function formalRent(db: PrismaClient, dealId: string, amount: number) {
  return db.negotiationRound.create({
    data: {
      dealId, side: "LANDLORD", roundNumber: 1, documentName: "Formal landlord position", documentText: "Stored", documentDate: new Date("2026-09-18T00:00:00Z"), sourceType: "PASTED_TEXT",
      terms: { create: { canonicalType: "BASE_RENT", normalizedValue: `$${amount.toFixed(2)} / RSF / year`, normalizedNumeric: amount, normalizedUnit: "USD_PER_RSF_YEAR", rawValue: `$${amount}`, status: "PROPOSED", side: "LANDLORD", roundNumber: 1, confidence: 1, evidenceQuote: "Formal rent", structuredPayload: { termType: "BASE_RENT", rent: { kind: "simple", amountPerRSFYear: amount } } } },
    },
  });
}

describe("Phase 9D email ingestion and review", { concurrency: 1 }, () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  const storageRoot = mkdtempSync(path.join(tmpdir(), "dealwatch-message-storage-"));
  const storage = new LocalMessageStorage(storageRoot);

  test("setup", async () => {
    const database = await createTestDatabase();
    prisma = database.prisma;
    cleanup = database.cleanup;
  });

  test("A/J/L manual import derives workspace, preserves unknowns, and does not analyze", async () => {
    const deal = await createTestDeal(prisma);
    const before = { facts: await prisma.activityFact.count(), runs: await prisma.activityExtractionRun.count(), terms: await prisma.negotiationTerm.count(), people: await prisma.person.count() };
    const first = await ingestManualMessage(prisma, { dealId: deal.id, subject: "Same subject", bodyText: "Pasted source only." });
    const second = await ingestManualMessage(prisma, { dealId: deal.id, subject: "Same subject", bodyText: "A distinct source." });
    assert.notEqual(first.id, second.id);
    assert.equal(first.workspaceId, deal.workspaceId);
    assert.equal(first.senderAddress, null);
    assert.equal(first.sentAt, null);
    assert.deepEqual({ facts: await prisma.activityFact.count(), runs: await prisma.activityExtractionRun.count(), terms: await prisma.negotiationTerm.count(), people: await prisma.person.count() }, before);
    const view = await getMessageSource(prisma, first.id);
    assert.equal(view?.analysisState, "NOT_ANALYZED");
    assert.equal(view?.lifecycleState, "IMPORTED");
  });

  test("B–I .eml parser prefers plain text, sanitizes HTML, stores source/attachments, and deduplicates", async () => {
    const deal = await createTestDeal(prisma);
    const raw = eml({ id: "Counter-1@Example.Test", body: "Plain source wins.", html: "<script>steal()</script><p>HTML loses</p><img src='https://remote.test/x'>", attachment: true });
    const parsed = parseEml(raw, { mimeType: "message/rfc822" });
    assert.equal(parsed.bodyText, "Plain source wins.");
    assert.equal(parsed.rfcMessageId, "counter-1@example.test");
    assert.deepEqual(parsed.to.map((item) => item.address), ["sarah@example.test", "team@example.test"]);
    assert.equal(parsed.attachments.length, 1);
    assert.equal(htmlToSafeText("<style>x{}</style><p>Hello &amp; safe</p><script>bad()</script>"), "Hello & safe");
    assert.equal(parseAddresses("A <a@test>, b@test").length, 2);
    const stored = await ingestEmlMessage(prisma, { dealId: deal.id, bytes: raw, filename: "../../counter.eml", mimeType: "message/rfc822" }, { storage });
    assert.match(stored.sourceSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.equal(stored.attachments.length, 1);
    assert.equal(stored.attachments[0]?.filename, "Economics.pdf");
    assert.equal(stored.attachments[0]?.storageKey?.includes(".."), false);
    const source = await getOriginalMessageSource(prisma, { sourceMessageId: stored.id, storage });
    assert.deepEqual(source?.bytes, raw);
    const duplicateId = await ingestEmlMessage(prisma, { dealId: deal.id, bytes: eml({ id: "counter-1@example.test", body: "Different transport bytes" }), filename: "other.eml", mimeType: "message/rfc822" }, { storage });
    assert.equal(duplicateId.id, stored.id);
    const noId = eml({ body: "SHA identity", subject: "SHA" });
    const shaOne = await ingestEmlMessage(prisma, { dealId: deal.id, bytes: noId, filename: "one.eml", mimeType: "message/rfc822" }, { storage });
    const shaTwo = await ingestEmlMessage(prisma, { dealId: deal.id, bytes: noId, filename: "two.eml", mimeType: "message/rfc822" }, { storage });
    assert.equal(shaOne.id, shaTwo.id);
    assert.equal(await prisma.activityFact.count({ where: { sourceMessageId: stored.id } }), 0);
  });

  test("security bounds reject oversized email and traversal", async () => {
    assert.throws(() => parseEml(Buffer.from("x".repeat(101)), { maxBytes: 100 }), (error) => error instanceof EmlValidationError && error.code === "OVERSIZED");
    assert.throws(() => storage.get("../outside.eml"), /Invalid document storage path/);
    const hostile = parseEml(eml({ html: "<iframe src='https://evil.test'></iframe><p>Safe</p>", body: "Safe plain" }));
    assert.equal(hostile.bodyText.includes("evil.test"), false);
  });

  test("M–P analysis is explicit, idempotent, persists failure, and retries", async () => {
    const deal = await createTestDeal(prisma);
    const message = await ingestManualMessage(prisma, { dealId: deal.id, bodyText: "Landlord proposes $70/RSF/year." });
    const identity = { ...deterministicExtractorIdentity(), model: "phase9d-retry" };
    await assert.rejects(analyzeSourceMessage(prisma, message.id, { extractor: identity, complete: async () => { throw new Error("temporary model outage"); } }), /temporary model outage/);
    const failed = await prisma.activityExtractionRun.findFirstOrThrow({ where: { sourceMessageId: message.id, model: "phase9d-retry" } });
    assert.equal(failed.status, "FAILED");
    assert.match(failed.failureReason ?? "", /temporary model outage/);
    const retried = await analyzeSourceMessage(prisma, message.id, { extractor: identity, complete: async () => JSON.stringify({ facts: [{ factType: "NEGOTIATION_VALUE", canonicalType: "BASE_RENT", side: "LANDLORD", assertionStatus: "PROPOSED", evidenceQuote: "Landlord proposes $70/RSF/year.", display: "$70.00 / RSF / year", numeric: 70, unit: "USD_PER_RSF_YEAR", negotiation: null }] }) });
    assert.equal(retried.runId, failed.id);
    const again = await analyzeSourceMessage(prisma, message.id, { extractor: identity, complete: async () => { throw new Error("must not be called"); } });
    assert.equal(again.idempotent, true);
    assert.equal(await prisma.activityFact.count({ where: { sourceMessageId: message.id } }), 1);
  });

  test("Q–Z fixture facts are reviewed append-only and corrections never change negotiation truth", async () => {
    const deal = await createTestDeal(prisma);
    await formalRent(prisma, deal.id, 67);
    const message = await ingestSourceMessage(prisma, { dealId: deal.id, sourceType: "FIXTURE", subject: FIXTURE_500_TEST_STREET.subject, senderName: FIXTURE_500_TEST_STREET.senderName, senderAddress: FIXTURE_500_TEST_STREET.senderAddress, sentAt: new Date("2026-09-22T15:00:00Z"), bodyText: FIXTURE_500_TEST_STREET.bodyText, sourceProvider: "fixture", externalMessageId: "phase9d-five-facts" });
    const result = await analyzeSourceMessage(prisma, message.id);
    assert.equal(result.factCount, 5);
    const facts = await prisma.activityFact.findMany({ where: { sourceMessageId: message.id } });
    const rent = facts.find((fact) => fact.canonicalType === "BASE_RENT" && fact.assertionStatus === "PROPOSED")!;
    const original = rent.structuredPayload;
    await reviewActivityFact(prisma, { sourceMessageId: message.id, activityFactId: facts.find((fact) => fact.canonicalType === "FREE_RENT")!.id, state: "CONFIRMED" });
    await reviewActivityFact(prisma, { sourceMessageId: message.id, activityFactId: rent.id, state: "INCORRECT", correctedPayload: { display: "$72.00 / RSF / year", numeric: 72, unit: "USD_PER_RSF_YEAR", negotiation: null }, note: "Manual review" });
    assert.deepEqual((await prisma.activityFact.findUniqueOrThrow({ where: { id: rent.id } })).structuredPayload, original);
    assert.equal(await prisma.negotiationTerm.count({ where: { round: { dealId: deal.id } } }), 1);
    let view = await getMessageSource(prisma, message.id);
    const reviewedRent = view?.facts.find((fact) => fact.id === rent.id);
    assert.equal(reviewedRent?.value, "$68.00 / RSF / year");
    assert.equal(reviewedRent?.reviewedValue, "$72.00 / RSF / year");
    assert.equal(reviewedRent?.reconciliation?.currentPosition?.display, "$67.00 / RSF / year");
    assert.equal(reviewedRent?.reviewedReconciliation?.relationship, "DIFFERS_FROM_CURRENT");
    await decideMessageReview(prisma, { sourceMessageId: message.id, decision: "NEEDS_FOLLOW_UP" });
    assert.equal((await getMessageSource(prisma, message.id))?.reviewState, "NEEDS_FOLLOW_UP");
    await decideMessageReview(prisma, { sourceMessageId: message.id, decision: "ACKNOWLEDGED" });
    view = await getMessageSource(prisma, message.id);
    assert.equal(view?.reviewState, "REVIEWED");
    assert.equal(view?.reviewHistory.some((event) => event.type === "CORRECTION_RECORDED"), true);
    const reconciliation = await getDealReconciliation(prisma, deal.id);
    assert.equal(reconciliation?.links.find((link) => link.canonicalType === "BASE_RENT")?.eventValue?.numeric, 68);
    assert.equal(reconciliation?.links.find((link) => link.canonicalType === "BASE_RENT")?.reviewedValue?.numeric, 72);
    const activity = await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id });
    assert.match(activity?.events.find((event) => event.sourceId === message.id)?.description ?? "", /Reviewed/);
  });

  test("workspace isolation, source isolation, inbox message state, and read-only projections", async () => {
    const deal = await createTestDeal(prisma);
    const message = await ingestManualMessage(prisma, { dealId: deal.id, subject: "Inbox message", bodyText: "Landlord proposes $65/RSF/year." });
    const foreign = await prisma.workspace.create({ data: { name: "Foreign" } });
    await assert.rejects(analyzeSourceMessage(prisma, message.id, { expectedWorkspaceId: foreign.id }), /Message not found/);
    assert.equal(await getMessageSource(prisma, message.id, { expectedWorkspaceId: foreign.id }), null);
    assert.equal(await getOriginalMessageSource(prisma, { sourceMessageId: message.id, expectedWorkspaceId: foreign.id, storage }), null);
    const before = { facts: await prisma.activityFact.count(), reviews: await prisma.messageReviewDecision.count(), terms: await prisma.negotiationTerm.count(), people: await prisma.person.count(), companies: await prisma.company.count() };
    const inbox = await getInbox(prisma, { workspaceId: deal.workspaceId });
    assert.equal(inbox.sourceItems.some((item) => item.kind === "MESSAGE" && item.message.id === message.id && item.message.analysisState === "NOT_ANALYZED"), true);
    await getMessageSource(prisma, message.id);
    await getActivityPage(prisma, { rootType: "DEAL", rootId: deal.id });
    assert.deepEqual({ facts: await prisma.activityFact.count(), reviews: await prisma.messageReviewDecision.count(), terms: await prisma.negotiationTerm.count(), people: await prisma.person.count(), companies: await prisma.company.count() }, before);
  });

  test("cleanup", async () => {
    await cleanup();
    rmSync(storageRoot, { recursive: true, force: true });
  });
});
