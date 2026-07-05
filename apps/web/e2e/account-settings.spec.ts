import { expect, type Page, test } from "@playwright/test";

/**
 * Account settings (/settings) — the two highest-value journeys across the
 * profile & security permutation matrix. Server-side permutations live in
 * apps/api/src/account-settings-permutations.test.ts; this spec covers the
 * client-side validation, toasts and state transitions the UI owns.
 */

// Fresh identities per run so the spec is re-runnable against a persistent
// local stack (same convention as signup-onboarding.spec.ts).
const runId = Date.now().toString(36);

// Tiny valid 1x1 transparent PNG so the <img> the avatar renders is real.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function signUpViaApi(page: Page, opts: { name: string; email: string; password: string }) {
  // The vite dev server proxies /api to the API; page.request shares the
  // browser context's cookie jar, so the session cookie lands in the page.
  const res = await page.request.post("/api/auth/sign-up/email", { data: opts });
  expect(res.ok()).toBeTruthy();
}

test("profile: display-name validation, email change pending state, avatar guard rails", async ({
  page,
}) => {
  const email = `profile.${runId}@example.com`;
  await signUpViaApi(page, { name: "Priya Profile", email, password: "profile-pass-123" });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Account settings" })).toBeVisible();

  // --- Display name ---
  const nameInput = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(nameInput).toHaveValue("Priya Profile");
  const saveName = page.getByRole("button", { name: "Save name" });
  // Unchanged name → submit disabled (nothing to save).
  await expect(saveName).toBeDisabled();

  // Empty name → client validation error, no toast.
  await nameInput.fill("");
  await saveName.click();
  await expect(page.getByText("Enter a display name.")).toBeVisible();

  // 81 characters → max-length error (validation is live after first submit).
  await nameInput.fill("x".repeat(81));
  await expect(page.getByText("Keep it under 80 characters.")).toBeVisible();

  // Valid rename → success toast, and the button disables once the refreshed
  // session name matches the field again.
  await nameInput.fill("Priya Renamed");
  await saveName.click();
  await expect(page.getByText("Name saved")).toBeVisible();
  await expect(saveName).toBeDisabled();

  // --- Email ---
  const emailInput = page.getByRole("textbox", { name: "New email" });
  const sendConfirmation = page.getByRole("button", { name: "Send confirmation" });

  // Grossly invalid format → the browser's native email validation blocks the
  // submit before it reaches the form (input type="email"), so no request and
  // no pending alert can appear.
  await emailInput.fill("not-an-email");
  await sendConfirmation.click();
  expect(await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
  await expect(page.getByText("Confirm your new address")).toHaveCount(0);

  // Email-shaped but invalid per zod (no TLD) → passes the native check and
  // surfaces the app's own field error.
  await emailInput.fill("user@localhost");
  await sendConfirmation.click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  // Same as current → the client-side throw surfaces as a form-level error.
  await emailInput.fill(email);
  await sendConfirmation.click();
  await expect(page.getByText("That's already your email address.")).toBeVisible();

  // A genuinely new address → pending alert + form reset; the confirmation
  // email lands in the dev outbox (unverified signup → mail goes to the NEW
  // address per better-auth's change-email flow).
  const nextEmail = `profile.next.${runId}@example.com`;
  await emailInput.fill(nextEmail);
  await sendConfirmation.click();
  await expect(page.getByText("Confirm your new address")).toBeVisible();
  await expect(page.getByText(nextEmail)).toBeVisible();
  await expect(emailInput).toHaveValue(""); // form reset
  // Still shows (and signs in as) the old address until the link is followed.
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const outbox = await (await page.request.get("/dev/outbox")).json();
      return outbox.emails.some((e: { to: string }) => e.to === nextEmail);
    })
    .toBe(true);

  // --- Avatar ---
  const fileInput = page.locator('input[type="file"]');

  // Non-image file → client pre-check toast, nothing uploaded.
  await fileInput.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("Choose an image file.")).toBeVisible();

  // 5.1 MB image → client size guard toast, nothing uploaded.
  await fileInput.setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(Math.round(5.1 * 1024 * 1024), 7),
  });
  await expect(page.getByText("Keep images under 5 MB.")).toBeVisible();
  // Neither rejected pick ever produced an image: the button still says Upload.
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();

  // Valid PNG → uploads, toast, and the card flips to Replace/Remove.
  await fileInput.setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(page.getByText("Photo updated")).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace" })).toBeVisible();

  // Remove → toast, back to the upload-only state.
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Photo removed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("security: change-password permutations, sessions card, delete-account gauntlet", async ({
  page,
}) => {
  const email = `security.${runId}@example.com`;
  const password = "security-pass-123";
  await signUpViaApi(page, { name: "Sam Secure", email, password });
  await page.goto("/settings?section=security");

  // The accounts query resolves to a credential account → change form (not
  // the social-only "email me a link" card).
  const current = page.getByRole("textbox", { name: "Current password" });
  const fresh = page.getByRole("textbox", { name: "New password", exact: true });
  const confirm = page.getByRole("textbox", { name: "Confirm new password" });
  const submit = page.getByRole("button", { name: "Change password" });
  await expect(current).toBeVisible();

  // Confirm mismatch → field error, nothing sent.
  await current.fill(password);
  await fresh.fill("brand-new-pass-1");
  await confirm.fill("something-else-9");
  await submit.click();
  await expect(page.getByText("Passwords don't match.")).toBeVisible();

  // New password equal to current → field error on the new-password field.
  await fresh.fill(password);
  await confirm.fill(password);
  await expect(page.getByText("Choose a password you haven't used here.")).toBeVisible();

  // 7-character new password → min-length error.
  await fresh.fill("seven77");
  await confirm.fill("seven77");
  await expect(page.getByText("Use at least 8 characters.")).toBeVisible();

  // Wrong current password → the server rejection surfaces as a form error.
  await current.fill("wrong-current-0");
  await fresh.fill("brand-new-pass-1");
  await confirm.fill("brand-new-pass-1");
  await submit.click();
  await expect(page.getByText(/invalid password/i)).toBeVisible();

  // Success → toast, form reset.
  const rotated = "rotated-pass-456";
  await current.fill(password);
  await fresh.fill(rotated);
  await confirm.fill(rotated);
  await submit.click();
  await expect(page.getByText("Password changed. Other devices were signed out.")).toBeVisible();
  await expect(current).toHaveValue("");

  // Sessions card: only this device remains after the rotation — it carries
  // the badge, has no revoke button, and there's no "everywhere else" footer.
  await expect(page.getByText("This device")).toBeVisible();
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out everywhere else" })).toHaveCount(0);

  // --- Delete account gauntlet ---
  await page.getByRole("button", { name: "Delete my account" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete your account?")).toBeVisible();
  const confirmDelete = dialog.getByRole("button", { name: "Delete account" });
  const emailField = page.locator("#delete-confirm");
  const passwordField = page.locator("#delete-password");

  // Credential account → the dialog asks for the password too.
  await expect(passwordField).toBeVisible();
  await expect(confirmDelete).toBeDisabled();

  // Wrong email typed → still disabled, even with a password.
  await emailField.fill("someone-else@example.com");
  await passwordField.fill(rotated);
  await expect(confirmDelete).toBeDisabled();

  // Correct email but empty password → disabled.
  await emailField.fill(email);
  await passwordField.fill("");
  await expect(confirmDelete).toBeDisabled();

  // Correct email + wrong password → enabled, but the server refuses.
  await passwordField.fill("not-the-password");
  await expect(confirmDelete).toBeEnabled();
  await confirmDelete.click();
  await expect(page.getByText(/invalid password/i)).toBeVisible();

  // Correct password (the rotated one) → deleted, signed out, at /login.
  // (The success toast is immediately followed by a hard redirect, so the
  // durable assertion is the landing page, not the transient toast.)
  await passwordField.fill(rotated);
  await confirmDelete.click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  // The account is really gone: the old credentials no longer sign in.
  const back = await page.request.post("/api/auth/sign-in/email", {
    data: { email, password: rotated },
  });
  expect(back.status()).toBeGreaterThanOrEqual(400);
});
