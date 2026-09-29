import { createDeal, uploadPdfStoppingAnalysis, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

const CRE_REVIEW_FIXTURE_TEXT = [
  "TEST / FICTIONAL. Synthetic DealWatch integration data.",
  "This is not a customer document.",
  "Base Rent shall be $72.00 per rentable square foot.",
  "Tenant Improvement Allowance shall be $85.00 per rentable square foot.",
  "Free Rent shall be three months.",
  "Lease Term shall be seven years.",
  "Sarah Chen is a broker at Harbor Brokerage.",
  "Sarah Chen of Harbor Brokerage represents Northwind Labs.",
  "Tenant is Northwind Labs.",
  "Landlord is Clarendon Holdings.",
  "Property is 500 Test Street, Boston.",
  "Clarendon Holdings owns 500 Test Street.",
].join("\n");

test("a reviewer can canonicalize a pending company and open its provenance", async ({ page }) => {
  const dealPath = await createDeal(page, "Knowledge smoke");
  const file = writeTextPdf("harbor-knowledge.pdf", CRE_REVIEW_FIXTURE_TEXT);
  await uploadPdfStoppingAnalysis(page, file, { date: "2026-09-15", type: "LOI" });
  await page.getByRole("link", { name: /Analyze document|View document/ }).first().click();
  await page.getByLabel("Authoring side").selectOption("LANDLORD");
  await page.getByLabel("Document date").fill("2026-09-15");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await page.getByRole("button", { name: "Analyze document" }).click();
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Entities" }).click();
  await page.getByRole("button", { name: "Create Company" }).first().click();
  await page.getByRole("button", { name: "Create Company" }).last().click();
  await expect(page.getByText(/Harbor Brokerage|Northwind Labs|Clarendon Holdings/).first()).toBeVisible();
  await page.goto(`${dealPath}/knowledge`);
  await expect(page.getByRole("heading", { name: "Confirmed on this deal" })).toBeVisible();
  await expect(page.getByText(/Harbor Brokerage|Northwind Labs|Clarendon Holdings/).first()).toBeVisible();
});
