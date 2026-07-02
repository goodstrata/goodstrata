import { expect, test } from "@playwright/test";

const API = "http://localhost:3105";

// Scheme navigation is a register index (sidebar on desktop, bottom bar on
// mobile) of section links — no longer a tablist. Names match case-insensitively.
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name, exact: false });

const CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,commercial,Sam Shopkeeper,sam@example.com
2,10,10,residential,Alex Owner,alex@example.com
3,10,10,residential,Kim Nguyen,kim@example.com`;

test.describe.configure({ mode: "serial" });

test("full onboarding: scheme → lots → invite → join → insurance → activate", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  // --- Manager signs up and creates the scheme ---
  await page.goto("/login");
  await page.getByText("New here? Create an account").click();
  await page.getByPlaceholder("Your name").fill("Morgan Manager");
  await page.getByPlaceholder("Email").fill("morgan@example.com");
  await page.getByPlaceholder("Password").fill("manager-pass-123");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByRole("heading", { name: "Your schemes" })).toBeVisible();
  await page.getByRole("button", { name: "New scheme" }).click();
  await page.getByPlaceholder(/Scheme name/).fill("48 Rose St Owners Corporation");
  await page.getByPlaceholder(/Plan of subdivision/).fill("PS543210V");
  await page.getByPlaceholder("Street address").fill("48 Rose Street");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create scheme" }).click();

  await page.getByRole("link", { name: /48 Rose St Owners Corporation/ }).click();
  await expect(page.getByRole("heading", { name: "48 Rose St Owners Corporation" })).toBeVisible();

  // --- Import lots via CSV ---
  await section(page, "lots").click();
  await page.getByTestId("csv-input").fill(CSV);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Sam Shopkeeper" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kim Nguyen" })).toBeVisible();

  // --- Invite an owner ---
  await section(page, "people").click();
  const alexRow = page.getByTestId("person-alex@example.com");
  await alexRow.getByRole("button", { name: "Invite" }).click();
  await expect(alexRow.getByText("invited")).toBeVisible();

  // --- Owner accepts via the emailed link (read from the dev outbox) ---
  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const inviteEmail = outbox.emails.find(
    (e: { to: string; text: string }) => e.to === "alex@example.com",
  );
  expect(inviteEmail).toBeTruthy();
  const joinUrl = inviteEmail.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await expect(ownerPage.getByText(/invited as/)).toBeVisible();
  await ownerPage.getByPlaceholder("Your name").fill("Alex Owner");
  await ownerPage.getByPlaceholder("Choose a password").fill("owner-pass-123");
  await ownerPage.getByRole("button", { name: "Create account & join" }).click();
  await ownerPage.waitForURL(/\/schemes\//);
  await ownerContext.close();

  // --- Manager sees the owner joined ---
  await page.reload();
  await section(page, "people").click();
  await expect(page.getByTestId("person-alex@example.com").getByText("joined")).toBeVisible();

  // --- Assign the owner as treasurer ---
  await section(page, "committee").click();
  await page.getByTestId("committee-member").click();
  await page.getByRole("option", { name: "Alex Owner (alex@example.com)" }).click();
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

  // --- Activate ---
  await section(page, "overview").click();
  const activate = page.getByRole("button", { name: "Activate scheme" });
  await expect(activate).toBeEnabled();
  await activate.click();
  await expect(page.getByText("This owners corporation is active")).toBeVisible();

  // --- The event bus saw everything, including the echo agent ---
  await section(page, "activity").click();
  const feed = page.getByTestId("event-feed");
  await expect(feed.getByText("scheme.activated")).toBeVisible();
  await expect(feed.getByText("lots.imported")).toBeVisible();
  await expect(feed.getByText("agent.run.completed")).toBeVisible();

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

  // --- The code executor adopts the budget asynchronously ---
  await expect(async () => {
    await page.reload();
    await section(page, "finance").click();
    await expect(page.getByText("adopted", { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

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
  const subjects = finalOutbox.emails.map((e: { subject: string }) => e.subject);
  expect(subjects.filter((s: string) => s.startsWith("Levy notice"))).toHaveLength(3);
  expect(subjects.some((s: string) => s.startsWith("Receipt"))).toBeTruthy();

  // ======================= Maintenance =======================

  await section(page, "maintenance").click();
  await page.getByRole("button", { name: "New contractor" }).click();
  await page.getByTestId("contractor-name").fill("Fitzroy Plumbing Co");
  await page.getByTestId("contractor-email").fill("jobs@fitzroyplumbing.example");
  await page.getByTestId("contractor-trades").fill("plumbing, roofing");
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByText("Fitzroy Plumbing Co")).toBeVisible();

  await page.getByRole("button", { name: "Report issue" }).click();
  await page.getByTestId("mr-title").fill("Water stain on lot 9 ceiling");
  await page.getByTestId("mr-description").fill("Brown stain spreading after heavy rain.");
  await page.getByRole("button", { name: "Submit request" }).click();
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
  await voterPage.getByPlaceholder("Email").fill("alex@example.com");
  await voterPage.getByPlaceholder("Password").fill("owner-pass-123");
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
  await expect(motionCard.getByText(/For 10/)).toBeVisible();
});
