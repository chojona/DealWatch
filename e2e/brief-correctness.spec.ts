import { createDeal, e2eDb, openDeal, uploadPdf, writeTextPdf } from "./helpers";
import { expect, test } from "./test";

const ATTENTION_BOARD = [
  "E2E_ATTENTION_BOARD",
  "BASE_RENT is PROPOSED",
  "TI_ALLOWANCE is UNRESOLVED",
  "LEASE_TERM is AGREED",
  "FREE_RENT is REJECTED",
  "SECURITY_DEPOSIT is WITHDRAWN",
  "PARKING is PROPOSED",
  "RENEWAL_OPTIONS is PROPOSED",
  "EXPANSION_RIGHTS is PROPOSED",
  "ASSIGNMENT_SUBLETTING is PROPOSED",
  "DELIVERY_CONDITION is PROPOSED",
].join("\n");

test("rejecting a formal extraction stays Rejected and out of the open count", async ({ page }) => {
  await createDeal(page, "Rejected term");
  const file = writeTextPdf("rejected.pdf", "Base Rent: $67.00 per rentable square foot per year");
  await uploadPdf(page, file, { date: "2026-09-15" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Review document" }).first().click();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Paper value · Rejected")).toBeVisible();
  await expect(page.getByText("This value is not part of the current paper position.")).toBeVisible();

  await openDeal(page);
  const position = page.getByRole("heading", { name: "Current terms" }).locator("xpath=ancestor::section[1]");
  await expect(position.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(position.getByText("Open", { exact: true })).toHaveCount(0);
  await expect(position.getByText("0 open")).toBeVisible();

  const db = e2eDb();
  const term = await db.negotiationTerm.findFirstOrThrow({ include: { formalTermReview: true } });
  expect(term.rawValue).toContain("67");
  expect(term.formalTermReview?.state).toBe("REJECTED");
  expect(term.normalizedNumeric).toBe(67);
});

test("a withdrawn extraction renders Withdrawn", async ({ page }) => {
  await createDeal(page, "Withdrawn term");
  const file = writeTextPdf(
    "withdrawn.pdf",
    "Base Rent: $67.00 per rentable square foot per year\nE2E_STATUS:WITHDRAWN"
  );
  await uploadPdf(page, file, { date: "2026-09-15" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  const position = page.getByRole("heading", { name: "Current terms" }).locator("xpath=ancestor::section[1]");
  await expect(position.getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect(position.getByText("Open", { exact: true })).toHaveCount(0);
  await expect(position.getByText("0 open")).toBeVisible();
});

test("attention shows the first six items and reveals the remainder", async ({ page }) => {
  await createDeal(page, "Attention remainder");
  const file = writeTextPdf("attention.pdf", ATTENTION_BOARD);
  await uploadPdf(page, file, { date: "2026-09-15" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Overview" }).click();
  const attention = page.getByRole("heading", { name: "Needs you" }).locator("xpath=ancestor::section[1]");
  await expect(attention.getByRole("listitem")).toHaveCount(6);
  const more = attention.getByText(/\+ \d+ more items need attention/);
  await expect(more).toBeVisible();
  const hiddenLabel = attention.locator("details").getByRole("listitem").first();
  await expect(hiddenLabel).toBeHidden();
  await more.click();
  await expect(attention.locator("details").getByRole("listitem").first()).toBeVisible();
  const visible = await attention.getByRole("listitem").count();
  expect(visible).toBeGreaterThan(6);
});

test("a later formal source moves the current position and keeps the earlier paper", async ({ page }) => {
  await createDeal(page, "Formal movement");
  const earlier = writeTextPdf("earlier-72.pdf", "Base Rent: $72.00 per rentable square foot per year");
  const later = writeTextPdf("later-67.pdf", "Base Rent: $67.00 per rentable square foot per year");
  await uploadPdf(page, earlier, { date: "2026-09-01" });
  await expect(page.getByText("Analysis complete", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Review document" }).first().click();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await page.getByRole("button", { name: "Accept value" }).click();
  await expect(page.getByText("Paper value · Confirmed")).toBeVisible();

  await openDeal(page);
  await page.getByRole("link", { name: "Documents" }).click();
  await uploadPdf(page, later, { date: "2026-09-20", type: "PROPOSAL" });
  await expect(page.getByText("Analysis complete", { exact: true }).last()).toBeVisible();
  await page.getByRole("link", { name: "Review document" }).last().click();
  await page.getByRole("tab", { name: "Negotiation" }).click();
  await page.getByRole("button", { name: "Accept value" }).click();
  await expect(page.getByText("Paper value · Confirmed")).toBeVisible();

  await openDeal(page);
  const position = page.getByRole("heading", { name: "Current terms" }).locator("xpath=ancestor::section[1]");
  await expect(position.getByText(/\$67/)).toBeVisible();
  await page.getByRole("link", { name: "Negotiation", exact: true }).click();
  await expect(page.getByText("Base rent: $72.00 / RSF / yr → $67.00 / RSF / yr").first()).toBeVisible();
  await expect(page.getByText("Base rent: $72.00 / RSF / yr", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Deal activity / history" })).toBeVisible();
  await expect(page.getByText("later-67.pdf").first()).toBeVisible();
});
