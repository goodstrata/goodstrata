import { expect, test } from "@playwright/test";

const API = "http://localhost:3105";

// Register-index navigation (sidebar on desktop) — same helper as onboarding.
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

// Fresh identities per run so the spec is re-runnable and parallel-safe
// alongside the other specs sharing gs_e2e.
const runId = Date.now().toString(36);
const MANAGER_EMAIL = `griev.mgr.${runId}@example.com`;
const OWNER_EMAIL = `griev.owner.${runId}@example.com`;
const SCHEME_NAME = `9 Gavel St Owners Corporation ${runId}`;

const CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,10,10,residential,Nina Neighbour,nina.${runId}@example.com
2,10,10,residential,Ava Owner,${OWNER_EMAIL}`;

test.describe.configure({ mode: "serial" });

test("grievance loop: owner lodges → officer advances, breach notice, resolves; compliance calendar", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);

  // ---------- Setup: manager + scheme + people + joined owner ----------
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Greta Manager");
  await page.getByPlaceholder("you@example.com").fill(MANAGER_EMAIL);
  await page.getByPlaceholder("Choose a password").fill("grievance-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page.getByPlaceholder("e.g. 48 Rose St Owners Corporation").fill(SCHEME_NAME);
  await page.getByPlaceholder("e.g. PS543210V").fill("PS610009G");
  await page.getByPlaceholder("Street address").fill("9 Gavel Street");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();

  // Lots CSV creates the people register (complainants/respondents).
  await section(page, "lots").click();
  await page.getByTestId("csv-input").fill(CSV);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Nina Neighbour" })).toBeVisible();

  // Invite Ava and accept from her own browser context.
  await section(page, "people").click();
  await page.getByTestId(`person-${OWNER_EMAIL}`).getByRole("button", { name: "Invite" }).click();
  await expect(page.getByTestId(`person-${OWNER_EMAIL}`).getByText("invited")).toBeVisible();
  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const inviteEmail = outbox.emails.find((e: { to: string }) => e.to === OWNER_EMAIL);
  expect(inviteEmail).toBeTruthy();
  const joinUrl = inviteEmail.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await ownerPage.getByPlaceholder("Your name").fill("Ava Owner");
  await ownerPage.getByPlaceholder("Choose a password").fill("owner-pass-456");
  await ownerPage.getByRole("button", { name: "Create account & join" }).click();
  await ownerPage.waitForURL(/\/schemes\//);

  // ---------- Owner view: raise a complaint, track the 28-day clock ----------
  await section(ownerPage, "grievances").click();
  // Non-officers get the confidential intake, never the register stat cards.
  await expect(ownerPage.getByText("Raise a complaint in confidence")).toBeVisible();
  await expect(ownerPage.getByText("Due within 7 days")).toHaveCount(0);

  await ownerPage.getByRole("button", { name: "Raise a complaint" }).first().click();
  await ownerPage.getByTestId("complaint-subject").fill("Noise from lot 1 after 11pm");
  await ownerPage
    .getByTestId("complaint-details")
    .fill("Repeated loud music past midnight through the party wall.");
  // Name a respondent so the officer can issue a breach notice later.
  await ownerPage.getByTestId("complaint-respondent").click();
  await ownerPage.getByRole("option", { name: "Nina Neighbour" }).click();
  await ownerPage.getByRole("button", { name: "Lodge complaint" }).click();
  await expect(
    ownerPage.getByText("Complaint lodged — your committee has 28 days to deal with it"),
  ).toBeVisible();

  // The owner's own list shows the complaint with the statutory clock running.
  await expect(ownerPage.getByRole("heading", { name: "Your complaints" })).toBeVisible();
  await expect(ownerPage.getByText("Noise from lot 1 after 11pm")).toBeVisible();
  await expect(ownerPage.getByText("received", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText(/Must be dealt with by .* 28 days left/)).toBeVisible();

  // ---------- Officer view: register, advance, breach notice ----------
  await section(page, "grievances").click();
  // Officer register: statutory stat cards + the lodged complaint.
  await expect(page.getByText("Overdue", { exact: true })).toBeVisible();
  await expect(page.getByText("Due within 7 days")).toBeVisible();
  await page.getByText("Noise from lot 1 after 11pm").click();

  // Detail sheet: no status chosen yet → the update button stays disabled.
  const updateStatus = page.getByRole("button", { name: "Update status" });
  await expect(updateStatus).toBeDisabled();

  // Advance received → under discussion (note left empty: it's optional).
  await page.getByTestId("complaint-advance-status").click();
  await page.getByRole("option", { name: "under discussion" }).click();
  await expect(updateStatus).toBeEnabled();
  await updateStatus.click();
  await expect(page.getByText("Complaint updated").first()).toBeVisible();

  // Issue a breach notice against the named respondent — 28-day rectify clock.
  await page.getByRole("button", { name: "Issue breach notice" }).click();
  await page.getByTestId("breach-rule").fill("Model Rule 1.1 (noise)");
  await page.getByTestId("breach-details").fill("Cease amplified music after 11pm.");
  await page.getByRole("button", { name: "Issue notice", exact: true }).click();
  await expect(page.getByText("Breach notice issued — 28 days to rectify")).toBeVisible();
  await expect(
    page.getByText(/Model Rule 1\.1 \(noise\) · rectify by .* 28 days left/),
  ).toBeVisible();

  // Close the notice as rectified; its action buttons disappear.
  await page.getByRole("button", { name: "Mark rectified" }).click();
  await expect(page.getByText("Notice marked rectified")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark rectified" })).toHaveCount(0);
  await expect(page.getByText("rectified", { exact: true }).first()).toBeVisible();

  // Resolve the complaint: the state machine then offers nothing further.
  await page.getByTestId("complaint-advance-status").click();
  await page.getByRole("option", { name: "resolved" }).click();
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(
    page.getByText("This complaint is closed. No further status changes are available."),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Register recounts: nothing open, the resolved matter behind "Show closed".
  await expect(page.getByText("Nothing open")).toBeVisible();
  await page.getByRole("button", { name: /Show closed \(1\)/ }).click();
  await expect(page.getByText("Noise from lot 1 after 11pm")).toBeVisible();
  await expect(page.getByText("resolved", { exact: true })).toBeVisible();

  // The owner's tracker reflects the closure too.
  await ownerPage.reload();
  await section(ownerPage, "grievances").click();
  await expect(ownerPage.getByText("resolved", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText(/^Closed/)).toBeVisible();

  // ---------- Complaint about no one: breach notice unavailable ----------
  // The manager's login has no person row, so they must name the complainant
  // explicitly; the respondent stays "No one in particular".
  await page.getByRole("button", { name: "Raise a complaint" }).click();
  await page.getByTestId("complaint-subject").fill("Bins blocking the driveway");
  await page.getByTestId("complaint-details").fill("Shared driveway blocked every collection day.");
  await page.getByTestId("complaint-complainant").click();
  await page.getByRole("option", { name: "Nina Neighbour" }).click();
  await page.getByRole("button", { name: "Lodge complaint" }).click();
  await expect(
    page.getByText("Complaint lodged — your committee has 28 days to deal with it"),
  ).toBeVisible();

  await page.getByText("Bins blocking the driveway").click();
  // No respondent → the issue button is replaced by the explanatory paragraph.
  await expect(page.getByText(/A breach notice needs someone to be addressed to/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Issue breach notice" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // ---------- Compliance calendar: officer adds, completes; owner read-only ----------
  const dueOn = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

  await section(page, "compliance").click();
  await page.getByRole("button", { name: "Add obligation" }).click();
  await page.getByPlaceholder("e.g. Fire panel annual service").fill("Fire panel quarterly test");
  await page.locator('#add-obligation-form input[type="date"]').fill(dueOn);
  await page.getByRole("button", { name: "Add to calendar" }).click();
  await expect(
    page.getByText("Obligation added — it will escalate as the due date nears"),
  ).toBeVisible();

  // It lands in the custom group with the ≤30-day escalation band and the
  // per-category default responsible role (custom → manager admin).
  await expect(page.getByRole("heading", { name: /Other obligations/ })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Fire panel quarterly test" });
  await expect(row.getByText("≤ 30 days")).toBeVisible();
  await expect(row.getByText("manager admin")).toBeVisible();

  // Owners see the calendar but no officer controls.
  await section(ownerPage, "compliance").click();
  await expect(ownerPage.getByText("Fire panel quarterly test")).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Add obligation" })).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: /Mark .* done/ })).toHaveCount(0);

  // Mark it done: it leaves the open window and reappears under Show completed.
  await row.getByRole("button", { name: /Mark .* done/ }).click();
  await expect(page.getByText("Obligation marked done")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Fire panel quarterly test" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Show completed" }).click();
  const doneRow = page.getByRole("listitem").filter({ hasText: "Fire panel quarterly test" });
  await expect(doneRow.getByText("done", { exact: true })).toBeVisible();

  await ownerContext.close();
});
