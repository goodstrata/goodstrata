// Visual review capture: logs in as the demo committee user and screenshots
// every page/tab at mobile + desktop widths into apps/web/visual-review/.
//
// Usage: BASE_URL=http://localhost:5299 node scripts/visual-capture.mjs
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:5299";
const EMAIL = process.env.DEMO_EMAIL ?? "demo@goodstrata.local";
const PASSWORD = process.env.DEMO_PASSWORD ?? "goodstrata-demo";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "visual-review");
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
];

const TABS = [
  "overview",
  "finance",
  "maintenance",
  "meetings",
  "decisions",
  "agents",
  "lots",
  "people",
  "committee",
  "documents",
  "activity",
];

const browser = await chromium.launch();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const page = await context.newPage();
  const shot = (name, opts = {}) =>
    page.screenshot({ path: path.join(OUT, `${vp.name}-${name}.png`), fullPage: true, ...opts });

  // --- login page ---
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await shot("login");

  // --- sign in (demo button if present, else the form) ---
  const demoButton = page.getByRole("button", { name: /Enter as/ }).first();
  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click();
  } else {
    await page.getByPlaceholder("Email").fill(EMAIL);
    await page.getByPlaceholder("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.waitForURL(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await shot("home");

  // --- scheme page tabs ---
  await page.locator('a[href^="/schemes/"]').first().click();
  await page.getByRole("tab", { name: "Overview" }).waitFor();
  for (const tab of TABS) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await shot(`tab-${tab}`);
  }

  // --- drill-downs worth reviewing ---
  await page.getByRole("tab", { name: "meetings" }).click();
  await page.waitForTimeout(400);
  const meeting = page.locator("button", { hasText: /(AGM|SGM|COMMITTEE) ·/ }).first();
  if (await meeting.isVisible().catch(() => false)) {
    await meeting.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await shot("meeting-detail");
    await page.getByRole("button", { name: "All meetings" }).click();
  }

  await page.getByRole("tab", { name: "agents" }).click();
  await page.waitForTimeout(600);
  const run = page.locator('[data-testid="agent-runs"] > button').first();
  if (await run.isVisible().catch(() => false)) {
    await run.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    await shot("agent-run-detail");
  }

  // --- dialogs (one per viewport is enough to validate sizing) ---
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "New scheme" }).click();
  await page.waitForTimeout(300);
  await shot("dialog-new-scheme", { fullPage: false });

  await context.close();
  console.log(`captured ${vp.name}`);
}

await browser.close();
console.log(`done → ${OUT}`);
