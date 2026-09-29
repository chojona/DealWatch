import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_FLAGS, E2E_PORT } from "./e2e/env";

const baseURL = `http://127.0.0.1:${E2E_PORT}`;

process.env.DATABASE_URL = E2E_DATABASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npx next dev --hostname 127.0.0.1 --port ${E2E_PORT}`,
    url: `${baseURL}/dashboard`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_URL: E2E_DATABASE_URL,
      ...E2E_FLAGS,
    },
  },
});
