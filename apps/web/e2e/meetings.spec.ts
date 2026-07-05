import { expect, test } from "@playwright/test";

const API = "http://localhost:3105";

// Scheme navigation is a register index of section links (see onboarding.spec).
const section = (p: import("@playwright/test").Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

// Fresh identities per run so the spec is re-runnable against a persistent stack.
const runId = Date.now().toString(36);
const MANAGER_EMAIL = `mgr.mtg.${runId}@example.com`;
const OWNER_EMAIL = `alex.mtg.${runId}@example.com`;
const SCHEME_NAME = "9 Ballot Box Owners Corporation";
const MEETING_TITLE = "August special general meeting";

const CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,20,20,commercial,Sam Shopkeeper,sam.mtg.${runId}@example.com
2,10,10,residential,Alex Owner,${OWNER_EMAIL}`;

/**
 * Meetings permutation journey: officer vs owner gating, the SGM status
 * machine (draft → notice_sent → closed), voting standing/conflict errors
 * surfaced inline, poll demand, tally basis rendering, and the bad deep link.
 * Happy-path AGM flow already lives in onboarding.spec.ts.
 */
test("meetings permutations: role gating, voting errors, polls, close, bad deep link", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  // --- Manager signs up and registers the scheme via the wizard ---
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("Morgan Manager");
  await page.getByPlaceholder("you@example.com").fill(MANAGER_EMAIL);
  await page.getByPlaceholder("Choose a password").fill("manager-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page.getByPlaceholder("e.g. 48 Rose St Owners Corporation").fill(SCHEME_NAME);
  await page.getByPlaceholder("e.g. PS543210V").fill("PS610009M");
  await page.getByPlaceholder("Street address").fill("9 Ballot Box Lane");
  await page.getByPlaceholder("Suburb").fill("Northcote");
  await page.getByPlaceholder("Postcode").fill("3070");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();
  const schemeId = /\/schemes\/([^/?#]+)/.exec(page.url())![1]!;

  // --- Lots with owners, then Alex joins as a plain (non-officer) owner ---
  await section(page, "lots").click();
  await page.getByTestId("csv-input").fill(CSV);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Alex Owner" })).toBeVisible();

  await section(page, "people").click();
  await page.getByTestId(`person-${OWNER_EMAIL}`).getByRole("button", { name: "Invite" }).click();
  await expect(page.getByTestId(`person-${OWNER_EMAIL}`).getByText("invited")).toBeVisible();

  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const invite = outbox.emails.find((e: { to: string; text: string }) => e.to === OWNER_EMAIL);
  expect(invite).toBeTruthy();
  const joinUrl = invite.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await ownerPage.getByPlaceholder("Your name").fill("Alex Owner");
  await ownerPage.getByPlaceholder("Choose a password").fill("owner-pass-123");
  await ownerPage.getByRole("button", { name: "Create account & join" }).click();
  await ownerPage.waitForURL(/\/schemes\//);

  // --- Officer schedules an SGM (video is never offered for SGMs) ---
  const sgmDate = new Date(Date.now() + 30 * 86_400_000);
  const sgmLocal = `${sgmDate.toISOString().slice(0, 10)}T18:00`;

  await section(page, "meetings").click();
  await page.getByRole("button", { name: "New meeting" }).click();
  await page.getByTestId("meeting-kind").click();
  await page.getByRole("option", { name: "Special general meeting" }).click();
  await page.getByTestId("meeting-title").fill(MEETING_TITLE);
  await page.getByTestId("meeting-when").fill(sgmLocal);
  await page.getByTestId("meeting-agenda").fill("Bike rack proposal");
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  await page.getByRole("button", { name: new RegExp(MEETING_TITLE) }).click();
  // Officer sees the draft action.
  await expect(page.getByRole("button", { name: "Send notice" })).toBeVisible();

  // --- Owner gating: no scheduling, and a draft is read-only ---
  await section(ownerPage, "meetings").click();
  await expect(ownerPage.getByRole("button", { name: new RegExp(MEETING_TITLE) })).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "New meeting" })).toHaveCount(0);
  await ownerPage.getByRole("button", { name: new RegExp(MEETING_TITLE) }).click();
  await expect(
    ownerPage.getByText("This meeting is still a draft — the notice hasn't gone out yet."),
  ).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Send notice" })).toHaveCount(0);

  // --- Notice goes out; SGM never shows the video call panel ---
  await page.getByRole("button", { name: "Send notice" }).click();
  await expect(page.getByText("notice sent", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join video call" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start video meeting" })).toHaveCount(0);

  // --- Officer adds two motions and opens voting on both ---
  await page.getByRole("button", { name: "New motion" }).click();
  await page.getByTestId("motion-title").fill("Install a bike rack");
  await page.getByTestId("motion-text").fill("That the OC installs a bike rack.");
  await page.getByRole("button", { name: "Add motion", exact: true }).click();
  const ordinaryCard = page.getByTestId("motion-Install a bike rack");
  await ordinaryCard.getByRole("button", { name: "Open voting" }).click();
  await expect(ordinaryCard.getByText("open", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New motion" }).click();
  await page.getByTestId("motion-title").fill("Adopt renovation rules");
  await page.getByTestId("motion-text").fill("That the OC adopts new renovation rules.");
  await page.getByLabel("Resolution type").click();
  await page.getByRole("option", { name: "Special resolution (75%)" }).click();
  await page.getByRole("button", { name: "Add motion", exact: true }).click();
  const specialCard = page.getByTestId("motion-Adopt renovation rules");
  await specialCard.getByRole("button", { name: "Open voting" }).click();
  await expect(specialCard.getByText("open", { exact: true })).toBeVisible();

  // --- Owner's detail view polls every 3s: the open motions arrive by themselves ---
  const ownerOrdinary = ownerPage.getByTestId("motion-Install a bike rack");
  const ownerSpecial = ownerPage.getByTestId("motion-Adopt renovation rules");
  await expect(ownerOrdinary.getByTestId("vote-lot")).toBeVisible({ timeout: 10_000 });
  // Owner is not an officer: no motion admin, no meeting close.
  await expect(ownerPage.getByRole("button", { name: "New motion" })).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: "Close & tally" })).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: "Close meeting" })).toHaveCount(0);

  // --- Attendance drives the quorum bar (Alex = 10 of 30 entitlements) ---
  await ownerPage.getByRole("button", { name: "I'm attending" }).click();
  await expect(ownerPage.getByTestId("quorum")).toContainText("10/30", { timeout: 10_000 });
  await expect(ownerPage.getByTestId("quorum")).toContainText("not yet quorate");

  // --- Voting: buttons disabled until a lot is chosen ---
  await expect(ownerOrdinary.getByRole("button", { name: "for", exact: true })).toBeDisabled();
  await expect(ownerOrdinary.getByText("Choose your lot to record a vote.")).toBeVisible();

  // --- Voting for someone else's lot: server 403 surfaces inline, not a toast ---
  await ownerOrdinary.getByTestId("vote-lot").click();
  await ownerPage.getByRole("option", { name: "Lot 1", exact: true }).click();
  await ownerOrdinary.getByRole("button", { name: "for", exact: true }).click();
  await expect(ownerOrdinary.getByRole("alert")).toContainText("not an owner of this lot", {
    timeout: 10_000,
  });

  // --- Correct lot: the vote records, then a second vote conflicts inline ---
  await ownerOrdinary.getByTestId("vote-lot").click();
  await ownerPage.getByRole("option", { name: "Lot 2", exact: true }).click();
  await ownerOrdinary.getByRole("button", { name: "for", exact: true }).click();
  await expect(ownerPage.getByText("Vote recorded")).toBeVisible();
  await ownerOrdinary.getByRole("button", { name: "for", exact: true }).click();
  await expect(ownerOrdinary.getByRole("alert")).toContainText("already been cast", {
    timeout: 10_000,
  });

  // --- Demand a poll (ordinary only); the badge replaces the button ---
  await ownerOrdinary.getByRole("button", { name: "Demand a poll" }).click();
  await expect(ownerOrdinary.getByText("Poll demanded")).toBeVisible();
  await expect(ownerOrdinary.getByRole("button", { name: "Demand a poll" })).toHaveCount(0);
  // Special resolutions never offer a poll.
  await expect(ownerSpecial.getByTestId("vote-lot")).toBeVisible();
  await expect(ownerSpecial.getByRole("button", { name: "Demand a poll" })).toHaveCount(0);

  // --- Owner appoints a proxy for their own lot (selects load on open) ---
  await ownerPage.getByRole("button", { name: "Appoint a proxy" }).click();
  await ownerPage.getByTestId("proxy-lot").click();
  await ownerPage.getByRole("option", { name: "Lot 2", exact: true }).click();
  await ownerPage.getByTestId("proxy-person").click();
  await ownerPage.getByRole("option", { name: "Sam Shopkeeper" }).click();
  await ownerPage.getByRole("button", { name: "Appoint proxy" }).click();
  await expect(ownerPage.getByText("Proxy appointed for this meeting")).toBeVisible();

  // --- Officer tallies: the demanded poll decides by entitlement ---
  await ordinaryCard.getByRole("button", { name: "Close & tally" }).click();
  await expect(ordinaryCard.getByText("carried")).toBeVisible();
  await expect(ordinaryCard.getByText(/For 10 · Against 0 · Abstain 0/)).toBeVisible();
  await expect(
    ordinaryCard.getByText(/decided by lot entitlement \(poll demanded\)/),
  ).toBeVisible();

  // The untouched special resolution is lost on the entitlement basis (0 of 30).
  await specialCard.getByRole("button", { name: "Close & tally" }).click();
  await expect(specialCard.getByText("lost", { exact: true })).toBeVisible();
  await expect(specialCard.getByText(/For 0 · Against 0 · Abstain 0/)).toBeVisible();
  await expect(specialCard.getByText(/decided by lot entitlement$/)).toBeVisible();

  // --- Close the meeting under quorum: final quorum wording, motion admin gone ---
  await page.getByRole("button", { name: "Close meeting" }).click();
  await expect(page.getByText("Meeting closed — minutes are being drafted")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Final quorum" })).toBeVisible();
  await expect(page.getByTestId("quorum")).toContainText("quorum was not reached");
  await expect(page.getByRole("button", { name: "New motion" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I'm attending" })).toHaveCount(0);

  // --- Bad deep link (?meeting=…) shows the error state; back still works ---
  await page.goto(`/schemes/${schemeId}?section=meetings&meeting=not-a-real-meeting`);
  await expect(page.getByText("We couldn't load this meeting.")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "All meetings" }).click();
  await expect(page.getByRole("button", { name: new RegExp(MEETING_TITLE) })).toBeVisible();

  await ownerContext.close();
});
