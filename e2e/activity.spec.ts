import path from "node:path";
import { analyzeMessage, createDeal, importEml } from "./helpers";
import { expect, test } from "./test";

test("activity lists an analyzed message once", async ({ page }) => {
  const dealPath = await createDeal(page, "Activity smoke");
  await importEml(page, path.join(process.cwd(), "fixtures/messages/acme-revised-rent.eml"));
  await analyzeMessage(page);
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("CONFIRMED", { exact: true })).toBeVisible();
  await page.goto(`${dealPath}/activity`);
  await expect(page.getByRole("heading", { name: "Deal activity / history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revised rent" })).toHaveCount(1);
});
