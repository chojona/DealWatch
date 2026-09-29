import path from "node:path";
import { createDeal, e2eDb, importEml } from "./helpers";
import { expect, test } from "./test";

test("promoting an email PDF attachment analyzes it as formal paper", async ({ page }) => {
  await createDeal(page, "Attachment promotion");
  await importEml(page, path.join(process.cwd(), "fixtures/messages/acme-loi.eml"));
  await expect(page.getByRole("heading", { name: "Acme LOI" })).toBeVisible();
  await expect(page.getByText("acme-loi.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Promote to document" }).click();
  await expect(page.getByText("Promoted to document")).toBeVisible();
  await page.getByRole("link", { name: "Open document" }).click();
  await expect(page.getByRole("heading", { name: "Source" })).toBeVisible();
  await expect(page.getByText("Email attachment")).toBeVisible();
  await expect(page.getByRole("link", { name: "Acme LOI" })).toBeVisible();

  await page.getByLabel("Document type").selectOption("LOI");
  await page.getByLabel("Authoring side").selectOption("LANDLORD");
  await page.getByLabel("Document date").fill("2026-09-15");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await expect(page.getByRole("button", { name: "Analyze document" })).toBeEnabled();
  await page.getByRole("button", { name: "Analyze document" }).click();
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await expect(page.getByText(/Base Rent: \$45\.00 per rentable square foot per year|\$45\.00\/RSF\/year/).first()).toBeVisible();
  await page.getByRole("button", { name: "Accept value" }).click();
  await expect(page.getByText("Accepted extraction")).toBeVisible();

  const db = e2eDb();
  const term = await db.negotiationTerm.findFirstOrThrow({ where: { canonicalType: "BASE_RENT" } });
  expect(term.normalizedNumeric).toBe(45);
  expect(term.rawValue).toContain("45");
  const document = await db.document.findFirstOrThrow();
  expect(document.ingestionStatus).toBe("COMPLETE");
});
