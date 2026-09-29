import path from "node:path";
import { analyzeMessage, createDeal, importEml, openDeal, openMessages } from "./helpers";
import { expect, test } from "./test";

const fixtures = path.join(process.cwd(), "fixtures/messages");

async function confirmAction(page: import("@playwright/test").Page, quote: string) {
  const review = page.getByRole("region", { name: "Action evidence" });
  const card = review.locator("article").filter({ hasText: quote });
  const saved = page.waitForResponse(
    (response) => response.url().includes("/actions/evidence") && response.request().method() === "POST" && response.ok()
  );
  await card.getByRole("button", { name: "Confirm" }).click();
  await saved;
  await expect(card.getByRole("button", { name: "Confirm" })).toHaveCount(0);
}

test("a reviewed request becomes a current action", async ({ page }) => {
  await createDeal(page, "Action evidence");
  await importEml(page, path.join(fixtures, "e2e-request-revised-proposal-friday.eml"));
  await analyzeMessage(page);
  await expect(page.getByText("Please send the revised proposal by Friday.", { exact: true }).first()).toBeVisible();
  await expect(page.locator("#action-evidence-review-heading")).toBeVisible();
  await confirmAction(page, "Please send the revised proposal by Friday.");
  await openDeal(page);
  const actions = page.locator("#actions");
  await expect(actions.getByText("Please send the revised proposal by Friday.").first()).toBeVisible();
  await expect(actions.getByText("Our side").first()).toBeVisible();
});

test("accepted fulfillment closes only the targeted request", async ({ page }) => {
  await createDeal(page, "Targeted fulfillment");
  await importEml(page, path.join(fixtures, "e2e-request-revised-proposal-friday.eml"));
  await analyzeMessage(page);
  await confirmAction(page, "Please send the revised proposal by Friday.");

  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-request-insurance.eml"));
  await analyzeMessage(page);
  await confirmAction(page, "Please send the insurance certificate by Friday.");

  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-fulfill-revised-proposal.eml"));
  await analyzeMessage(page, "Our side");
  await expect(page.getByText("Appears to fulfill")).toBeVisible();
  await expect(page.getByText("Please send the revised proposal by Friday.").first()).toBeVisible();
  const saved = page.waitForResponse(
    (response) => response.url().includes("/actions/evidence") && response.request().method() === "POST" && response.ok()
  );
  await page.getByRole("button", { name: "Confirm" }).click();
  await saved;

  await openDeal(page);
  const actions = page.locator("#actions");
  await expect(actions.getByText("Please send the revised proposal by Friday.")).toHaveCount(0);
  await expect(actions.getByText("Please send the insurance certificate by Friday.").first()).toBeVisible();
});

test("ambiguous fulfillment requires a choice and None closes nothing", async ({ page }) => {
  await createDeal(page, "Ambiguous fulfillment");
  await importEml(page, path.join(fixtures, "e2e-request-revised-proposal-friday.eml"));
  await analyzeMessage(page);
  await confirmAction(page, "Please send the revised proposal by Friday.");
  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-request-revised-proposal-monday.eml"));
  await analyzeMessage(page);
  await confirmAction(page, "Please send the revised proposal by Monday.");
  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-fulfill-revised-proposal.eml"));
  await analyzeMessage(page, "Our side");
  await expect(page.getByText("Which request does this fulfill?")).toBeVisible();
  await page.getByRole("radio", { name: /None \/ cannot determine/ }).check();
  const saved = page.waitForResponse(
    (response) => response.url().includes("/actions/evidence") && response.request().method() === "POST" && response.ok()
  );
  await page.getByRole("button", { name: "Confirm" }).click();
  await saved;
  await openDeal(page);
  const actions = page.locator("#actions");
  await expect(actions.getByText("Please send the revised proposal by Friday.").first()).toBeVisible();
  await expect(actions.getByText("Please send the revised proposal by Monday.").first()).toBeVisible();
});

test("choosing one ambiguous request closes only that request", async ({ page }) => {
  await createDeal(page, "Choose one request");
  await importEml(page, path.join(fixtures, "e2e-request-revised-proposal-friday.eml"));
  await analyzeMessage(page);
  await confirmAction(page, "Please send the revised proposal by Friday.");
  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-request-revised-proposal-monday.eml"));
  await analyzeMessage(page);
  await confirmAction(page, "Please send the revised proposal by Monday.");
  await openMessages(page);
  await importEml(page, path.join(fixtures, "e2e-fulfill-revised-proposal.eml"));
  await analyzeMessage(page, "Our side");
  await page.getByRole("radio", { name: /Please send the revised proposal by Friday/ }).check();
  const saved = page.waitForResponse(
    (response) => response.url().includes("/actions/evidence") && response.request().method() === "POST" && response.ok()
  );
  await page.getByRole("button", { name: "Confirm" }).click();
  await saved;
  await openDeal(page);
  const actions = page.locator("#actions");
  await expect(actions.getByText("Please send the revised proposal by Friday.")).toHaveCount(0);
  await expect(actions.getByText("Please send the revised proposal by Monday.").first()).toBeVisible();
});
