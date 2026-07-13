import { expect, type Page, test } from "@playwright/test";

const runId = Date.now().toString(36);

async function signUpViaApi(page: Page, suffix: string) {
  const email = `${suffix}.${runId}@example.com`;
  const response = await page.request.post("/api/auth/sign-up/email", {
    data: { name: "Avery Accessible", email, password: "accessible-pass-123" },
  });
  expect(response.ok()).toBeTruthy();
  return email;
}

test("auth routes expose useful titles, route focus and mobile form semantics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/login");

  await expect(page).toHaveTitle("Sign in | GoodStrata");
  const email = page.getByRole("textbox", { name: "Email" });
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(email).toHaveAttribute("autocapitalize", "none");
  await expect(email).toHaveAttribute("enterkeyhint", "next");
  await expect(page.locator("#signin-password")).toHaveAttribute("enterkeyhint", "go");

  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await expect(page).toHaveTitle("Create an account | GoodStrata");
  await expect(page.locator("#main")).toBeFocused();
  await expect(page.getByTestId("route-announcer")).toHaveText("Create an account");

  // The action remains discoverable before consent; submitting explains the
  // missing agreement instead of presenting an inert button.
  await page.getByPlaceholder("Your name").fill("Avery Accessible");
  await page.getByPlaceholder("you@example.com").fill(`consent.${runId}@example.com`);
  await page.getByPlaceholder("Choose a password").fill("accessible-pass-123");
  const create = page.getByRole("button", { name: "Create account" });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByRole("alert")).toContainText(/accept the Terms and Privacy Policy/i);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("settings panels title deep links and stay within a narrow viewport", async ({ page }) => {
  await signUpViaApi(page, "settings-a11y");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/settings?section=security");

  await expect(page).toHaveTitle("Security settings | GoodStrata");
  await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change password" })).toBeVisible();

  await page.getByRole("tab", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/section=notifications/);
  await expect(page).toHaveTitle("Notification settings | GoodStrata");
  await expect(page.getByTestId("route-announcer")).toHaveText("Notification settings");
  await expect(page.getByRole("tab", { name: "Notifications" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("failed sign-out stays in place and explains how to recover", async ({ page }) => {
  await signUpViaApi(page, "signout-failure");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();

  await page.route("**/api/auth/sign-out", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Service unavailable" }),
    });
  });
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Couldn't sign you out. Check your connection and try again.",
  );
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});
