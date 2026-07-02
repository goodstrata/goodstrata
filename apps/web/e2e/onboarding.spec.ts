import { expect, test } from "@playwright/test";

const API = "http://localhost:3105";

const CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,commercial,Sam Shopkeeper,sam@example.com
2,10,10,residential,Alex Owner,alex@example.com
3,10,10,residential,Kim Nguyen,kim@example.com`;

test.describe.configure({ mode: "serial" });

test("full onboarding: scheme → lots → invite → join → insurance → activate", async ({
  page,
  browser,
}) => {
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
  await page.getByRole("button", { name: "lots" }).click();
  await page.getByTestId("csv-input").fill(CSV);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Sam Shopkeeper" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kim Nguyen" })).toBeVisible();

  // --- Invite an owner ---
  await page.getByRole("button", { name: "people" }).click();
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
  await page.getByRole("button", { name: "people" }).click();
  await expect(page.getByTestId("person-alex@example.com").getByText("joined")).toBeVisible();

  // --- Assign the owner as treasurer ---
  await page.getByRole("button", { name: "committee" }).click();
  await page.getByRole("combobox").first().selectOption({ label: "Alex Owner (alex@example.com)" });
  await page.getByRole("combobox").nth(1).selectOption("treasurer");
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("committee-list").getByText("treasurer")).toBeVisible();

  // --- Activation is blocked until insurance is uploaded ---
  await page.getByRole("button", { name: "overview" }).click();
  await expect(page.getByRole("button", { name: "Activate scheme" })).toBeDisabled();

  // --- Upload insurance certificate ---
  await page.getByRole("button", { name: "documents" }).click();
  await page.getByTestId("doc-file").setInputFiles({
    name: "certificate-of-currency.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake insurance certificate"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("certificate-of-currency.pdf")).toBeVisible();

  // --- Activate ---
  await page.getByRole("button", { name: "overview" }).click();
  const activate = page.getByRole("button", { name: "Activate scheme" });
  await expect(activate).toBeEnabled();
  await activate.click();
  await expect(page.getByText("This owners corporation is active")).toBeVisible();

  // --- The event bus saw everything, including the echo agent ---
  await page.getByRole("button", { name: "activity" }).click();
  const feed = page.getByTestId("event-feed");
  await expect(feed.getByText("scheme.activated")).toBeVisible();
  await expect(feed.getByText("lots.imported")).toBeVisible();
  await expect(feed.getByText("agent.run.completed")).toBeVisible();

  // ======================= The money loop =======================

  // --- Draft a budget (opens the treasurer decision gate) ---
  await page.getByRole("button", { name: "finance" }).click();
  await page.getByTestId("budget-fy").fill("2026-07-01");
  await page.getByTestId("budget-admin").fill("48000");
  await page.getByTestId("budget-maintenance").fill("12000");
  await page.getByRole("button", { name: "Draft budget" }).click();
  await expect(page.getByText("committee review")).toBeVisible();

  // --- Approve it in the decisions inbox ---
  await page.getByRole("button", { name: "decisions" }).click();
  const budgetDecision = page.getByTestId("decision-budget_adoption");
  await expect(budgetDecision).toBeVisible();
  await budgetDecision.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing to decide")).toBeVisible();

  // --- The code executor adopts the budget asynchronously ---
  await expect(async () => {
    await page.reload();
    await page.getByRole("button", { name: "finance" }).click();
    await expect(page.getByText("adopted", { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // --- Create the quarterly schedule and issue instalment 1 ---
  await page.getByTestId("schedule-budget").selectOption({ index: 1 });
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
});
