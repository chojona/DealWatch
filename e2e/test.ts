import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const response = await page.request.post("/api/e2e/reset");
    expect(response.ok(), await response.text()).toBeTruthy();
    await use(page);
  },
});

export { expect };
