import { createDeal } from "./helpers";
import { expect, test } from "./test";

test("deal search finds a name and a company inside the workspace", async ({ page }) => {
  await createDeal(page, "Acme Acquisition", { company: "Northwind Labs", property: "1 Acme Plaza" });
  await createDeal(page, "Beta Warehouse", { company: "Other Storage", property: "9 Dock Street" });
  await page.goto("/deals");
  await page.getByRole("searchbox", { name: "Search deals" }).fill("Northwind");
  await expect(page.getByRole("link", { name: "Acme Acquisition" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Beta Warehouse" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search deals" }).fill("Beta Warehouse");
  await expect(page.getByRole("link", { name: "Beta Warehouse" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Acme Acquisition" })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search deals" }).fill("missing-deal-xyz");
  await expect(page.getByText(/No deals match/)).toBeVisible();
});
