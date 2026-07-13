import { expect, test } from "@playwright/test";

const API = "http://localhost:3105";

// Fresh identity per run so the spec is re-runnable against a persistent
// local stack (same convention as signup-onboarding.spec.ts).
const runId = Date.now().toString(36);
const EMAIL = `quinn.${runId}@example.com`;
const PASSWORD = "first-pass-123";
const NEW_PASSWORD = "second-pass-456";

// The journeys build on each other (account created in the first is reset in
// the second and reused in the third), so keep them ordered.
test.describe.configure({ mode: "serial" });

test("sign-in permutations: field validation, wrong password banner, sign out, sign back in", async ({
  page,
}) => {
  // --- Create the account (consent gate, then straight in — dev has no
  // email-verification requirement, so token is present and we land on "/") ---
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("Quinn Owner");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Choose a password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();

  // --- Sign out from the account menu; the home page bounces to /login ---
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  // --- Required-empty: quiet until first submit, then per-field messages ---
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();

  // --- Invalid email format keeps the field error live (revalidateLogic) ---
  await page.getByPlaceholder("you@example.com").fill("not-an-email");
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();

  // --- Wrong credentials: form-level banner, and the form stays filled ---
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Your password").fill("totally-wrong-99");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(/invalid email or password/i);
  await expect(page.getByPlaceholder("you@example.com")).toHaveValue(EMAIL);
  await expect(page.getByPlaceholder("Your password")).toHaveValue("totally-wrong-99");

  // --- Correct credentials: full-page navigation back into the app ---
  await page.getByPlaceholder("Your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});

test("password reset: non-disclosure copy, confirm mismatch, single-use link", async ({ page }) => {
  // --- Reachable from the sign-in card ---
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  // Wait for the route swap to COMMIT before touching the form: the URL updates
  // before React unmounts the login card, and both pages have an email input
  // with the same placeholder — filling too early lands in the dying login form.
  await expect(page.locator("#main").getByText("Reset your password")).toBeVisible();

  // --- An unknown address gets the exact same "sent" state (no account
  // existence disclosure) ---
  await page.getByPlaceholder("you@example.com").fill(`ghost.${runId}@example.com`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists for that address/)).toBeVisible();

  // --- Real request for the account created in the previous journey ---
  await page.goto("/forgot-password");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists for that address/)).toBeVisible();

  // --- The reset email lands in the dev outbox (memory provider); the ghost
  // address never gets one ---
  let resetUrl: string | undefined;
  await expect
    .poll(
      async () => {
        const outbox = await (await fetch(`${API}/dev/outbox`)).json();
        const mail = outbox.emails.find(
          (e: { to: string; subject: string }) =>
            e.to === EMAIL && e.subject === "Reset your GoodStrata password",
        );
        resetUrl = mail?.text.match(/http:\/\/\S*\/reset-password\/[^\s)]+/)?.[0];
        return resetUrl;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  expect(
    outbox.emails.filter((e: { to: string }) => e.to === `ghost.${runId}@example.com`),
  ).toHaveLength(0);

  // --- Following the link lands on the reset form with the token attached ---
  await page.goto(resetUrl!);
  await expect(page).toHaveURL(/\/reset-password\?token=/);

  // --- Confirm mismatch errors on the confirm field, not a banner ---
  // (ids are wired by Field htmlFor — the inputs have no placeholders)
  await page.locator("#reset-password").fill(NEW_PASSWORD);
  await page.locator("#reset-confirm").fill("mismatch-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Passwords don't match.")).toBeVisible();

  // --- Matching passwords: explicit success state, then back to sign-in ---
  await page.locator("#reset-confirm").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText(/Password updated/)).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });

  // --- Old password is dead, new one signs in ---
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(/invalid email or password/i);
  await page.getByPlaceholder("Your password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();

  // --- The link is single-use: revisiting it yields the expired state with a
  // path back to a fresh request ---
  await page.goto(resetUrl!);
  await expect(page.getByText("This link has expired")).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new link" })).toBeVisible();
});

test("join page fails safe: missing, garbage, and signed-in garbage tokens", async ({ page }) => {
  // --- Signed out, no token: incomplete-link guidance, not a crash ---
  await page.goto("/join");
  await expect(page.getByText("Missing invite token")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to sign in" })).toBeVisible();

  // --- Signed out, garbage token: the public preview 410s and the page shows
  // the retryable error state (no signup form is offered) ---
  await page.goto("/join?token=this-token-does-not-exist");
  await expect(page.getByRole("alert")).toContainText("Invite unavailable");
  await expect(page.getByRole("alert")).toContainText(/invalid or has expired/);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account & join" })).toHaveCount(0);

  // --- Signed in, garbage token: preview validation still fails closed before
  // an accept action is offered, rather than asking the member to accept an
  // unidentified building invitation. ---
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("Your password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();

  await page.goto("/join?token=this-token-does-not-exist");
  await expect(page.getByRole("alert")).toContainText(/invalid or has expired/);
  await expect(page.getByRole("button", { name: "Accept invite" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/join\?token=/); // no navigation happened
});
