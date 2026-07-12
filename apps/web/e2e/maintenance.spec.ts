import { expect, test } from "@playwright/test";
import { attemptId, attemptPlan } from "./test-fixtures";

const API = "http://localhost:3105";

// Scheme navigation is a register index of section links (see onboarding.spec).
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

const SCHEME_NAME = "77 Spanner St Owners Corporation";
const REPORT_SUBMITTED = "Thanks — your report's in. The maintenance agent will take it from here.";

test.describe.configure({ mode: "serial" });

/**
 * Maintenance family journey: officer manages the contractor pool (with
 * client-side validation permutations), any member reports issues (trim
 * validation, lot vs common property), and a plain owner sees the member
 * surface but none of the officer controls.
 */
test("maintenance: contractor pool + report issue validation + owner role gating", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const id = attemptId(testInfo);
  const managerEmail = `maint.mgr.${id}@example.com`;
  const ownerEmail = `maint.owner.${id}@example.com`;

  // --- Manager signs up and creates the scheme through the wizard ---
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Mel Manager");
  await page.getByPlaceholder("you@example.com").fill(managerEmail);
  await page.getByPlaceholder("Choose a password").fill("maint-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page.getByPlaceholder("e.g. 48 Rose St Owners Corporation").fill(SCHEME_NAME);
  await page.getByPlaceholder("e.g. PS543210V").fill(attemptPlan("77", "M", testInfo));
  await page.getByPlaceholder("Street address").fill("77 Spanner Street");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();

  // Equal-share lots so the report dialog has a lot select to exercise.
  await expect(page.getByRole("heading", { name: "Add your lots" })).toBeVisible();
  await page.getByPlaceholder("e.g. 8").fill("6");
  await page.getByRole("button", { name: "Add lots & continue" }).click();

  // Invite an owner (wizard default role is "owner") for the gating half.
  await expect(page.getByRole("heading", { name: /Invite your committee/ })).toBeVisible();
  await page.getByPlaceholder("name@example.com").fill(ownerEmail);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(ownerEmail)).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();

  await section(page, "maintenance").click();

  // ================= Contractor pool (officer only) =================

  // Maintenance sections are sub-tabs now; the pool lives under "Contractors".
  await page.getByRole("tab", { name: "Contractors" }).click();
  await expect(page.getByRole("tabpanel", { name: "Contractors" })).toBeVisible();
  await page.getByRole("button", { name: "New contractor" }).click();
  await page.getByTestId("contractor-name").fill("Fitzroy Sparks");
  await page.getByTestId("contractor-email").fill("notanemail");
  await page.getByTestId("contractor-trades").fill(",,,");
  await page.getByRole("button", { name: "Add contractor" }).click();

  // A malformed email is stopped by the browser's native type="email"
  // validation BEFORE the zod layer runs (the form has no noValidate), so no
  // custom copy renders — assert the native block: dialog open, input invalid.
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("contractor-email")).toHaveJSProperty("validity.valid", false);

  // With a well-formed email, the zod layer rejects an all-commas trade list
  // on its field; the dialog stays open and nothing is created.
  await page.getByTestId("contractor-email").fill("sparks@example.com");
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByText("List at least one trade, separated by commas.")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Fix the trades: comma list splits and trims into separate trade badges.
  await page.getByTestId("contractor-trades").fill("plumbing, electrical");
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByText("Contractor added to the pool")).toBeVisible();
  const contractorRow = page.locator("li").filter({ hasText: "Fitzroy Sparks" });
  await expect(contractorRow.getByText("plumbing", { exact: true })).toBeVisible();
  await expect(contractorRow.getByText("electrical", { exact: true })).toBeVisible();

  // ================= Report issue (trim validation, lot select) =================

  // Back to the Requests sub-tab where the request list + report triggers live.
  await page.getByRole("tab", { name: "Requests" }).click();
  // Two triggers exist while the request list is empty (header + empty state).
  await page.getByRole("button", { name: "Report an issue" }).first().click();
  await page.getByTestId("mr-title").fill("   ");
  await page.getByTestId("mr-description").fill("   ");
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Give the issue a short title.")).toBeVisible();
  await expect(page.getByText("Describe the issue so the agent can triage it.")).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible(); // nothing submitted

  await page.getByTestId("mr-title").fill("Leaking roof over lobby");
  await page.getByTestId("mr-description").fill("Water pooling near the mailboxes after rain.");
  await page.getByTestId("mr-lot").click();
  await page.getByRole("option", { name: "Lot 2", exact: true }).click();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText(REPORT_SUBMITTED)).toBeVisible();
  const requestCard = page.getByTestId("mr-Leaking roof over lobby");
  await expect(requestCard).toBeVisible();
  await expect(requestCard.getByText("open", { exact: true })).toBeVisible();

  // ================= Owner: member surface, no officer controls =================

  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const invite = outbox.emails.find((e: { to: string; text: string }) => e.to === ownerEmail);
  expect(invite).toBeTruthy();
  const joinUrl = invite.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await ownerPage.getByPlaceholder("Your name").fill("Olive Owner");
  await ownerPage.getByPlaceholder("Choose a password").fill("owner-pass-123");
  await ownerPage.getByRole("button", { name: "Create account & join" }).click();
  await ownerPage.waitForURL(/\/schemes\//);

  await section(ownerPage, "report an issue").click();

  // Any member can watch requests — the manager's report is visible.
  await expect(ownerPage.getByTestId("mr-Leaking roof over lobby")).toBeVisible();

  // Officer-only surfaces are absent for an owner: no contractor pool at all,
  // no raise/complete controls anywhere.
  await expect(ownerPage.getByRole("button", { name: "Report an issue" }).first()).toBeVisible();
  await expect(ownerPage.getByText("Contractor pool")).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: "New contractor" })).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: "Raise work order" })).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: "Mark completed" })).toHaveCount(0);

  // …and an owner can report an issue themselves (any-member action).
  await ownerPage.getByRole("button", { name: "Report an issue" }).first().click();
  await ownerPage.getByTestId("mr-title").fill("Broken intercom at entry");
  await ownerPage.getByTestId("mr-description").fill("Buzzer to lot 2 has stopped working.");
  await ownerPage.getByRole("button", { name: "Submit report" }).click();
  await expect(ownerPage.getByText(REPORT_SUBMITTED)).toBeVisible();
  await expect(ownerPage.getByTestId("mr-Broken intercom at entry")).toBeVisible();

  // The manager's polling list (3s refetch) picks the owner's report up
  // without a reload — Playwright waits, no sleeps.
  await expect(page.getByTestId("mr-Broken intercom at entry")).toBeVisible({ timeout: 15_000 });

  await ownerContext.close();
});
