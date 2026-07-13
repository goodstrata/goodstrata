import { expect, test } from "@playwright/test";
import { attemptId, attemptPlan, expectPrefilledInviteName } from "./test-fixtures";

const API = "http://localhost:3105";

// Register-index section links (same convention as onboarding.spec.ts).
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

const dateOnlyDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: "serial" });

/**
 * Finance permutations the happy-path onboarding journey doesn't cover:
 *  - officer-side validation errors (client zod messages) and server business
 *    errors surfacing as toasts (duplicate levy issue → 409);
 *  - the manual bank-transfer rail (record payment → receipt, partial payment);
 *  - role presentation: an owner sees only their own balance, payment guidance
 *    and statement — never the scheme-wide finance workspace.
 */
test("finance permutations: officer error paths, manual payment rail, owner gating", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const id = attemptId(testInfo);
  const managerEmail = `fin.manager.${id}@ledgerlane.example`;
  const ownerEmail = `finlay.${id}@ledgerlane.example`;
  const csv = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,10,10,residential,Finlay Owner,${ownerEmail}
2,10,10,residential,Greta Owner,greta.${id}@ledgerlane.example`;

  // --- Manager signs up and registers the scheme via the wizard ---
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Fin Manager");
  await page.getByPlaceholder("you@example.com").fill(managerEmail);
  await page.getByPlaceholder("Choose a password").fill("manager-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page
    .getByPlaceholder("e.g. 48 Rose St Owners Corporation")
    .fill("7 Ledger Lane Owners Corporation");
  await page.getByPlaceholder("e.g. PS543210V").fill(attemptPlan("76", "L", testInfo));
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
  await page.getByTestId("csv-input").fill(csv);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Finlay Owner" })).toBeVisible();

  await section(page, "people").click();
  const ownerRow = page.getByTestId(`person-${ownerEmail}`);
  await ownerRow.getByRole("button", { name: "Invite" }).click();
  await expect(ownerRow.getByText("invited")).toBeVisible();

  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const inviteEmail = outbox.emails.find((e: { to: string; text: string }) => e.to === ownerEmail);
  expect(inviteEmail).toBeTruthy();
  const joinUrl = inviteEmail.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await expect(ownerPage.getByText(/invited as/)).toBeVisible();
  await expectPrefilledInviteName(ownerPage, "Finlay Owner");
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

  // --- Treasurer approval advances the proposal, but cannot adopt it ---
  await section(page, "decisions").click();
  const budgetDecision = page.getByTestId("decision-budget_adoption");
  await expect(budgetDecision).toBeVisible();
  await budgetDecision.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Decision recorded")).toBeVisible();

  await section(page, "finance").click();
  await expect(page.getByText("committee review", { exact: true })).toBeVisible();
  await expect(page.getByText("adopted", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New schedule" })).toHaveCount(0);

  // --- Statutory adoption: a carried ordinary motion at an AGM/SGM ---
  const meetingTitle = `2026 budget AGM ${id}`;
  await section(page, "meetings").click();
  await page.getByRole("button", { name: "New meeting" }).click();
  await page.getByTestId("meeting-title").fill(meetingTitle);
  await page.getByTestId("meeting-when").fill(`${dateOnlyDaysFromNow(30)}T18:00`);
  await page.getByTestId("meeting-agenda").fill("Adoption of the annual budget");
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  await page.getByRole("button", { name: new RegExp(meetingTitle) }).click();
  await page.getByRole("button", { name: "Send notice" }).click();
  await expect(page.getByText("notice sent", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New motion" }).click();
  await page.getByTestId("motion-title").fill("Adopt the 2026 annual budget");
  await page
    .getByTestId("motion-text")
    .fill("That the owners corporation adopts the proposed 2026 annual budget.");
  const motionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/schemes\/[^/]+\/motions$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Add motion", exact: true }).click();
  const motionPayload = (await (await motionResponse).json()) as { motion: { id: string } };
  const budgetMotionId = motionPayload.motion.id;
  const motionCard = page.getByTestId("motion-Adopt the 2026 annual budget");
  await expect(motionCard).toBeVisible();
  await motionCard.getByRole("button", { name: "Open voting" }).click();
  await expect(motionCard.getByText("open", { exact: true })).toBeVisible();

  await section(ownerPage, "meetings").click();
  await expect(ownerPage.getByRole("button", { name: new RegExp(meetingTitle) })).toBeVisible({
    timeout: 10_000,
  });
  await ownerPage.getByRole("button", { name: new RegExp(meetingTitle) }).click();
  await ownerPage.getByRole("button", { name: "I'm attending" }).click();
  const ownerMotion = ownerPage.getByTestId("motion-Adopt the 2026 annual budget");
  await ownerMotion.getByTestId("vote-lot").click();
  await ownerPage.getByRole("option", { name: "Lot 1", exact: true }).click();
  await ownerMotion.getByRole("button", { name: "for", exact: true }).click();
  await expect(ownerPage.getByText("Vote recorded")).toBeVisible();

  await motionCard.getByRole("button", { name: "Close & tally" }).click();
  await expect(motionCard.getByText("carried", { exact: true })).toBeVisible();

  await section(page, "finance").click();
  await page.getByRole("button", { name: "Record adoption" }).click();
  const adoptionDialog = page.getByRole("dialog", { name: "Record budget adoption" });
  await adoptionDialog.getByLabel("Carried motion ID").fill(budgetMotionId);
  const adoptionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/schemes\/[^/]+\/budgets\/[^/]+\/adopt$/.test(new URL(response.url()).pathname),
  );
  await adoptionDialog.getByRole("button", { name: "Adopt budget" }).click();
  const adoptionResult = await adoptionResponse;
  expect(adoptionResult.ok(), await adoptionResult.text()).toBeTruthy();
  await expect(
    page.getByText("Budget adoption linked to the carried general-meeting resolution"),
  ).toBeVisible();
  await expect(page.getByText("adopted", { exact: true })).toBeVisible();

  // --- Schedule + issue; a second issue of the SAME instalment is a 409 toast ---
  // The exact 28-day boundary is valid; deriving it from the test clock keeps
  // this spec statutory and evergreen.
  const firstDueOn = dateOnlyDaysFromNow(28);
  const paymentReceivedOn = dateOnlyDaysFromNow(29);
  await page.getByRole("button", { name: "New schedule" }).click();
  await page.getByTestId("schedule-budget").click();
  await page.getByRole("option").first().click();
  await page.getByTestId("schedule-first-due").fill(firstDueOn);
  await page.getByRole("button", { name: "Create quarterly schedule" }).click();
  await expect(page.getByText(/quarterly × 4/)).toBeVisible();

  await page.getByRole("button", { name: "Issue notices" }).click();
  await expect(page.getByText("Levy notices issued to all lots")).toBeVisible();
  await expect(page.getByText(new RegExp(`LN-${firstDueOn.slice(0, 4)}-01-1`))).toBeVisible();

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
  await page.getByTestId("manual-payment-date").fill(paymentReceivedOn);
  // After the first submit the form revalidates live: a $0 amount errors
  // immediately (and keeps the submit disabled — the boundary never reaches the server).
  await page.getByTestId("manual-payment-amount").fill("0");
  await expect(page.getByText("Enter an amount greater than zero.")).toBeVisible();

  // $120.50 against a $6000 quarterly notice → partial payment.
  await page.getByTestId("manual-payment-amount").fill("120.50");
  await page.getByTestId("manual-payment-payer").fill("Finlay Owner");
  await page.getByTestId("manual-payment-reference").fill(`E2E-STMT-${id}`);
  await paymentDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded — receipt issued")).toBeVisible();

  // The sweep refreshed both registers: payment matched, notice partially paid,
  // and the receipt PDF affordance exists.
  await expect(page.getByText("matched", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("partially paid", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: /Receipt/ }).first()).toBeVisible({
    timeout: 15_000,
  });

  // ================= Owner gating =================

  // The owner opens the SAME scheme's owner-focused money view.
  await section(ownerPage, "what i owe").click();

  // Their own position is prominent and actionable.
  await expect(ownerPage.getByText("My levies", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText("Amount due")).toBeVisible();
  await expect(ownerPage.getByText("How to pay")).toBeVisible();
  await expect(ownerPage.getByTestId("statement-lot-1")).toBeVisible();

  // Scheme-wide management information and officer actions are absent.
  for (const text of ["Admin fund", "Arrears", "Payments", "Budgets", "Levy schedules"]) {
    await expect(ownerPage.getByText(text, { exact: true })).toHaveCount(0);
  }
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
  await expect(ownerPage.getByText("BSB", { exact: true })).toHaveCount(0);
  await expect(ownerPage.getByText(/webhook last seen/)).toHaveCount(0);

  await ownerContext.close();
});
