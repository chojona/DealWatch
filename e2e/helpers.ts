import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { buildTextPdf } from "../lib/documents/minimalPdf";
import { E2E_DATABASE_URL } from "./env";

let database: PrismaClient | undefined;

export function e2eDb(): PrismaClient {
  database ??= new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL ?? E2E_DATABASE_URL } },
  });
  return database;
}

export function writeTextPdf(name: string, text: string): string {
  const dir = path.join(process.cwd(), "e2e/.state");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name.endsWith(".pdf") ? name : `${name}.pdf`);
  writeFileSync(file, buildTextPdf([text]));
  return file;
}

export async function createDeal(
  page: Page,
  name: string,
  extra?: { company?: string; property?: string }
): Promise<string> {
  await page.goto("/deals/new");
  await page.getByLabel("Deal name").fill(name);
  if (extra?.company) await page.getByLabel("Company").fill(extra.company);
  if (extra?.property) await page.getByLabel("Property").fill(extra.property);
  await page.getByRole("button", { name: "Create deal" }).click();
  await page.waitForURL(/\/deals\/(?!new$)[^/?#]+$/);
  return new URL(page.url()).pathname;
}

export async function uploadPdfStoppingAnalysis(
  page: Page,
  file: string,
  meta: { date: string; side?: "LANDLORD" | "TENANT"; type?: string }
) {
  let releaseStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    releaseStopped = resolve;
  });
  await page.route(/\/api\/documents\/[^/]+$/, async (route) => {
    if (route.request().method() === "POST") {
      await route.abort();
      releaseStopped();
      return;
    }
    await route.continue();
  });
  await uploadPdf(page, file, meta);
  await stopped;
  await page.unroute(/\/api\/documents\/[^/]+$/);
  await page.reload();
}

export async function uploadPdf(
  page: Page,
  file: string,
  meta: { date: string; side?: "LANDLORD" | "TENANT"; type?: string }
) {
  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Upload PDF" })).toBeVisible();
  await page.getByRole("button", { name: "Upload PDF" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Upload and analyze" }) });
  await form.locator('input[name="file"]').setInputFiles(file);
  await form.locator('select[name="side"]').selectOption(meta.side ?? "LANDLORD");
  await form.locator('select[name="documentType"]').selectOption(meta.type ?? "LOI");
  await form.locator('input[name="documentDate"]').fill(meta.date);
  await form.getByRole("button", { name: "Upload and analyze" }).click();
}

async function dealHref(page: Page): Promise<string | null> {
  const current = page.url().match(/\/deals\/([^/?#]+)/);
  if (current && current[1] !== "new") return `/deals/${current[1]}`;
  return page.locator('a[href^="/deals/"]').evaluateAll((nodes) => {
    const values = nodes.map((node) => node.getAttribute("href") ?? "");
    return values.find((value) => /^\/deals\/(?!new$)[^/]+$/.test(value)) ?? null;
  });
}

export async function openDeal(page: Page) {
  const href = await dealHref(page);
  if (!href) throw new Error("Could not find the deal");
  await page.goto(href);
  await expect(page.getByRole("link", { name: "Documents" })).toBeVisible();
}

export async function openMessages(page: Page) {
  if (/\/messages\/?$/.test(new URL(page.url()).pathname)) return;
  const messages = page.getByRole("link", { name: "Messages", exact: true });
  if (await messages.count()) {
    await messages.first().click();
    return;
  }
  const href = await dealHref(page);
  if (!href) throw new Error("Could not find the deal messages page");
  await page.goto(`${href}/messages`);
}

export async function importEml(page: Page, emlPath: string) {
  await openMessages(page);
  await page.getByRole("button", { name: ".eml file" }).click();
  await page.locator('input[name="file"]').setInputFiles(emlPath);
  await page.getByRole("button", { name: "Import .eml" }).click();
  await page.waitForURL(/\/messages\/[^/]+$/);
}

export async function analyzeMessage(page: Page, side: "Our side" | "Counterparty" | "Unknown" = "Counterparty") {
  await page.getByRole("radio", { name: side }).check();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("ANALYZED", { exact: true })).toBeVisible();
}
