import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTestDatabase } from "@/lib/documents/testDb";
import { ensureDefaultWorkspace } from "@/lib/entities/workspace";
import {
  DEAL_SEARCH_DEFAULT_LIMIT,
  DealSearchError,
  normalizeDealSearchQuery,
  parseDealSearchRequest,
  searchDeals,
} from "@/lib/deals/search";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readRepo(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("deal search query", () => {
  test("trims and collapses whitespace", () => {
    assert.equal(normalizeDealSearchQuery("  500   Boylston  "), "500 Boylston");
    assert.equal(normalizeDealSearchQuery("\nAcme\t"), "Acme");
    assert.equal(normalizeDealSearchQuery("   "), "");
  });

  test("rejects a client workspace id and keeps the query text", () => {
    assert.throws(
      () => parseDealSearchRequest(new URLSearchParams("q=Acme&workspaceId=other")),
      (error: unknown) => error instanceof DealSearchError && /workspace/i.test(error.message)
    );
    assert.deepEqual(parseDealSearchRequest(new URLSearchParams("q=%20%20acme%20%20")), { q: "acme" });
    assert.throws(
      () => parseDealSearchRequest(new URLSearchParams(`q=${"a".repeat(201)}`)),
      DealSearchError
    );
  });
});

describe("deal search", () => {
  test("finds workspace deals by name, company, and property", async () => {
    const db = await createTestDatabase();
    try {
      const workspace = await ensureDefaultWorkspace(db.prisma);
      const acme = await db.prisma.deal.create({
        data: {
          name: "Acme Acquisition",
          company: "Acme Corp",
          property: "123 Main Street",
          stage: "Negotiation",
          status: "ACTIVE",
          workspaceId: workspace.id,
        },
      });
      const boston = await db.prisma.deal.create({
        data: {
          name: "Boston Office Renewal",
          company: "Northstar Holdings",
          property: "500 Boylston Street",
          stage: "Prospect",
          status: "ACTIVE",
          workspaceId: workspace.id,
        },
      });
      const cambridge = await db.prisma.deal.create({
        data: {
          name: "Cambridge Expansion",
          company: "Acme Corp",
          property: "100 Main Street",
          stage: "Touring",
          status: "ACTIVE",
          workspaceId: workspace.id,
        },
      });
      const foreignWorkspace = await db.prisma.workspace.create({ data: { name: "Other Firm" } });
      const secret = await db.prisma.deal.create({
        data: {
          name: "Secret Acquisition",
          company: "Secret Corp",
          property: "9 Hidden Lane",
          stage: "Prospect",
          status: "ACTIVE",
          workspaceId: foreignWorkspace.id,
        },
      });

      const byName = await searchDeals(db.prisma, { q: "Acquisition" });
      assert.deepEqual(byName.results.map((deal) => deal.id), [acme.id]);
      assert.equal(byName.results[0]?.href, `/deals/${acme.id}`);
      assert.equal(byName.results[0]?.name, "Acme Acquisition");
      assert.equal(byName.results[0]?.company, "Acme Corp");
      assert.equal(byName.results[0]?.property, "123 Main Street");
      assert.equal(byName.results[0]?.stage, "Negotiation");
      assert.equal(byName.workspaceId, workspace.id);
      assert.equal("summary" in (byName.results[0] ?? {}), false);

      const partial = await searchDeals(db.prisma, { q: "Acquis" });
      assert.deepEqual(partial.results.map((deal) => deal.id), [acme.id]);

      const lower = await searchDeals(db.prisma, { q: "acme" });
      const upper = await searchDeals(db.prisma, { q: "ACME" });
      assert.deepEqual(lower.results.map((deal) => deal.name), ["Acme Acquisition", "Cambridge Expansion"]);
      assert.deepEqual(upper.results.map((deal) => deal.id), lower.results.map((deal) => deal.id));

      const byCompany = await searchDeals(db.prisma, { q: "Northstar" });
      assert.deepEqual(byCompany.results.map((deal) => deal.id), [boston.id]);

      const byProperty = await searchDeals(db.prisma, { q: "Boylston" });
      assert.deepEqual(byProperty.results.map((deal) => deal.id), [boston.id]);

      const spaced = await searchDeals(db.prisma, { q: "  500   Boylston  " });
      assert.deepEqual(spaced.results.map((deal) => deal.id), [boston.id]);

      const none = await searchDeals(db.prisma, { q: "zzzz-not-a-deal" });
      assert.deepEqual(none.results, []);
      assert.equal(none.query, "zzzz-not-a-deal");

      const cleared = await searchDeals(db.prisma, { q: "   " });
      assert.equal(cleared.query, "");
      assert.deepEqual(cleared.results.map((deal) => deal.id), [acme.id, boston.id, cambridge.id]);
      assert.equal(cleared.results.some((deal) => deal.id === secret.id), false);

      const isolated = await searchDeals(db.prisma, { q: "Acquisition", workspaceId: workspace.id });
      assert.deepEqual(isolated.results.map((deal) => deal.id), [acme.id]);
      const foreign = await searchDeals(db.prisma, { q: "Acquisition", workspaceId: foreignWorkspace.id });
      assert.deepEqual(foreign.results.map((deal) => deal.id), [secret.id]);
      assert.equal(foreign.results[0]?.href, `/deals/${secret.id}`);
      const missingWorkspace = await searchDeals(db.prisma, { q: "Acme", workspaceId: null });
      assert.deepEqual(missingWorkspace.results, []);
      assert.equal(missingWorkspace.workspaceId, null);

      const again = await searchDeals(db.prisma, { q: "acme" });
      assert.deepEqual(again.results.map((deal) => deal.id), lower.results.map((deal) => deal.id));
    } finally {
      await db.cleanup();
    }
  });

  test("bounds results and orders them by name then id", async () => {
    const db = await createTestDatabase();
    try {
      const workspace = await ensureDefaultWorkspace(db.prisma);
      const created = [];
      for (let index = 1; index <= DEAL_SEARCH_DEFAULT_LIMIT + 5; index += 1) {
        created.push(await db.prisma.deal.create({
          data: {
            name: `Bound ${String(index).padStart(2, "0")}`,
            company: "Limit Co",
            property: "1 Bound Street",
            stage: "Prospect",
            status: "ACTIVE",
            workspaceId: workspace.id,
          },
        }));
      }
      const bounded = await searchDeals(db.prisma, { q: "Bound" });
      assert.equal(bounded.results.length, DEAL_SEARCH_DEFAULT_LIMIT);
      assert.equal(bounded.truncated, true);
      assert.deepEqual(
        bounded.results.map((deal) => deal.name),
        created.slice(0, DEAL_SEARCH_DEFAULT_LIMIT).map((deal) => deal.name)
      );

      const smaller = await searchDeals(db.prisma, { q: "Bound", limit: 3 });
      assert.deepEqual(smaller.results.map((deal) => deal.name), ["Bound 01", "Bound 02", "Bound 03"]);
      assert.equal(smaller.truncated, true);

      const zed = await db.prisma.deal.create({
        data: {
          name: "Zed Shared",
          company: "Shared Co",
          property: "1 Shared Way",
          stage: "Prospect",
          status: "ACTIVE",
          workspaceId: workspace.id,
        },
      });
      const alpha = await db.prisma.deal.create({
        data: {
          name: "Alpha Shared",
          company: "Shared Co",
          property: "2 Shared Way",
          stage: "Prospect",
          status: "ACTIVE",
          workspaceId: workspace.id,
        },
      });
      const ordered = await searchDeals(db.prisma, { q: "Shared", limit: 10 });
      assert.deepEqual(ordered.results.map((deal) => deal.id), [alpha.id, zed.id]);
    } finally {
      await db.cleanup();
    }
  });

  test("deals page searches through the deal query and not canonical search", () => {
    const page = readRepo("app/deals/page.tsx");
    const searchUi = readRepo("components/deals/deal-search.tsx");
    const route = readRepo("app/api/deals/search/route.ts");
    const service = readRepo("lib/deals/search.ts");
    assert.match(page, /DealSearch/);
    assert.match(searchUi, /Search deals/);
    assert.match(searchUi, /\/api\/deals\/search/);
    assert.match(searchUi, /No deals match/);
    assert.match(searchUi, /Searching deals/);
    assert.match(route, /searchDeals/);
    assert.match(route, /workspaceId is server-controlled/);
    assert.equal(service.includes("getDealBrief"), false);
    assert.equal(service.includes("searchCanonicalEntities"), false);
    assert.equal(route.includes("searchCanonicalEntities"), false);
    assert.equal(page.includes("getDealBrief"), false);
    assert.equal(page.includes("formalReview"), false);
  });
});
