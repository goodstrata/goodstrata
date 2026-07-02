// Visual review capture: logs in as a demo user and screenshots every
// page/tab at mobile + desktop widths into apps/web/visual-review/.
//
// Usage:
//   BASE_URL=http://localhost:5299 node scripts/visual-capture.mjs
//   ROLE=owner BASE_URL=… node scripts/visual-capture.mjs   (captures owner-* shots)
//
// Console errors/warnings seen during the run are printed at the end.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:5299";
const ROLE = process.env.ROLE === "owner" ? "owner" : "committee";
const DEMO_BUTTON = ROLE === "owner" ? /Enter as Lot owner/ : /Enter as Committee/;
const PREFIX = ROLE === "owner" ? "owner-" : "";
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
const consoleIssues = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleIssues.push(`[${vp.name}/${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => consoleIssues.push(`[${vp.name}/pageerror] ${err.message}`));
  const shot = (name, opts = {}) =>
    page.screenshot({
      path: path.join(OUT, `${PREFIX}${vp.name}-${name}.png`),
      fullPage: true,
      ...opts,
    });

  // --- login page ---
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await shot("login");

  // --- sign in (demo button if present, else the form) ---
  const demoButton = page.getByRole("button", { name: DEMO_BUTTON }).first();
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
    await page.getByRole("button", { name: "All runs" }).click();
  }

  // --- lot statement dialog (from the lots table) ---
  await page.getByRole("tab", { name: "lots" }).click();
  await page.waitForTimeout(400);
  const statement = page.getByTestId(/statement-lot-/).first();
  if (await statement.isVisible().catch(() => false)) {
    await statement.click();
    await page.waitForTimeout(500);
    await shot("dialog-lot-statement", { fullPage: false });
    await page.keyboard.press("Escape");
  }

  // --- document viewer dialog ---
  await page.getByRole("tab", { name: "documents" }).click();
  await page.waitForTimeout(400);
  const view = page.getByRole("button", { name: /^View / }).first();
  if (await view.isVisible().catch(() => false)) {
    await view.click();
    await page.waitForTimeout(500);
    await shot("dialog-document-view", { fullPage: false });
    await page.keyboard.press("Escape");
  }

  // --- dialogs (one per viewport is enough to validate sizing) ---
  if (ROLE === "committee") {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New scheme" }).click();
    await page.waitForTimeout(300);
    await shot("dialog-new-scheme", { fullPage: false });
  }

  await context.close();
  console.log(`captured ${PREFIX}${vp.name}`);
}

await browser.close();
if (consoleIssues.length > 0) {
  console.log("\nConsole issues seen:");
  for (const line of [...new Set(consoleIssues)]) console.log(`  ${line}`);
} else {
  console.log("\nNo console errors or warnings.");
}
console.log(`done → ${OUT}`);
