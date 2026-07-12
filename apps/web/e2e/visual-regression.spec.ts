import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { attemptId, attemptPlan } from "./test-fixtures";

const SCHEME_NAME = "48 Rose St Owners Corporation";

async function createVisualFixture(page: Page, managerEmail: string, plan: string) {
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("Demo Manager");
  await page.getByPlaceholder("you@example.com").fill(managerEmail);
  await page.getByPlaceholder("Choose a password").fill("visual-review-pass-123");
  await page.getByPlaceholder("e.g. 48 Rose St, Fitzroy").fill(SCHEME_NAME);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.getByPlaceholder("e.g. PS543210V").fill(plan);
  await page.getByPlaceholder("Street address").fill("48 Rose Street");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();
}

async function compareScreenshot(page: Page, name: string, testInfo: TestInfo) {
  // The checked-in baselines are generated on macOS. Linux still exercises
  // the complete responsive/theme journey without comparing unlike renderers.
  // CI retries also use a different unique plan number than the baseline.
  if (process.platform !== "darwin" || testInfo.retry > 0) return;
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    fullPage: false,
  });
}

test("scheme shell stays visually stable across responsive modes and themes", async ({
  page,
}, testInfo) => {
  const id = attemptId(testInfo);
  await createVisualFixture(
    page,
    `visual.manager.${id}@example.com`,
    testInfo.retry === 0 ? "PS543210V" : attemptPlan("65", "V", testInfo),
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByTestId("onboarding-checklist")).toBeVisible();
  await compareScreenshot(page, "scheme-overview-desktop-light.png", testInfo);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await compareScreenshot(page, "scheme-overview-desktop-dark.png", testInfo);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Scheme sections" })).toBeVisible();
  await expect(page.getByText(SCHEME_NAME, { exact: true }).first()).toBeVisible();
  await compareScreenshot(page, "scheme-overview-mobile-light.png", testInfo);

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("link", { name: "Maintenance", exact: true }).click();
  await page.getByRole("button", { name: "Report an issue" }).first().click();
  await expect(page.getByRole("dialog", { name: "Report a maintenance issue" })).toBeVisible();
  await compareScreenshot(page, "maintenance-report-sheet-mobile-light.png", testInfo);

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByRole("navigation", { name: "Scheme sections" })).toBeVisible();
  await compareScreenshot(page, "scheme-maintenance-tablet-light.png", testInfo);
});
