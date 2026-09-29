import { createDeal } from "./helpers";
import { expect, test } from "./test";

test("fresh surfaces explain that no evidence exists yet", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "No deals yet" })).toBeVisible();
  await page.goto("/deals");
  await page.getByRole("searchbox", { name: "Search deals" }).fill("nothing-here");
  await expect(page.getByText(/No deals match/)).toBeVisible();

  await createDeal(page, "Empty Deal");
  await expect(page.getByRole("heading", { name: "No sources yet" })).toBeVisible();
  await expect(page.getByText("Add a document or import an email to start building the deal.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload document" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import email" })).toBeVisible();

  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page.getByText("No sources yet")).toBeVisible();
  await page.getByRole("link", { name: "Messages" }).click();
  await expect(page.getByText("No messages yet")).toBeVisible();
  await page.getByRole("link", { name: "Negotiation" }).click();
  await expect(page.getByText("No negotiation rounds yet")).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("No sources yet")).toBeVisible();
});
