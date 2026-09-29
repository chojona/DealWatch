import path from "node:path";
import { createDeal, e2eDb, openDeal, uploadPdf, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

test("a reviewer corrects a wrong formal extraction without changing the raw term", async ({ page }) => {
  await createDeal(page, "Formal correction");
  const file = writeTextPdf(
    "wrong-rent.pdf",
    "Base Rent: $45.00 per rentable square foot per year\nE2E_EXTRACT_BASE_RENT:54"
  );
  await uploadPdf(page, file, { date: "2026-09-15" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Review document" }).first().click();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await expect(page.getByText(/Extracted value/).first()).toBeVisible();
  await expect(page.getByText("$54.00 / RSF / yr").first()).toBeVisible();
  await page.getByRole("button", { name: "Correct value" }).click();
  await page.getByLabel("Corrected base rent ($ / RSF / year)").fill("45");
  await page.getByLabel("Reviewed text").fill("$45");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("Reviewed correction")).toBeVisible();
  await expect(page.getByText(/\$54\.00 \/ RSF \/ yr/).first()).toBeVisible();

  const db = e2eDb();
  const term = await db.negotiationTerm.findFirstOrThrow({
    where: { canonicalType: "BASE_RENT" },
    include: { formalTermReview: true },
  });
  expect(term.rawValue).toBe("$54");
  expect(term.normalizedNumeric).toBe(54);
  expect(term.formalTermReview?.state).toBe("CORRECTED");
  expect(term.formalTermReview?.normalizedNumeric).toBe(45);

  await openDeal(page);
  await expect(page.getByText(/\$45/).first()).toBeVisible();
  await page.getByRole("link", { name: "Negotiation", exact: true }).click();
  await expect(page.getByText(/\$45/).first()).toBeVisible();
});

test("document analysis can fail once and retry without a second round", async ({ page }) => {
  await createDeal(page, "Document retry");
  const file = writeTextPdf(
    "fail-once.pdf",
    "E2E_FAIL_ONCE\nBase Rent: $67.00 per rentable square foot per year"
  );
  await uploadPdf(page, file, { date: "2026-09-15" });
  await expect(page.getByText("Analysis failed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Negotiation analysis failed/)).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: /Retry analysis|View failure|Review document/ }).first().click();
  await expect(page.getByRole("heading", { name: "Analysis failed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry analysis" })).toBeVisible();
  await page.getByRole("button", { name: "Retry analysis" }).click();
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();

  const db = e2eDb();
  const rounds = await db.negotiationRound.count();
  const terms = await db.negotiationTerm.count({ where: { canonicalType: "BASE_RENT" } });
  expect(rounds).toBe(1);
  expect(terms).toBe(1);
  const document = await db.document.findFirstOrThrow();
  expect(document.ingestionStatus).toBe("COMPLETE");
  expect(document.failureReason).toBeNull();
});

test("the checked-in acquisition PDF reaches formal review", async ({ page }) => {
  await createDeal(page, "Acme paper");
  await uploadPdf(page, path.join(process.cwd(), "fixtures/documents/acme-acquisition-loi.pdf"), {
    date: "2026-09-15",
  });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Review document" }).first().click();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await page.getByRole("button", { name: "Accept value" }).click();
  await expect(page.getByText("Accepted extraction")).toBeVisible();
});
