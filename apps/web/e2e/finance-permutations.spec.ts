import { expect, test } from "@playwright/test";

const API = "http://localhost:3105";

// Register-index section links (same convention as onboarding.spec.ts).
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

// Distinct identities/scheme from the other specs — files run in parallel
// against the shared gs_e2e database.
const MANAGER_EMAIL = "fin.manager@ledgerlane.example";
const OWNER_EMAIL = "finlay@ledgerlane.example";

const CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,10,10,residential,Finlay Owner,${OWNER_EMAIL}
2,10,10,residential,Greta Owner,greta@ledgerlane.example
3,10,10,residential,Hana Owner,hana@ledgerlane.example`;

test.describe.configure({ mode: "serial" });

/**
 * Finance permutations the happy-path onboarding journey doesn't cover:
 *  - officer-side validation errors (client zod messages) and server business
 *    errors surfacing as toasts (duplicate levy issue → 409);
 *  - the manual bank-transfer rail (record payment → receipt, partial payment);
 *  - role gating: an owner sees the read side (stats, how-to-pay, notices,
 *    payments) but NONE of the officer mutations.
 */
test("finance permutations: officer error paths, manual payment rail, owner gating", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  // --- Manager signs up and registers the scheme via the wizard ---
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Fin Manager");
  await page.getByPlaceholder("you@example.com").fill(MANAGER_EMAIL);
  await page.getByPlaceholder("Choose a password").fill("manager-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page
    .getByPlaceholder("e.g. 48 Rose St Owners Corporation")
    .fill("7 Ledger Lane Owners Corporation");
  await page.getByPlaceholder("e.g. PS543210V").fill("PS765432L");
  await page.getByPlaceholder("Street address").fill("7 Ledger Lane");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(
    page.getByRole("heading", { name: "7 Ledger Lane Owners Corporation" }),
  ).toBeVisible();

  // --- Lots + one real owner login (for the gating checks below) ---
  await section(page, "lots").click();
  await page.getByTestId("csv-input").fill(CSV);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Finlay Owner" })).toBeVisible();

  await section(page, "people").click();
  const ownerRow = page.getByTestId(`person-${OWNER_EMAIL}`);
  await ownerRow.getByRole("button", { name: "Invite" }).click();
  await expect(ownerRow.getByText("invited")).toBeVisible();

  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const inviteEmail = outbox.emails.find((e: { to: string; text: string }) => e.to === OWNER_EMAIL);
  expect(inviteEmail).toBeTruthy();
  const joinUrl = inviteEmail.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await expect(ownerPage.getByText(/invited as/)).toBeVisible();
  await ownerPage.getByPlaceholder("Your name").fill("Finlay Owner");
  await ownerPage.getByPlaceholder("Choose a password").fill("owner-pass-123");
  await ownerPage.getByRole("button", { name: "Create account & join" }).click();
  await ownerPage.waitForURL(/\/schemes\//);

  // ================= Officer permutations =================

  await section(page, "finance").click();

  // Before any budget is adopted there is nothing to schedule against:
  // the New schedule affordance must not exist at all.
  await expect(page.getByText("No budgets yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "New schedule" })).toHaveCount(0);

  // --- Budget dialog: money boundary errors come from the client schema ---
  await page.getByRole("button", { name: "New budget" }).click();
  await page.getByTestId("budget-fy").fill("2026-07-01");
  await page.getByTestId("budget-admin").fill("0"); // $0 is not a budget
  await page.getByRole("button", { name: "Draft budget" }).click();
  await expect(page.getByText("Enter an amount greater than zero.")).toBeVisible();

  await page.getByTestId("budget-admin").fill("-5"); // negative — same guard
  await expect(page.getByText("Enter an amount greater than zero.")).toBeVisible();

  // Valid values; maintenance left blank → defaults to $0 (allowed).
  await page.getByTestId("budget-admin").fill("48000");
  await page.getByRole("button", { name: "Draft budget" }).click();
  await expect(
    page.getByText("Budget drafted — a committee decision has been opened"),
  ).toBeVisible();
  await expect(page.getByText("committee review")).toBeVisible();

  // --- Treasurer decision gate, then the executor adopts asynchronously ---
  await section(page, "decisions").click();
  const budgetDecision = page.getByTestId("decision-budget_adoption");
  await expect(budgetDecision).toBeVisible();
  await budgetDecision.getByRole("button", { name: "Approve" }).click();

  await expect(async () => {
    await page.reload();
    await section(page, "finance").click();
    await expect(page.getByText("adopted", { exact: true })).toBeVisible({ timeout: 2000 });
    // The pg-boss dispatcher + executor hop can exceed 20s on a cold stack.
  }).toPass({ timeout: 45_000 });

  // --- Schedule + issue; a second issue of the SAME instalment is a 409 toast ---
  await page.getByRole("button", { name: "New schedule" }).click();
  await page.getByTestId("schedule-budget").click();
  await page.getByRole("option").first().click();
  await page.getByTestId("schedule-first-due").fill("2026-10-01");
  await page.getByRole("button", { name: "Create quarterly schedule" }).click();
  await expect(page.getByText(/quarterly × 4/)).toBeVisible();

  await page.getByRole("button", { name: "Issue notices" }).click();
  await expect(page.getByText("Levy notices issued to all lots")).toBeVisible();
  await expect(page.getByText(/LN-2026-01-1/)).toBeVisible();

  // Same instalment again → the server's ALREADY_ISSUED lands as an error toast.
  await page.getByRole("button", { name: "Issue notices" }).click();
  await expect(page.getByText(/already issued/i)).toBeVisible();

  // --- Manual payment rail: validation, then a PARTIAL payment + receipt ---
  await page.getByRole("button", { name: "Record payment" }).click();
  const paymentDialog = page.getByRole("dialog");
  // Submitting the untouched form surfaces every required-field message.
  await paymentDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Select the notice this payment pays.")).toBeVisible();
  await expect(page.getByText("Enter the date the money arrived.")).toBeVisible();

  await page.getByTestId("manual-payment-notice").click();
  await page.getByRole("option").first().click();
  await page.getByTestId("manual-payment-date").fill("2026-10-02");
  // After the first submit the form revalidates live: a $0 amount errors
  // immediately (and keeps the submit disabled — the boundary never reaches the server).
  await page.getByTestId("manual-payment-amount").fill("0");
  await expect(page.getByText("Enter an amount greater than zero.")).toBeVisible();

  // $120.50 against a $4000 quarterly notice → partial payment.
  await page.getByTestId("manual-payment-amount").fill("120.50");
  await page.getByTestId("manual-payment-payer").fill("Finlay Owner");
  await page.getByTestId("manual-payment-reference").fill("E2E-STMT-1");
  await paymentDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded — receipt issued")).toBeVisible();

  // The sweep refreshed both registers: payment matched, notice partially paid,
  // and the receipt PDF affordance exists.
  await expect(page.getByText("matched", { exact: true })).toBeVisible();
  await expect(page.getByText("partially paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Receipt/ }).first()).toBeVisible();

  // ================= Owner gating =================

  // The owner opens the SAME scheme's finance register.
  await section(ownerPage, "finance").click();

  // Read side: headline stats, payment details (account exists now), notices.
  await expect(ownerPage.getByText("Admin fund")).toBeVisible();
  await expect(ownerPage.getByText("How to pay")).toBeVisible();
  await expect(ownerPage.getByText("BSB", { exact: true })).toBeVisible();
  // The notice ref renders in BOTH registers (notice row + matched payment
  // reference) — assert the first; the payments-side copy is covered below.
  await expect(ownerPage.getByText(/LN-2026-01-1/).first()).toBeVisible();
  // Money moved, so the owner sees the payments register (with the receipt).
  await expect(ownerPage.getByText("Payments", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText("matched", { exact: true })).toBeVisible();

  // Mutations: none of the officer affordances exist for an owner.
  for (const name of [
    "New budget",
    "New schedule",
    "Issue notices",
    "Record payment",
    "Simulate payment",
    "Match",
  ]) {
    await expect(ownerPage.getByRole("button", { name })).toHaveCount(0);
  }
  // The officer-only provider status line is hidden too.
  await expect(ownerPage.getByText(/webhook last seen/)).toHaveCount(0);

  await ownerContext.close();
});
