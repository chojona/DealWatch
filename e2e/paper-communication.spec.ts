import path from "node:path";
import { analyzeMessage, createDeal, e2eDb, importEml, openDeal, uploadPdf, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

test("the brief shows paper and a corrected communication without moving formal truth", async ({ page }) => {
  await createDeal(page, "Acme Acquisition");
  const paper = writeTextPdf("paper-67.pdf", "Base Rent: $67.00 per rentable square foot per year");
  await uploadPdf(page, paper, { date: "2026-09-15" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Review document" }).first().click();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await page.getByRole("button", { name: "Accept value" }).click();
  await expect(page.getByText("Paper value · Confirmed")).toBeVisible();

  await importEml(page, path.join(process.cwd(), "fixtures/messages/e2e-misread-rent.eml"));
  await analyzeMessage(page);
  await page.getByRole("button", { name: "Mark incorrect" }).click();
  await page.getByLabel("Corrected display").fill("$72.00 / RSF / year");
  await page.getByLabel("Numeric value").fill("72");
  const saved = page.waitForResponse(
    (response) => response.url().includes("/facts/") && response.url().includes("/review") && response.request().method() === "POST" && response.ok()
  );
  await page.getByRole("button", { name: "Save correction" }).click();
  await saved;
  await expect(page.getByText("INCORRECT", { exact: true })).toBeVisible();

  await openDeal(page);
  const comparison = page.getByRole("heading", { name: "Paper and email" }).locator("xpath=ancestor::section[1]");
  await expect(comparison.getByText("Different", { exact: true })).toBeVisible();
  await expect(comparison.getByText("On the paper")).toBeVisible();
  await expect(comparison.getByText("In the latest reviewed email")).toBeVisible();
  await expect(comparison.getByText(/\$67/).first()).toBeVisible();
  await expect(comparison.getByText(/\$72/).first()).toBeVisible();

  const document = comparison.getByRole("link", { name: "View document" });
  const message = comparison.getByRole("link", { name: "View email" });
  await expect(document).toHaveAttribute("href", /\/documents\/.+\/review/);
  await expect(message).toHaveAttribute("href", /\/messages\//);
  await document.click();
  await expect(page.getByRole("heading", { name: "paper-67.pdf" })).toBeVisible();
  await page.goBack();
  await message.click();
  await expect(page.getByRole("heading", { name: "Revised rent misread" })).toBeVisible();

  await openDeal(page);
  const position = page.getByRole("heading", { name: "Current terms" }).locator("xpath=ancestor::section[1]");
  await expect(position.getByText(/\$67/).first()).toBeVisible();
  await expect(position.getByText(/\$72/)).toHaveCount(0);

  const db = e2eDb();
  const term = await db.negotiationTerm.findFirstOrThrow({
    where: { canonicalType: "BASE_RENT" },
    include: { formalTermReview: true },
  });
  expect(term.normalizedNumeric).toBe(67);
  expect(term.formalTermReview?.state).toBe("ACCEPTED");
  expect(await db.formalTermReview.count()).toBe(1);
});
