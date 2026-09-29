import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DealCreateError, createModernDeal } from "@/lib/deals/create";
import {
  emptyDashboard,
  getModernDashboard,
  projectDealCard,
  type DashboardBriefSnapshot,
} from "@/lib/deals/dashboard";
import { getDealBrief } from "@/lib/deals/brief/service";
import { buildTextPdf } from "@/lib/documents/minimalPdf";
import { ingestNegotiationPdf } from "@/lib/documents/ingestNegotiationPdf";
import { LocalDocumentStorage } from "@/lib/documents/storage";
import { createTestDatabase } from "@/lib/documents/testDb";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("front door", () => {
  test("fresh database reaches a modern deal, source, and dashboard", async () => {
    const db = await createTestDatabase();
    const storage = new LocalDocumentStorage(mkdtempSync(path.join(tmpdir(), "dealwatch-front-door-")));
    try {
    const empty = await getModernDashboard(db.prisma);
    assert.deepEqual(empty, { ...emptyDashboard(), workspaceId: null });
    assert.equal(await db.prisma.deal.count(), 0);
    assert.equal(await db.prisma.obligation.count(), 0);
    assert.equal(await db.prisma.dealEvent.count(), 0);

    await assert.rejects(() => createModernDeal(db.prisma, { name: "   " }), DealCreateError);
    const created = await createModernDeal(db.prisma, { name: "Acme Acquisition" });
    assert.equal(created.name, "Acme Acquisition");
    assert.equal(created.stage, "Prospect");
    assert.equal(created.status, "ACTIVE");
    assert.equal(created.href, `/deals/${created.id}`);
    assert.equal(await db.prisma.obligation.count({ where: { dealId: created.id } }), 0);
    assert.equal(await db.prisma.dealEvent.count({ where: { dealId: created.id } }), 0);

    const brief = await getDealBrief(db.prisma, created.id, { expectedWorkspaceId: created.workspaceId });
    assert.ok(brief);
    assert.equal(brief.deal.id, created.id);
    assert.equal(brief.deal.name, "Acme Acquisition");
    assert.equal(brief.actions.outstandingActions.length, 0);
    assert.equal(brief.negotiation.summary.termCount, 0);

    const listed = await getModernDashboard(db.prisma);
    assert.equal(listed.workspaceId, created.workspaceId);
    assert.equal(listed.deals.length, 1);
    assert.equal(listed.deals[0]?.name, "Acme Acquisition");
    assert.equal(listed.deals[0]?.href, created.href);
    assert.equal(listed.deals[0]?.derived, true);
    assert.equal(listed.deals[0]?.hasSources, false);
    assert.equal(listed.deals[0]?.openActionCount, 0);
    assert.match(listed.deals[0]?.summary ?? "", /No sources yet/);
    assert.equal(listed.metrics.activeDeals, 1);
    assert.equal(listed.metrics.openActions, 0);

    const other = await createModernDeal(db.prisma, { name: "Other Acquisition" });
    const result = await ingestNegotiationPdf({
      dealId: created.id,
      bytes: buildTextPdf(["Acme Acquisition source"]),
      filename: "acme-loi.pdf",
      mimeType: "application/pdf",
      side: "TENANT",
      documentDate: new Date("2026-09-01T00:00:00Z"),
      documentType: "LOI",
      storage,
      prisma: db.prisma,
      mode: "extract",
      extractGraph: null,
    });
    assert.equal(result.document.originalFilename, "acme-loi.pdf");
    assert.equal(await db.prisma.document.count({ where: { dealId: created.id } }), 1);
    assert.equal(await db.prisma.document.count({ where: { dealId: other.id } }), 0);

    const afterUpload = await getModernDashboard(db.prisma);
    const acme = afterUpload.deals.find((deal) => deal.id === created.id);
    const sibling = afterUpload.deals.find((deal) => deal.id === other.id);
    assert.equal(acme?.hasSources, true);
    assert.match(acme?.summary ?? "", /Sources are on the deal/);
    assert.equal(sibling?.hasSources, false);
    assert.equal(acme?.openActionCount, 0);

    const documentsPage = readRepo("app/deals/[id]/documents/page.tsx");
    const uploadForm = readRepo("components/negotiation/upload-document-form.tsx");
    const documentsRoute = readRepo("app/api/deals/[id]/documents/route.ts");
    assert.match(documentsPage, /UploadNegotiationDocument/);
    assert.match(documentsPage, /surface="documents"/);
    assert.match(uploadForm, /\/api\/deals\/\$\{dealId\}\/documents/);
    assert.match(documentsRoute, /ingestNegotiationPdf/);

    const foreignWorkspace = await db.prisma.workspace.create({ data: { name: "Foreign" } });
    const foreign = await db.prisma.deal.create({
      data: {
        name: "Foreign Deal",
        company: "Elsewhere",
        property: "9 Other Street",
        stage: "Prospect",
        status: "ACTIVE",
        workspaceId: foreignWorkspace.id,
      },
    });
    const isolated = await getModernDashboard(db.prisma);
    assert.equal(isolated.deals.some((deal) => deal.id === foreign.id), false);
    const foreignDashboard = await getModernDashboard(db.prisma, { workspaceId: foreignWorkspace.id });
    assert.deepEqual(foreignDashboard.deals.map((deal) => deal.id), [foreign.id]);
    assert.equal(foreignDashboard.deals[0]?.hasSources, false);
    } finally {
      await db.cleanup();
    }
  });

  test("dashboard projects modern action state and tolerates a missing brief", () => {
    const deal = {
      id: "deal-1",
      name: "Acme Acquisition",
      company: "Acme",
      property: "100 Main",
      stage: "Negotiation",
      status: "ACTIVE",
      updatedAt: new Date("2026-09-29T12:00:00Z"),
    };
    const missing = projectDealCard(deal, null);
    assert.equal(missing.derived, false);
    assert.equal(missing.openActionCount, 0);
    assert.equal(missing.negotiation, null);
    assert.equal(missing.summary, "No derived brief yet.");

    const snapshot: DashboardBriefSnapshot = {
      outstandingActions: [
        {
          id: "action-us",
          description: "Send the revised LOI",
          timingLabel: "Our side",
          responsibleSide: "OUR_SIDE",
          href: "/messages/m1",
        },
        {
          id: "action-them",
          description: "Waiting on landlord comments",
          timingLabel: "Counterparty",
          responsibleSide: "COUNTERPARTY",
          href: "/messages/m2",
        },
      ],
      needsYou: [
        {
          id: "action-us",
          description: "Send the revised LOI",
          timingLabel: "Our side",
          responsibleSide: "OUR_SIDE",
          href: "/messages/m1",
        },
      ],
      passedDeadlineCount: 1,
      termCount: 2,
      openCount: 1,
      agreedCount: 1,
      conflictCount: 0,
      communicationCount: 1,
      hasDocumentOrFormal: true,
    };
    const card = projectDealCard(deal, snapshot);
    assert.equal(card.openActionCount, 2);
    assert.equal(card.needsYouCount, 1);
    assert.equal(card.counterpartyActionCount, 1);
    assert.equal(card.passedDeadlineCount, 1);
    assert.equal(card.topActions[0]?.description, "Send the revised LOI");
    assert.equal(card.summary, "Send the revised LOI");
    assert.equal(card.negotiation?.openCount, 1);
  });

  test("navigation points at the modern workflow and labels analyze as legacy", () => {
    const nav = readRepo("components/nav.tsx");
    const analyze = readRepo("app/analyze/page.tsx");
    const dashboard = readRepo("app/dashboard/page.tsx");
    const header = readRepo("components/deals/deal-header.tsx");
    const createRoute = readRepo("app/api/deals/route.ts");
    assert.match(nav, /href: "\/dashboard"/);
    assert.match(nav, /href: "\/deals"/);
    assert.match(nav, /href="\/deals\/new"/);
    assert.equal(nav.includes('href: "/analyze"'), false);
    assert.match(analyze, /Legacy workflow/);
    assert.match(analyze, /obligation/);
    assert.equal(dashboard.includes("obligation"), false);
    assert.equal(dashboard.includes("dealEvent"), false);
    assert.match(dashboard, /getModernDashboard/);
    assert.match(header, /\/deals\/\$\{dealId\}#actions/);
    assert.match(header, /Documents/);
    assert.match(header, /Messages/);
    assert.match(header, /Negotiation/);
    assert.match(createRoute, /createModernDeal/);
    assert.equal(createRoute.includes("obligation"), false);
  });
});
