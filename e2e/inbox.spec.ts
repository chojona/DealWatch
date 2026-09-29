import { createDeal, uploadPdf, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

test("a failed document is reachable from Brief processing issues and the inbox filters", async ({ page }) => {
  const dealPath = await createDeal(page, "Inbox recovery");
  const file = writeTextPdf(
    "inbox-failed.pdf",
    "E2E_FAIL_ONCE\nBase Rent: $67.00 per rentable square foot per year"
  );
  await uploadPdf(page, file, { date: "2026-09-15" });
  await expect(page.getByText("Analysis failed", { exact: true }).first()).toBeVisible();
  await page.goto(dealPath);
  await page.getByRole("link", { name: /Processing issue/ }).click();
  await expect(page).toHaveURL(/filter=FAILED/);
  await expect(page.getByText("inbox-failed.pdf")).toBeVisible();
  await expect(page.getByText(/Negotiation analysis failed/)).toBeVisible();
  await page.getByRole("link", { name: /^All/ }).first().click();
  await expect(page.getByText("inbox-failed.pdf")).toBeVisible();
  await page.getByRole("link", { name: /^Documents/ }).first().click();
  await expect(page.getByText("inbox-failed.pdf")).toBeVisible();
  await page.getByRole("link", { name: /^Messages/ }).first().click();
  await expect(page.getByText("inbox-failed.pdf")).toHaveCount(0);
});
