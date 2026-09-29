import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase } from "@/lib/documents/testDb";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import { promoteAttachmentToDocument } from "@/lib/messages/promoteAttachment";
import { LocalMessageStorage } from "@/lib/messages/storage";
import { CANONICAL_DEMO_DEAL_ID, CANONICAL_DEMO_DEAL_NAME, DEMO_LEGACY_QUOTE } from "./identity";
import { resetCanonicalDemo } from "./reset";
import { DemoSafetyError } from "./safety";
import { verifyCanonicalDemo } from "./verify";

const documentStorage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-demo-doc-")));
const messageStorage = new LocalMessageStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-demo-msg-")));

function environment(databaseUrl: string, nodeEnv: string | undefined = "test") {
  return {
    nodeEnv,
    confirmation: "canonical-demo",
    databaseUrl,
  };
}

async function snapshotDeal(db: PrismaClient, dealId: string) {
  const deal = await db.deal.findUnique({ where: { id: dealId } });
  const events = await db.dealEvent.findMany({ where: { dealId }, orderBy: { id: "asc" } });
  const messages = await db.sourceMessage.findMany({
    where: { dealId },
    orderBy: { id: "asc" },
    include: { attachments: { orderBy: { id: "asc" } } },
  });
  const documents = await db.document.findMany({ where: { dealId }, orderBy: { id: "asc" } });
  const rounds = await db.negotiationRound.findMany({
    where: { dealId },
    orderBy: { id: "asc" },
    include: { terms: { orderBy: { id: "asc" } } },
  });
  const reviews = await db.formalTermReview.findMany({
    where: { negotiationTerm: { round: { dealId } } },
    orderBy: { id: "asc" },
  });
  return JSON.stringify({ deal, events, messages, documents, rounds, reviews });
}

describe("canonical demo", { concurrency: 1 }, () => {
  let db: PrismaClient;
  let cleanup: () => Promise<void>;
  let databaseUrl = "";
  let clarendonId = "";
  let unrelatedId = "";
  let otherWorkspaceId = "";
  let clarendonBefore = "";
  let unrelatedBefore = "";
  let firstFingerprint = "";

  test("setup", async () => {
    const database = await createTestDatabase();
    db = database.prisma;
    cleanup = database.cleanup;
    databaseUrl = `file:${path.join(database.dir, "test.db")}`;
    const workspace = await ensureDefaultWorkspace(db);
    const clarendon = await db.deal.create({
      data: {
        name: "200 Clarendon Lease — Acme Corp",
        company: "Acme Corp",
        property: "200 Clarendon Street, Boston MA",
        stage: "Negotiation",
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });
    clarendonId = clarendon.id;
    await db.dealEvent.create({
      data: {
        dealId: clarendon.id,
        type: "COUNTER_RECEIVED",
        description: "Landlord issued counter: $72.50/RSF, $110 TI, 4mo free rent. Nov 15 lease execution deadline.",
        occurredAt: new Date("2026-09-22T15:00:00.000Z"),
        confidence: 0.99,
        evidenceQuote: "Base rent: $72.50/RSF, escalating 2.5% annually",
      },
    });
    await db.negotiationRound.create({
      data: {
        dealId: clarendon.id,
        side: "LANDLORD",
        roundNumber: 1,
        documentName: "Clarendon counter",
        documentText: "Base Rent: $64.00 per RSF per year",
        documentDate: new Date("2026-09-20T00:00:00.000Z"),
        terms: {
          create: {
            canonicalType: "BASE_RENT",
            normalizedValue: "$64.00/RSF/year",
            normalizedNumeric: 64,
            normalizedUnit: "USD_PER_RSF_YEAR",
            rawValue: "$64.00 per RSF per year",
            status: "PROPOSED",
            side: "LANDLORD",
            roundNumber: 1,
            confidence: 1,
            evidenceQuote: "Base Rent: $64.00 per RSF per year",
          },
        },
      },
    });
    await db.sourceMessage.create({
      data: {
        workspaceId: workspace.id,
        dealId: clarendon.id,
        sourceType: "MANUAL",
        subject: "Clarendon regression note",
        bodyText: "This regression note must survive demo reset.",
        senderName: "Sarah Chen",
        senderAddress: "sarah.chen@jll.example",
        sentAt: new Date("2026-09-22T15:00:00.000Z"),
      },
    });

    const otherWorkspace = await db.workspace.create({ data: { name: "Unrelated workspace" } });
    otherWorkspaceId = otherWorkspace.id;
    const unrelated = await db.deal.create({
      data: {
        workspaceId: otherWorkspace.id,
        name: "Unrelated developer deal",
        company: "Other Co",
        property: "9 Other Street",
        stage: "Negotiation",
        status: "ACTIVE",
      },
    });
    unrelatedId = unrelated.id;
    await db.dealEvent.create({
      data: {
        dealId: unrelated.id,
        type: "EMAIL",
        description: "Unrelated note",
        occurredAt: new Date("2026-09-02T00:00:00.000Z"),
        confidence: 1,
        evidenceQuote: "Leave this deal alone.",
      },
    });
    clarendonBefore = await snapshotDeal(db, clarendonId);
    unrelatedBefore = await snapshotDeal(db, unrelatedId);
  });

  test("fresh build verifies the canonical story", async () => {
    await resetCanonicalDemo(db, {
      documentStorage,
      messageStorage,
      environment: environment(databaseUrl),
    });
    const fingerprint = await verifyCanonicalDemo(db);
    firstFingerprint = JSON.stringify(fingerprint);
    assert.equal(fingerprint.counts.deals, 1);
    assert.equal(fingerprint.formalRent, "$67.00 / RSF / yr");
    assert.match(fingerprint.legacyQuote ?? "", /\$72\.50/);
    assert.equal(fingerprint.communicationValue?.includes("72"), true);
    assert.equal(fingerprint.reconciliation, "DIFFERS");
    assert.equal(fingerprint.proposalStatus, "CLOSED");
    assert.equal(fingerprint.insuranceStatus, "OPEN");
    assert.equal(fingerprint.promotions, 0);
  });

  test("promotion is cleared by the next reset", async () => {
    const attachment = await db.sourceMessageAttachment.findFirstOrThrow({
      where: { sourceMessage: { dealId: CANONICAL_DEMO_DEAL_ID } },
    });
    const deal = await db.deal.findUniqueOrThrow({ where: { id: CANONICAL_DEMO_DEAL_ID } });
    const promoted = await promoteAttachmentToDocument(db, {
      messageId: attachment.sourceMessageId,
      attachmentId: attachment.id,
      expectedWorkspaceId: deal.workspaceId,
      messageStorage,
      documentStorage,
    });
    assert.equal(promoted.created, true);
    assert.equal(await db.attachmentDocumentPromotion.count({ where: { dealId: CANONICAL_DEMO_DEAL_ID } }), 1);
  });

  test("repeated reset is idempotent and leaves neighbors untouched", async () => {
    const second = await resetCanonicalDemo(db, {
      documentStorage,
      messageStorage,
      environment: environment(databaseUrl),
    });
    const secondFingerprint = JSON.stringify(await verifyCanonicalDemo(db));
    assert.equal(secondFingerprint, firstFingerprint);
    assert.equal(second.dealId, CANONICAL_DEMO_DEAL_ID);

    const third = JSON.stringify(await verifyCanonicalDemo(db));
    await resetCanonicalDemo(db, {
      documentStorage,
      messageStorage,
      environment: environment(databaseUrl),
    });
    const afterThird = JSON.stringify(await verifyCanonicalDemo(db));
    assert.equal(third, firstFingerprint);
    assert.equal(afterThird, firstFingerprint);
    assert.equal(await db.deal.count({ where: { id: CANONICAL_DEMO_DEAL_ID } }), 1);
    assert.equal(await db.deal.count({ where: { name: CANONICAL_DEMO_DEAL_NAME } }), 1);
    assert.equal(await snapshotDeal(db, clarendonId), clarendonBefore);
    assert.equal(await snapshotDeal(db, unrelatedId), unrelatedBefore);
    assert.equal(await db.workspace.count({ where: { id: otherWorkspaceId } }), 1);
    assert.equal(await db.sourceMessage.count({
      where: { dealId: clarendonId, sourceProvider: "dealwatch-canonical-demo" },
    }), 0);
    assert.equal(await db.document.count({ where: { dealId: clarendonId, originalFilename: { contains: "acme" } } }), 0);
    const clarendonEvent = await db.dealEvent.findFirstOrThrow({ where: { dealId: clarendonId } });
    assert.match(clarendonEvent.evidenceQuote, /\$72\.50/);
    assert.equal(clarendonEvent.evidenceQuote.includes(DEMO_LEGACY_QUOTE), false);
  });

  test("production and unsafe databases are refused", async () => {
    const before = await snapshotDeal(db, clarendonId);
    await assert.rejects(
      () => resetCanonicalDemo(db, {
        documentStorage,
        messageStorage,
        environment: environment(databaseUrl, "production"),
      }),
      (error: unknown) => error instanceof DemoSafetyError && /production/.test(error.reason)
    );
    await assert.rejects(
      () => resetCanonicalDemo(db, {
        documentStorage,
        messageStorage,
        environment: { nodeEnv: "test", confirmation: undefined, databaseUrl },
      }),
      (error: unknown) => error instanceof DemoSafetyError && /DEALWATCH_DEMO_RESET/.test(error.reason)
    );
    await assert.rejects(
      () => resetCanonicalDemo(db, {
        documentStorage,
        messageStorage,
        environment: { nodeEnv: "test", confirmation: "canonical-demo", databaseUrl: "postgres://prod.example/dealwatch" },
      }),
      (error: unknown) => error instanceof DemoSafetyError && /SQLite/.test(error.reason)
    );
    await assert.rejects(
      () => resetCanonicalDemo(db, {
        documentStorage,
        messageStorage,
        environment: { nodeEnv: "test", confirmation: "canonical-demo", databaseUrl: "file:/etc/dealwatch-prod.db" },
      }),
      (error: unknown) => error instanceof DemoSafetyError && /Refused/.test(error.reason)
    );
    assert.equal(await snapshotDeal(db, clarendonId), before);
    assert.equal(await db.deal.count({ where: { id: CANONICAL_DEMO_DEAL_ID } }), 1);
  });

  test("a same-named deal is not deleted", async () => {
    const workspace = await ensureDefaultWorkspace(db);
    const impostor = await db.deal.create({
      data: {
        name: CANONICAL_DEMO_DEAL_NAME,
        company: "Not the demo",
        property: "Elsewhere",
        stage: "LOI",
        status: "ACTIVE",
        workspaceId: workspace.id,
      },
    });
    await assert.rejects(
      () => resetCanonicalDemo(db, {
        documentStorage,
        messageStorage,
        environment: environment(databaseUrl),
      }),
      /Refused/
    );
    assert.equal((await db.deal.findUnique({ where: { id: impostor.id } }))?.company, "Not the demo");
    await db.deal.delete({ where: { id: impostor.id } });
  });

  test("cleanup", async () => {
    await cleanup();
  });
});
