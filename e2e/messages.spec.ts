import path from "node:path";
import { analyzeMessage, createDeal, e2eDb, importEml, openMessages, uploadPdf, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

const fixtures = path.join(process.cwd(), "fixtures/messages");

test("importing an .eml navigates to the message and keeps the source", async ({ page }) => {
  await createDeal(page, "Import email");
  await importEml(page, path.join(fixtures, "acme-revised-rent.eml"));
  await expect(page.getByRole("heading", { name: "Revised rent" })).toBeVisible();
  await expect(page.getByText("Derek Hollis")).toBeVisible();
  await expect(page.getByText("derek.hollis@harborrealty.example")).toBeVisible();
  await expect(page.getByText("The landlord can do $72.00 per RSF per year.")).toBeVisible();
  await expect(page.getByText(/Sep 22, 2026/)).toBeVisible();

  const db = e2eDb();
  expect(await db.sourceMessage.count()).toBe(1);
  expect(await db.formalTermReview.count()).toBe(0);
});

test("message analysis confirms, rejects, and corrects facts without writing formal truth", async ({ page }) => {
  await createDeal(page, "Message review");
  const paper = writeTextPdf("paper-67.pdf", "Base Rent: $67.00 per rentable square foot per year");
  await uploadPdf(page, paper, { date: "2026-09-15" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();

  await importEml(page, path.join(fixtures, "acme-revised-rent.eml"));
  await analyzeMessage(page);
  await expect(page.getByText("$72.00 / RSF / year").first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("CONFIRMED", { exact: true })).toBeVisible();

  const db = e2eDb();
  expect(await db.formalTermReview.count()).toBe(0);
  expect(await db.activityFact.count({ where: { factType: "NEGOTIATION_VALUE" } })).toBe(1);
  const term = await db.negotiationTerm.findFirstOrThrow({ where: { canonicalType: "BASE_RENT" } });
  expect(term.normalizedNumeric).toBe(67);

  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-reject-rent.eml"));
  await analyzeMessage(page);
  await page.getByRole("button", { name: "Reject fact" }).click();
  await expect(page.getByText("INCORRECT", { exact: true })).toBeVisible();
  const rejected = await db.activityFactReview.findFirstOrThrow({
    where: { state: "INCORRECT" },
    include: { correction: true },
  });
  expect(rejected.correction).toBeNull();

  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-misread-rent.eml"));
  await analyzeMessage(page);
  await expect(page.getByText("$27.00 / RSF / year").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark incorrect" }).click();
  await page.getByLabel("Corrected display").fill("$72.00 / RSF / year");
  await page.getByLabel("Numeric value").fill("72");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText("$72.00 / RSF / year").first()).toBeVisible();
  await expect(page.getByText("$27.00 / RSF / year").first()).toBeVisible();

  const misread = await db.activityFact.findFirstOrThrow({
    where: { sourceMessage: { subject: "Revised rent misread" }, canonicalType: "BASE_RENT" },
  });
  const payload = misread.structuredPayload as { numeric?: number };
  expect(payload.numeric).toBe(27);
  expect(term.normalizedNumeric).toBe(67);
});

test("message analysis fails once and retry keeps a single source", async ({ page }) => {
  await createDeal(page, "Message retry");
  await importEml(page, path.join(fixtures, "e2e-fail-once.eml"));
  const messageUrl = page.url();
  await page.getByRole("radio", { name: "Counterparty" }).check();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText(/Analysis failed: E2E message analysis failed once/)).toBeVisible();
  await page.getByRole("radio", { name: "Counterparty" }).check();
  await page.getByRole("button", { name: "Retry analysis" }).click();
  await expect(page.getByText("ANALYZED", { exact: true })).toBeVisible();
  await expect(page.getByText("$70.00 / RSF / year").first()).toBeVisible();
  expect(page.url()).toBe(messageUrl);

  const db = e2eDb();
  expect(await db.sourceMessage.count()).toBe(1);
  expect(await db.activityFact.count({ where: { canonicalType: "BASE_RENT" } })).toBe(1);
  const message = await db.sourceMessage.findFirstOrThrow({ include: { extractionRuns: true } });
  expect(message.extractionRuns.some((run) => run.status === "SUCCEEDED")).toBe(true);
  expect(message.extractionRuns.filter((run) => run.status === "SUCCEEDED")).toHaveLength(1);
});
