import path from "node:path";
import { analyzeMessage, createDeal, importEml, uploadPdf, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

test("since catch-up keeps current paper and filters communication around the boundary", async ({ page }) => {
  const dealPath = await createDeal(page, "Catch-up");
  const paper = writeTextPdf("catchup-paper.pdf", "Base Rent: $67.00 per rentable square foot per year");
  await uploadPdf(page, paper, { date: "2026-09-01" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  const fixtures = path.join(process.cwd(), "fixtures/messages");
  for (const name of ["e2e-catchup-before.eml", "e2e-catchup-exact.eml", "e2e-catchup-after.eml"]) {
    await importEml(page, path.join(fixtures, name));
    await analyzeMessage(page);
    await page.goto(`${dealPath}/messages`);
  }

  await page.goto(`${dealPath}?since=2026-09-29T10:00:00Z`);
  await expect(page.getByText(/Showing changes after/)).toBeVisible();
  await expect(page.getByText(/Current open deal state remains visible/)).toBeVisible();
  await expect(page.getByText(/\$67/).first()).toBeVisible();
  await expect(page.getByText("Before boundary note")).toHaveCount(0);
  await expect(page.getByText("Exact boundary note")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "After boundary note" })).toBeVisible();

  await page.goto(`${dealPath}?since=2099-01-01T00:00:00Z`);
  await expect(page.getByText(/No meaningful changes since/)).toBeVisible();
  await expect(page.getByText("No communications arrived in this catch-up window.")).toBeVisible();
  await expect(page.getByText("No timeline events occurred in this catch-up window.")).toBeVisible();
  await expect(page.getByText(/\$67/).first()).toBeVisible();
  await expect(page.getByText("After boundary note")).toHaveCount(0);

  await page.goto(`${dealPath}?since=banana`);
  await expect(page.getByRole("heading", { name: "Invalid catch-up timestamp" })).toBeVisible();
  await expect(page.getByText(/since must be a valid offset-aware ISO-8601 date-time/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current terms" })).toHaveCount(0);
});
