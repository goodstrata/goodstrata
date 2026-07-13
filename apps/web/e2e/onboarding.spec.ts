import { expect, test } from "@playwright/test";
import { attemptId, attemptPlan, expectPrefilledInviteName } from "./test-fixtures";

const API = "http://localhost:3105";

// Scheme navigation is a register index (sidebar on desktop, bottom bar on
// mobile) of section links — no longer a tablist. Whole-name match (case-
// insensitive) so dashboard deep links like "View activity" don't collide.
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

/** Exercise the officer-facing structured policy form used by activation. */
async function recordPolicyThroughUi(
  page: import("@playwright/test").Page,
  kind: "building" | "public_liability",
) {
  await page.getByRole("button", { name: "Record policy" }).click();
  const form = page.locator('[data-slot="card"]').filter({
    has: page.getByText("Record policy", { exact: true }),
  });
  if (kind === "public_liability") {
    await form.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Public liability" }).click();
  }
  await form.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: "certificate-of-currency.pdf" }).click();
  await form.getByLabel("Insurer").fill("E2E Insurance Ltd");
  await form.getByLabel("Policy number").fill(kind === "building" ? "BLD-E2E" : "PL-E2E");
  await form.getByLabel("Sum insured (dollars)").fill(kind === "building" ? "1000000" : "20000000");
  const year = new Date().getFullYear();
  await form.getByLabel("Starts").fill(`${year}-01-01`);
  await form.getByLabel("Ends").fill(`${year + 2}-12-31`);
  await form.getByRole("button", { name: "Record policy" }).click();
  await expect(page.getByText(`${kind.replaceAll("_", " ")} · E2E Insurance Ltd`)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
}

test.describe.configure({ mode: "serial" });

test("full onboarding: scheme → lots → invite → join → insurance → activate", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const id = attemptId(testInfo);
  const managerEmail = `morgan.${id}@example.com`;
  const ownerEmail = `alex.${id}@example.com`;
  const samEmail = `sam.${id}@example.com`;
  const kimEmail = `kim.${id}@example.com`;
  const csv = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,10,10,commercial,Sam Shopkeeper,${samEmail}
2,20,20,residential,Alex Owner,${ownerEmail}
3,10,10,residential,Kim Nguyen,${kimEmail}`;
  // --- Manager signs up (dedicated /signup route with consent gate) ---
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Morgan Manager");
  await page.getByPlaceholder("you@example.com").fill(managerEmail);
  await page.getByPlaceholder("Choose a password").fill("manager-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  // First run lands on the guided wizard (no schemes yet). Register the scheme
  // in step 1, then skip the wizard's lots/invite steps — this journey imports
  // the real entitlement CSV and invites through the registers below.
  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page
    .getByPlaceholder("e.g. 48 Rose St Owners Corporation")
    .fill("48 Rose St Owners Corporation");
  await page.getByPlaceholder("e.g. PS543210V").fill(attemptPlan("54", "V", testInfo));
  await page.getByPlaceholder("Street address").fill("48 Rose Street");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: "48 Rose St Owners Corporation" })).toBeVisible();

  // --- Import lots via CSV ---
  await section(page, "lots").click();
  await page.getByTestId("csv-input").fill(csv);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Sam Shopkeeper" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kim Nguyen" })).toBeVisible();

  // --- Invite an owner ---
  await section(page, "people").click();
  const alexRow = page.getByTestId(`person-${ownerEmail}`);
  await alexRow.getByRole("button", { name: "Invite" }).click();
  await expect(alexRow.getByText("invited")).toBeVisible();

  // --- Owner accepts via the emailed link (read from the dev outbox) ---
  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const inviteEmail = outbox.emails.find((e: { to: string; text: string }) => e.to === ownerEmail);
  expect(inviteEmail).toBeTruthy();
  const joinUrl = inviteEmail.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await expect(ownerPage.getByText(/invited as/)).toBeVisible();
  await expectPrefilledInviteName(ownerPage, "Alex Owner");
  await ownerPage.getByPlaceholder("Choose a password").fill("owner-pass-123");
  await ownerPage.getByRole("button", { name: "Create account & join" }).click();
  await ownerPage.waitForURL(/\/schemes\//);
  await ownerContext.close();

  // --- Manager sees the owner joined ---
  await page.reload();
  await section(page, "people").click();
  await expect(page.getByTestId(`person-${ownerEmail}`).getByText("joined")).toBeVisible();

  // --- Assign the owner as treasurer ---
  await section(page, "committee").click();
  await page.getByTestId("committee-member").click();
  await page.getByRole("option", { name: `Alex Owner (${ownerEmail})` }).click();
  await page.getByTestId("committee-role").click();
  await page.getByRole("option", { name: "Treasurer", exact: true }).click();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("committee-list").getByText("treasurer")).toBeVisible();

  // --- Activation is blocked until insurance is uploaded ---
  await section(page, "overview").click();
  await expect(page.getByRole("button", { name: "Activate scheme" })).toBeDisabled();

  // --- Upload insurance certificate ---
  await section(page, "documents").click();
  await page.getByTestId("doc-file").setInputFiles({
    name: "certificate-of-currency.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake insurance certificate"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("certificate-of-currency.pdf")).toBeVisible();

  // A category-only upload is evidence, not structured proof of current cover.
  await section(page, "overview").click();
  await expect(page.getByRole("button", { name: "Activate scheme" })).toBeDisabled();

  // --- Record the structured covers activation actually validates ---
  await section(page, "insurance & plan").click();
  await recordPolicyThroughUi(page, "building");
  // Three occupiable lots have common property, so $20m public liability is
  // independently required; a category-only certificate is intentionally not enough.
  await recordPolicyThroughUi(page, "public_liability");
  await expect(page.getByText("Required cover current")).toBeVisible();

  // --- Activate ---
  await section(page, "overview").click();
  const activate = page.getByRole("button", { name: "Activate scheme" });
  await expect(activate).toBeEnabled();
  await activate.click();
  // Once active, the checklist gives way to the building dashboard.
  await expect(page.getByRole("heading", { name: "Financial position" })).toBeVisible();

  // --- The event bus saw everything, including the echo agent ---
  await section(page, "activity").click();
  const feed = page.getByTestId("event-feed");
  await expect(feed.getByText("scheme.activated")).toBeVisible();
  await expect(feed.getByText("lots.imported")).toBeVisible();
  await expect(feed.getByText("agent.run.completed")).toBeVisible({ timeout: 30_000 });

  // ======================= The money loop =======================

  // --- Draft a budget (opens the treasurer decision gate) ---
  await section(page, "finance").click();
  await page.getByRole("button", { name: "New budget" }).click();
  await page.getByTestId("budget-fy").fill("2026-07-01");
  await page.getByTestId("budget-admin").fill("48000");
  await page.getByTestId("budget-maintenance").fill("12000");
  await page.getByRole("button", { name: "Draft budget" }).click();
  await expect(page.getByText("committee review")).toBeVisible();

  // --- Approve it in the decisions inbox ---
  await section(page, "decisions").click();
  const budgetDecision = page.getByTestId("decision-budget_adoption");
  await expect(budgetDecision).toBeVisible();
  await budgetDecision.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing to decide")).toBeVisible();

  // --- Owners adopt the proposal by carried resolution at a general meeting ---
  // Treasurer approval only tables the proposal; it cannot itself adopt the
  // budget or authorise levies.
  const budgetMeetingDate = new Date(Date.now() + 30 * 86_400_000);
  const budgetMeetingLocal = `${budgetMeetingDate.toISOString().slice(0, 10)}T18:00`;
  await section(page, "meetings").click();
  await page.getByRole("button", { name: "New meeting" }).click();
  await page.getByTestId("meeting-title").fill("2026 Budget Special General Meeting");
  await page.getByTestId("meeting-when").fill(budgetMeetingLocal);
  await page.getByTestId("meeting-agenda").fill("Adoption of the annual budget");
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  await page.getByRole("button", { name: /2026 Budget Special General Meeting/ }).click();
  await page.getByRole("button", { name: "Send notice" }).click();
  await expect(page.getByText("notice sent", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New motion" }).click();
  await page.getByTestId("motion-title").fill("Adopt the 2026 annual budget");
  await page
    .getByTestId("motion-text")
    .fill("That the owners corporation adopts the proposed 2026 annual budget.");
  const budgetMotionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/schemes\/[^/]+\/motions$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole("button", { name: "Add motion", exact: true }).click();
  const budgetMotionPayload = (await (await budgetMotionResponse).json()) as {
    motion: { id: string };
  };
  const budgetMotionCard = page.getByTestId("motion-Adopt the 2026 annual budget");
  await budgetMotionCard.getByRole("button", { name: "Open voting" }).click();

  const budgetVoterContext = await browser.newContext();
  const budgetVoterPage = await budgetVoterContext.newPage();
  await budgetVoterPage.goto("/login");
  await budgetVoterPage.getByPlaceholder("you@example.com").fill(ownerEmail);
  await budgetVoterPage.getByPlaceholder("Your password").fill("owner-pass-123");
  await budgetVoterPage.getByRole("button", { name: "Sign in" }).click();
  await expect(budgetVoterPage.getByRole("heading", { name: "Your schemes" })).toBeVisible({
    timeout: 15_000,
  });
  await budgetVoterPage.getByRole("link", { name: /48 Rose St Owners Corporation/ }).click();
  await section(budgetVoterPage, "meetings").click();
  await budgetVoterPage
    .getByRole("button", { name: /2026 Budget Special General Meeting/ })
    .click();
  await budgetVoterPage.getByRole("button", { name: "I'm attending" }).click();
  const ownerBudgetMotion = budgetVoterPage.getByTestId("motion-Adopt the 2026 annual budget");
  await ownerBudgetMotion.getByTestId("vote-lot").click();
  await budgetVoterPage.getByRole("option", { name: "Lot 2", exact: true }).click();
  await ownerBudgetMotion.getByRole("button", { name: "for", exact: true }).click();
  await budgetVoterContext.close();

  await budgetMotionCard.getByRole("button", { name: "Close & tally" }).click();
  await expect(budgetMotionCard.getByText("carried", { exact: true })).toBeVisible();

  await section(page, "finance").click();
  await page.getByRole("button", { name: "Record adoption" }).click();
  const adoptionDialog = page.getByRole("dialog", { name: "Record budget adoption" });
  await adoptionDialog.getByLabel("Carried motion ID").fill(budgetMotionPayload.motion.id);
  await adoptionDialog.getByRole("button", { name: "Adopt budget" }).click();
  await expect(page.getByText("adopted", { exact: true })).toBeVisible();

  // --- Create the quarterly schedule and issue instalment 1 ---
  await page.getByRole("button", { name: "New schedule" }).click();
  await page.getByTestId("schedule-budget").click();
  await page.getByRole("option").first().click();
  await page.getByTestId("schedule-first-due").fill("2026-10-01");
  await page.getByRole("button", { name: "Create quarterly schedule" }).click();
  await expect(page.getByText(/quarterly × 4/)).toBeVisible();
  await page.getByRole("button", { name: "Issue notices" }).click();
  await expect(page.getByText(/LN-2026-01-1/)).toBeVisible();

  // Three notices issued, each with a Simulate payment button.
  await expect(page.getByRole("button", { name: "Simulate payment" })).toHaveCount(3);

  // --- Pay the first notice via the signed mock webhook ---
  await page.getByRole("button", { name: "Simulate payment" }).first().click();
  await expect(page.getByText("paid", { exact: true })).toBeVisible();

  // --- Owners' emails: levy notices + a receipt went out ---
  const finalOutbox = await (await fetch(`${API}/dev/outbox`)).json();
  const recipients = new Set([samEmail, ownerEmail, kimEmail]);
  const currentEmails = finalOutbox.emails.filter((email: { to: string; subject: string }) =>
    recipients.has(email.to),
  );
  expect(
    currentEmails.filter((email: { subject: string }) => email.subject.startsWith("Levy notice")),
  ).toHaveLength(3);
  expect(
    currentEmails.some((email: { subject: string }) => email.subject.startsWith("Receipt")),
  ).toBeTruthy();

  // ======================= Maintenance =======================

  await section(page, "maintenance").click();
  await page.getByRole("tab", { name: "Contractors" }).click();
  await page.getByRole("button", { name: "New contractor" }).click();
  await page.getByTestId("contractor-name").fill("Fitzroy Plumbing Co");
  await page.getByTestId("contractor-email").fill("jobs@fitzroyplumbing.example");
  await page.getByTestId("contractor-trades").fill("plumbing, roofing");
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByText("Fitzroy Plumbing Co")).toBeVisible();

  // Two triggers for the same dialog: the header action and the empty-state CTA.
  await page.getByRole("tab", { name: "Requests" }).click();
  await page.getByRole("button", { name: "Report an issue" }).first().click();
  await page.getByTestId("mr-title").fill("Water stain on lot 9 ceiling");
  await page.getByTestId("mr-description").fill("Brown stain spreading after heavy rain.");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByTestId("mr-Water stain on lot 9 ceiling")).toBeVisible();

  // The maintenance agent picked the event up (mock model: run completes
  // without tool calls; real triage behaviour is covered by agent tests).
  await section(page, "activity").click();
  await expect(
    page.getByTestId("event-feed").getByText("maintenance.request.created"),
  ).toBeVisible();

  // ======================= AGM =======================

  const agmDate = new Date(Date.now() + 30 * 86_400_000);
  const agmLocal = `${agmDate.toISOString().slice(0, 10)}T18:00`;

  await section(page, "meetings").click();
  await page.getByRole("button", { name: "New meeting" }).click();
  await page.getByTestId("meeting-title").fill("2026 Annual General Meeting");
  await page.getByTestId("meeting-when").fill(agmLocal);
  await page.getByTestId("meeting-agenda").fill("Financial statements\nCommittee election");
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  await page.getByRole("button", { name: /2026 Annual General Meeting/ }).click();

  await page.getByRole("button", { name: "Send notice" }).click();
  await expect(page.getByText("notice sent", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New motion" }).click();
  await page.getByTestId("motion-title").fill("Repaint the stairwell");
  await page.getByTestId("motion-text").fill("That the OC engages a painter for the stairwell.");
  await page.getByRole("button", { name: "Add motion", exact: true }).click();
  const motionCard = page.getByTestId("motion-Repaint the stairwell");
  await expect(motionCard).toBeVisible();
  await motionCard.getByRole("button", { name: "Open voting" }).click();
  await expect(motionCard.getByText("open", { exact: true })).toBeVisible();

  // --- Alex (owner of lot 2) votes from their own session ---
  const voterContext = await browser.newContext();
  const voterPage = await voterContext.newPage();
  await voterPage.goto("/login");
  await voterPage.getByPlaceholder("you@example.com").fill(ownerEmail);
  await voterPage.getByPlaceholder("Your password").fill("owner-pass-123");
  await voterPage.getByRole("button", { name: "Sign in" }).click();
  await expect(voterPage.getByRole("heading", { name: "Your schemes" })).toBeVisible({
    timeout: 15_000,
  });
  await voterPage.getByRole("link", { name: /48 Rose St Owners Corporation/ }).click();
  await section(voterPage, "meetings").click();
  await voterPage.getByRole("button", { name: /2026 Annual General Meeting/ }).click();
  await voterPage.getByRole("button", { name: "I'm attending" }).click();
  const voterMotion = voterPage.getByTestId("motion-Repaint the stairwell");
  await voterMotion.getByTestId("vote-lot").click();
  await voterPage.getByRole("option", { name: "Lot 2", exact: true }).click();
  await voterMotion.getByRole("button", { name: "for", exact: true }).click();
  await expect(voterPage.getByTestId("quorum")).toContainText("entitlements represented");
  await voterContext.close();

  // --- Manager closes and tallies: 10 for, carried ---
  await motionCard.getByRole("button", { name: "Close & tally" }).click();
  await expect(motionCard.getByText("carried")).toBeVisible();
  // Ordinary motions tally by headcount (one vote per lot, s 92): Alex's
  // single lot counts as 1, not its 10 entitlements.
  await expect(motionCard.getByText(/For 1 · Against 0/)).toBeVisible();
});
