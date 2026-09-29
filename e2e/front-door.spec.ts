import path from "node:path";
import { createDeal, uploadPdf, uploadPdfStoppingAnalysis, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

test("a fresh workspace shows the modern empty state and creates a deal in the browser", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "No deals yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create Deal" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Analyze Thread" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Analyze Thread" })).toHaveCount(0);

  const dealPath = await createDeal(page, "Acme Acquisition", {
    company: "Acme",
    property: "1 Acme Plaza",
  });
  await expect(page.getByRole("heading", { name: "Acme Acquisition" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add your first source" })).toBeVisible();
  expect(dealPath).toMatch(/^\/deals\/[^/]+$/);
});

test("uploading a PDF without a document date does not start analysis", async ({ page }) => {
  await createDeal(page, "Date gate");
  const file = writeTextPdf("date-gate.pdf", "Base Rent: $67.00 per rentable square foot per year");
  await page.getByRole("link", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload PDF" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Upload and analyze" }) });
  await form.locator('input[name="file"]').setInputFiles(file);
  await form.locator('select[name="side"]').selectOption("LANDLORD");
  await form.locator('select[name="documentType"]').selectOption("LOI");
  await form.getByRole("button", { name: "Upload and analyze" }).click();
  await expect(page.getByText("Analysis complete", { exact: true })).toHaveCount(0);
  await expect(form.locator('input[name="documentDate"]')).toBeVisible();
});

test("metadata must be complete before Analyze document runs", async ({ page }) => {
  await createDeal(page, "Analyze gate");
  const file = writeTextPdf("analyze-gate.pdf", "Base Rent: $67.00 per rentable square foot per year");
  await uploadPdfStoppingAnalysis(page, file, { date: "2026-09-15" });
  await page.getByRole("link", { name: /Analyze document|View document/ }).first().click();
  await expect(page.getByRole("heading", { name: "Ready to analyze" })).toBeVisible();
  await expect(page.getByLabel("Authoring side")).toHaveValue("LANDLORD");
  await expect(page.getByLabel("Document date")).toHaveValue("2026-09-15");
  await expect(page.getByRole("button", { name: "Analyze document" })).toBeEnabled();
  await page.getByRole("button", { name: "Analyze document" }).click();
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await expect(page.getByText("Base Rent: $67.00 per rentable square foot per year")).toBeVisible();
});

test("a checked-in LOI upload is persisted and ready for review", async ({ page }) => {
  await createDeal(page, "Upload LOI");
  const file = path.join(process.cwd(), "fixtures/documents/acme-acquisition-loi.pdf");
  await uploadPdf(page, file, { date: "2026-09-15", type: "LOI" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Review document" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Review document" }).first().click();
  await expect(page.getByRole("heading", { name: "acme-acquisition-loi.pdf" })).toBeVisible();
  await expect(page.getByText("Needs review", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await expect(page.getByText("Base Rent: $67.00 per rentable square foot per year")).toBeVisible();
});
