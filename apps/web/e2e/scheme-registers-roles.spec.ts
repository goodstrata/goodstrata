import { expect, test } from "@playwright/test";
import { attemptId, attemptPlan, expectPrefilledInviteName } from "./test-fixtures";

const API = "http://localhost:3105";

// Register index navigation (sidebar link per section), as in onboarding.spec.ts.
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

/**
 * Permutation journey for register role-gating: client-side validation on the
 * wizard, the CSV error envelope on the lot register, then the critical fence —
 * a joined plain owner sees every register read-only (no officer forms, no
 * activate), and becoming committee_member widens document access without
 * granting officer powers.
 */
test("register gating: wizard validation, CSV line errors, owner & committee_member read-only", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const id = attemptId(testInfo);
  const managerEmail = `gatekeeper.${id}@example.com`;
  const ownerEmail = `alex.gate.${id}@example.com`;
  const kimEmail = `kim.gate.${id}@example.com`;
  const schemeName = `61 Fence St Owners Corporation ${id}`;
  const badCsv = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,commercial,Sam Shopkeeper,sam.gate.${id}@example.com
2,not-a-number,10,residential,Alex Owner,${ownerEmail}`;
  const goodCsv = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,commercial,Sam Shopkeeper,sam.gate.${id}@example.com
2,10,10,residential,Alex Owner,${ownerEmail}
3,10,10,residential,Kim Nguyen,${kimEmail}`;

  // --- Manager signs up ---
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Gale Gatekeeper");
  await page.getByPlaceholder("you@example.com").fill(managerEmail);
  await page.getByPlaceholder("Choose a password").fill("gatekeeper-pass-123");
  await page.getByPlaceholder("e.g. 48 Rose St, Fitzroy").fill(schemeName);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  // --- Wizard step 1: invalid plan + postcode are rejected client-side ---
  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await expect(page.getByPlaceholder("e.g. 48 Rose St Owners Corporation")).toHaveValue(schemeName);
  await page.getByPlaceholder("e.g. PS543210V").fill("LP12345"); // wrong prefix
  await page.getByPlaceholder("Street address").fill("61 Fence Street");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("300"); // three digits
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await expect(page.getByText("Plan numbers look like PS543210V.")).toBeVisible();
  await expect(page.getByText("Victorian postcodes have 4 digits.")).toBeVisible();

  // Fix both fields; the scheme registers and the wizard moves on.
  await page.getByPlaceholder("e.g. PS543210V").fill(attemptPlan("61", "M", testInfo));
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();

  // Skip the wizard's lots/invite steps — this journey uses the registers.
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: schemeName })).toBeVisible();

  // --- Lot register: a bad CSV line is reported per-line and imports nothing ---
  await section(page, "lots").click();
  await page.getByTestId("csv-input").fill(badCsv);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByText("CSV contains invalid rows")).toBeVisible();
  // Header is line 1, so the broken entitlement row is line 3.
  await expect(page.getByText(/^Line 3: entitlement/)).toBeVisible();
  // All-or-nothing: the valid line 2 must not have landed either.
  await expect(page.getByText("No lots yet")).toBeVisible();

  await page.getByTestId("csv-input").fill(goodCsv);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Sam Shopkeeper" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kim Nguyen" })).toBeVisible();

  // --- Invite Alex (owner) and accept in a second browser context ---
  await section(page, "people").click();
  const alexRow = page.getByTestId(`person-${ownerEmail}`);
  await alexRow.getByRole("button", { name: "Invite" }).click();
  await expect(alexRow.getByText("invited")).toBeVisible();

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

  // --- Manager files one owners-tier and one committee-tier document ---
  await section(page, "documents").click();
  await page.getByTestId("doc-file").setInputFiles({
    name: "certificate-of-currency.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake insurance certificate"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("certificate-of-currency.pdf")).toBeVisible();

  await page.getByTestId("doc-file").setInputFiles({
    name: "committee-brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Committee only\nquotes under negotiation"),
  });
  await page.getByTestId("doc-category").click();
  await page.getByRole("option", { name: "Minutes", exact: true }).click();
  await page.getByTestId("doc-access").click();
  await page.getByRole("option", { name: "Committee only" }).click();
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("committee-brief.md")).toBeVisible();

  // ================= Plain owner: every register is read-only =================

  // Overview: activation belongs to office holders.
  await expect(ownerPage.getByTestId("onboarding-checklist")).toBeVisible();
  await expect(
    ownerPage.getByText(
      "An office holder will activate the scheme once the checklist is complete.",
    ),
  ).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Activate scheme" })).toHaveCount(0);

  // Lots: register visible, import card absent.
  await section(ownerPage, "lots").click();
  await expect(ownerPage.getByRole("cell", { name: "Sam Shopkeeper" })).toBeVisible();
  await expect(ownerPage.getByText("Import lots (CSV)")).toHaveCount(0);
  await expect(ownerPage.getByTestId("csv-input")).toHaveCount(0);

  // People: roll visible, but no invite buttons and no add-person card.
  await section(ownerPage, "people").click();
  await expect(ownerPage.getByTestId(`person-${ownerEmail}`).getByText("joined")).toBeVisible();
  await expect(ownerPage.getByTestId(`person-${kimEmail}`)).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Invite" })).toHaveCount(0);
  await expect(ownerPage.getByText("Add a person")).toHaveCount(0);

  // Committee: list visible (the manager shows as manager admin), no assign card.
  await section(ownerPage, "committee").click();
  await expect(ownerPage.getByTestId("committee-list").getByText("manager admin")).toBeVisible();
  await expect(ownerPage.getByText("Assign role")).toHaveCount(0);
  await expect(ownerPage.getByTestId("committee-member")).toHaveCount(0);

  // Documents: the s146 fence — the committee record is not even listed.
  await section(ownerPage, "documents").click();
  await expect(ownerPage.getByText("certificate-of-currency.pdf")).toBeVisible();
  await expect(ownerPage.getByText("committee-brief.md")).toHaveCount(0);
  await expect(ownerPage.getByText("Upload document")).toHaveCount(0);

  // ====== committee_member: record access widens, officer powers do not ======

  await section(page, "committee").click();
  await page.getByTestId("committee-member").click();
  await page.getByRole("option", { name: `Alex Owner (${ownerEmail})` }).click();
  await page.getByTestId("committee-role").click();
  await page.getByRole("option", { name: "Committee member", exact: true }).click();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("committee-list").getByText("committee member")).toBeVisible();

  // Fresh load so the owner's role query reflects the new membership.
  await ownerPage.reload();

  // Committee-tier document is now listed and readable…
  await section(ownerPage, "documents").click();
  await expect(ownerPage.getByText("committee-brief.md")).toBeVisible();
  await ownerPage.getByRole("button", { name: "View committee-brief.md" }).click();
  await expect(ownerPage.getByText("quotes under negotiation")).toBeVisible();
  await ownerPage.keyboard.press("Escape");
  // …but committee_member is NOT an officer: still no upload card, no invite
  // buttons, no activate button.
  await expect(ownerPage.getByText("Upload document")).toHaveCount(0);
  await section(ownerPage, "people").click();
  await expect(ownerPage.getByTestId(`person-${kimEmail}`)).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Invite" })).toHaveCount(0);
  await section(ownerPage, "overview").click();
  await expect(
    ownerPage.getByText(
      "An office holder will activate the scheme once the checklist is complete.",
    ),
  ).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Activate scheme" })).toHaveCount(0);

  await ownerContext.close();
});
