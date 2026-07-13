import { expect, test } from "@playwright/test";

const API = "http://localhost:3105";

// Fresh identities per run so the spec is re-runnable against a persistent
// local stack (not just the throwaway gs_e2e database).
const runId = Date.now().toString(36);
const MANAGER_EMAIL = `casey.${runId}@example.com`;
const OWNER_EMAIL = `owner.${runId}@example.com`;
const SCHEME_NAME = "12 Acacia Lane Owners Corporation";

test("cold path: fresh signup → guided wizard → scheme overview", async ({ page }) => {
  // --- Sign up with a fresh email, including the building-name handoff ---
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await expect(page).toHaveURL(/\/signup/);
  await page.getByPlaceholder("Your name").fill("Casey Manager");
  await page.getByPlaceholder("you@example.com").fill(MANAGER_EMAIL);
  await page.getByPlaceholder("Choose a password").fill("cold-path-pass-123");
  await page.getByPlaceholder("e.g. 48 Rose St, Fitzroy").fill(SCHEME_NAME);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  // --- Wizard step 1: building name prefilled from the signup handoff ---
  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await expect(page.getByPlaceholder("e.g. 48 Rose St Owners Corporation")).toHaveValue(
    SCHEME_NAME,
  );
  await page.getByPlaceholder("e.g. PS543210V").fill("PS600100K");
  await page.getByPlaceholder("Street address").fill("12 Acacia Lane");
  await page.getByPlaceholder("Suburb").fill("Brunswick");
  await page.getByPlaceholder("Postcode").fill("3056");
  await page.getByRole("button", { name: "Create building & continue" }).click();

  // --- Wizard step 2: equal-share lots ---
  await expect(page.getByRole("heading", { name: "Add your lots" })).toBeFocused();
  await page.getByPlaceholder("e.g. 8").fill("6");
  await page.getByRole("button", { name: "Add lots & continue" }).click();

  // --- Wizard step 3: invite an owner ---
  await expect(page.getByRole("heading", { name: /Invite your committee/ })).toBeFocused();
  await page.getByPlaceholder("name@example.com").fill(OWNER_EMAIL);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(OWNER_EMAIL)).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();

  // --- Finish screen, then land on the scheme's Overview ---
  await expect(page.getByRole("heading", { name: `${SCHEME_NAME} is set up` })).toBeFocused();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page).toHaveURL(/\/schemes\//);
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();

  // Overview is the pre-activation checklist: lots done, insurance pending,
  // so activation stays gated.
  const checklist = page.getByTestId("onboarding-checklist");
  await expect(checklist).toBeVisible();
  const lotsStep = checklist.getByRole("listitem").filter({ hasText: "Lots imported" });
  await expect(lotsStep.getByText("complete", { exact: true })).toHaveCount(1);
  const insuranceStep = checklist.getByRole("listitem").filter({ hasText: "Insurance" });
  await expect(insuranceStep.getByText("incomplete", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Activate scheme" })).toBeDisabled();

  // The wizard's invite went out with a join link (dev memory outbox).
  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const invite = outbox.emails.find((e: { to: string; text: string }) => e.to === OWNER_EMAIL);
  expect(invite).toBeTruthy();
  expect(invite.text).toMatch(/\/join\?token=/);
});
