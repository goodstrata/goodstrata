import { expect, test } from "@playwright/test";

const SCHEME_NAME = "48 Rose St Owners Corporation";

async function createVisualFixture(page: import("@playwright/test").Page) {
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("Demo Manager");
  await page.getByPlaceholder("you@example.com").fill("visual.manager@example.com");
  await page.getByPlaceholder("Choose a password").fill("visual-review-pass-123");
  await page.getByPlaceholder("e.g. 48 Rose St, Fitzroy").fill(SCHEME_NAME);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page.getByPlaceholder("e.g. PS543210V").fill("PS543210V");
  await page.getByPlaceholder("Street address").fill("48 Rose Street");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();
}

test("scheme shell stays visually stable across responsive modes and themes", async ({ page }) => {
  await createVisualFixture(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page).toHaveScreenshot("scheme-overview-desktop-light.png", {
    animations: "disabled",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page).toHaveScreenshot("scheme-overview-desktop-dark.png", {
    animations: "disabled",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Scheme sections" })).toBeVisible();
  await expect(page.getByText(SCHEME_NAME, { exact: true }).first()).toBeVisible();
  await expect(page).toHaveScreenshot("scheme-overview-mobile-light.png", {
    animations: "disabled",
    fullPage: true,
  });

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("link", { name: "Maintenance", exact: true }).click();
  await page.getByRole("button", { name: "Report an issue" }).first().click();
  await expect(page.getByRole("dialog", { name: "Report a maintenance issue" })).toBeVisible();
  await expect(page).toHaveScreenshot("maintenance-report-sheet-mobile-light.png", {
    animations: "disabled",
    fullPage: true,
  });

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.getByRole("navigation", { name: "Scheme sections" })).toBeVisible();
  await expect(page).toHaveScreenshot("scheme-maintenance-tablet-light.png", {
    animations: "disabled",
    fullPage: true,
  });
});
