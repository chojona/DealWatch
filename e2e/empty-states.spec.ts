import { createDeal } from "./helpers";
import { expect, test } from "./test";

test("fresh surfaces explain that no evidence exists yet", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "No deals yet" })).toBeVisible();
  await page.goto("/deals");
  await page.getByPlaceholder("Search deals...").fill("nothing-here");
  await expect(page.getByText(/No deals match/)).toBeVisible();

  await createDeal(page, "Empty Deal");
  await expect(page.getByRole("heading", { name: "Add your first source" })).toBeVisible();
  const actions = page.locator("#actions");
  await expect(actions.getByText("No explicit action is waiting.")).toBeVisible();
  await expect(actions.getByText("No unresolved follow-ups.")).toBeVisible();

  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page.getByText("No sources yet")).toBeVisible();
  await page.getByRole("link", { name: "Messages" }).click();
  await expect(page.getByText("No messages yet")).toBeVisible();
  await page.getByRole("link", { name: "Negotiation" }).click();
  await expect(page.getByText("No negotiation rounds yet")).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("No sources yet")).toBeVisible();
});
