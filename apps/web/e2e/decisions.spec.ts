import { expect, type Page, test } from "@playwright/test";
import { attemptId, attemptPlan, expectPrefilledInviteName } from "./test-fixtures";

const API = "http://localhost:3105";

// Scheme navigation is a register index of section links (see onboarding.spec).
const section = (p: Page, name: string) =>
  p.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

// Assigned by the serial setup test so a retry gets fresh global identities.
let MANAGER_EMAIL = "";
let PRIYA_EMAIL = "";
let OSCAR_EMAIL = "";
const MANAGER_PASS = "manager-pass-123";
const PRIYA_PASS = "treasurer-pass-123";
const OSCAR_PASS = "owner-pass-123";
const SCHEME_NAME = "7 Ballot Walk Owners Corporation";

let CSV = "";

test.describe.configure({ mode: "serial" });

/** Sign in with existing credentials and land on the scheme page. */
async function loginToScheme(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Your password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your schemes" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("link", { name: new RegExp(SCHEME_NAME) }).click();
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();
}

/** Accept a /join?token= invite from the dev outbox in a fresh context. */
async function acceptInvite(
  browser: import("@playwright/test").Browser,
  email: string,
  name: string,
  password: string,
): Promise<Page> {
  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const invite = outbox.emails.find((e: { to: string; text: string }) => e.to === email);
  expect(invite).toBeTruthy();
  const joinUrl = invite.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0];
  expect(joinUrl).toBeTruthy();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(joinUrl!);
  await expect(page.getByText(/invited as/)).toBeVisible();
  await expectPrefilledInviteName(page, name);
  await page.getByPlaceholder("Choose a password").fill(password);
  await page.getByRole("button", { name: "Create account & join" }).click();
  await page.waitForURL(/\/schemes\//);
  return page;
}

test("treasurer decision: owner is read-only, treasurer resolves with a note, poll race surfaces inline", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const id = attemptId(testInfo);
  MANAGER_EMAIL = `mgr.decisions.${id}@example.com`;
  PRIYA_EMAIL = `priya.decisions.${id}@example.com`;
  OSCAR_EMAIL = `oscar.decisions.${id}@example.com`;
  CSV = `lot_number,entitlement,liability,lot_type,owner_name,owner_email
1,10,10,residential,Priya Owner,${PRIYA_EMAIL}
2,10,10,residential,Oscar Owner,${OSCAR_EMAIL}`;

  // --- Manager signs up and registers the scheme (wizard step 1 only) ---
  await page.goto("/login");
  await page.getByRole("link", { name: "New here? Create an account" }).click();
  await page.getByPlaceholder("Your name").fill("Morgan Manager");
  await page.getByPlaceholder("you@example.com").fill(MANAGER_EMAIL);
  await page.getByPlaceholder("Choose a password").fill(MANAGER_PASS);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page.getByPlaceholder("e.g. 48 Rose St Owners Corporation").fill(SCHEME_NAME);
  await page.getByPlaceholder("e.g. PS543210V").fill(attemptPlan("70", "B", testInfo));
  await page.getByPlaceholder("Street address").fill("7 Ballot Walk");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();
  await expect(page.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();

  // --- Lots with owner emails, then invite both owners ---
  await section(page, "lots").click();
  await page.getByTestId("csv-input").fill(CSV);
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Priya Owner" })).toBeVisible();

  await section(page, "people").click();
  const priyaRow = page.getByTestId(`person-${PRIYA_EMAIL}`);
  await priyaRow.getByRole("button", { name: "Invite" }).click();
  await expect(priyaRow.getByText("invited")).toBeVisible();
  const oscarRow = page.getByTestId(`person-${OSCAR_EMAIL}`);
  await oscarRow.getByRole("button", { name: "Invite" }).click();
  await expect(oscarRow.getByText("invited")).toBeVisible();

  // --- Both accept; keep their sessions for the decision permutations ---
  const priyaPage = await acceptInvite(browser, PRIYA_EMAIL, "Priya Owner", PRIYA_PASS);
  const oscarPage = await acceptInvite(browser, OSCAR_EMAIL, "Oscar Owner", OSCAR_PASS);

  // --- Priya becomes the treasurer ---
  await section(page, "committee").click();
  await page.getByTestId("committee-member").click();
  await page.getByRole("option", { name: `Priya Owner (${PRIYA_EMAIL})` }).click();
  await page.getByTestId("committee-role").click();
  await page.getByRole("option", { name: "Treasurer", exact: true }).click();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByTestId("committee-list").getByText("treasurer")).toBeVisible();

  // --- Insurance + activation (finance flows need an active scheme) ---
  await section(page, "documents").click();
  await page.getByTestId("doc-file").setInputFiles({
    name: "certificate-of-currency.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake insurance certificate"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("certificate-of-currency.pdf")).toBeVisible();
  await section(page, "overview").click();
  await page.getByRole("button", { name: "Activate scheme" }).click();
  await expect(page.getByRole("heading", { name: "Financial position" })).toBeVisible();

  // --- Draft a budget: opens the treasurer-tier decision gate ---
  await section(page, "finance").click();
  await page.getByRole("button", { name: "New budget" }).click();
  await page.getByTestId("budget-fy").fill("2026-07-01");
  await page.getByTestId("budget-admin").fill("48000");
  await page.getByTestId("budget-maintenance").fill("12000");
  await page.getByRole("button", { name: "Draft budget" }).click();
  await expect(page.getByText("committee review")).toBeVisible();

  // --- Oscar (plain owner) is read-only: message, no buttons, no note field ---
  await section(oscarPage, "decisions").click();
  await expect(oscarPage.getByRole("heading", { name: "Pending decisions" })).toBeVisible();
  const oscarCard = oscarPage.getByTestId("decision-budget_adoption");
  await expect(oscarCard).toBeVisible();
  await expect(oscarCard.getByText(/This decision is with the treasurer/)).toBeVisible();
  await expect(oscarCard.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(oscarCard.getByLabel("Note for the record (optional)")).toHaveCount(0);

  // --- Priya (treasurer) holds the pen: "Waiting on you" with resolve buttons ---
  // Priya's session predates the treasurer assignment; reload so her role
  // query refetches (a real promoted user sees it on their next page load).
  await priyaPage.reload();
  await expect(priyaPage.getByRole("heading", { name: SCHEME_NAME })).toBeVisible();
  await section(priyaPage, "decisions").click();
  await expect(priyaPage.getByRole("heading", { name: "Waiting on you" })).toBeVisible();
  const priyaCard = priyaPage.getByTestId("decision-budget_adoption");
  await expect(priyaCard.getByRole("button", { name: "Approve" })).toBeVisible();
  await priyaCard
    .getByLabel("Note for the record (optional)")
    .fill("Figures match the maintenance plan.");

  // --- Poll race: the server says someone already resolved it. The resolve
  // mutation has NO error toast, so the 409 must surface as the inline alert.
  const resolveRace = (url: URL) => url.pathname.endsWith("/resolve");
  await priyaPage.route(resolveRace, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "ALREADY_RESOLVED", message: "This decision has already been resolved" },
      }),
    });
  });
  await priyaCard.getByRole("button", { name: "Approve" }).click();
  await expect(priyaCard.getByRole("alert")).toHaveText("This decision has already been resolved");
  await expect(priyaPage.getByText("Decision recorded")).toHaveCount(0);
  await priyaPage.unroute(resolveRace);

  // --- Real resolve: toast, empty inbox, and an audit-trail History row ---
  await priyaCard.getByRole("button", { name: "Approve" }).click();
  await expect(priyaPage.getByText("Decision recorded")).toBeVisible();
  await expect(priyaPage.getByText("Nothing to decide")).toBeVisible();

  const history = priyaPage
    .locator("section")
    .filter({ has: priyaPage.getByRole("heading", { name: "History" }) });
  await expect(history.getByText("approved")).toBeVisible();
  await history.getByRole("button").first().click();
  await expect(history.getByText("“Approve”")).toBeVisible();
  await expect(history.getByText("by Priya Owner")).toBeVisible();
  await expect(history.getByText("Figures match the maintenance plan.")).toBeVisible();

  await priyaPage.context().close();
  await oscarPage.context().close();
});

// ---------------------------------------------------------------------------
// Committee-tier permutations. Committee decisions are opened by the agents /
// maintenance routing, so these mock the decision + tally endpoints to pin the
// CommitteeVotePanel behaviour (custom labels, tally maths, my-vote state,
// read-only variant, and the ResolveButtons fallback under a failing tally).
// ---------------------------------------------------------------------------

const committeeDecision = (overrides: Record<string, unknown> = {}) => ({
  id: "dec-mock-committee",
  kind: "emergency_review",
  title: "Emergency works dispatched — $2,300.00 (Fitzroy Plumbing Co)",
  summaryMd: "Post-hoc review of emergency works: acknowledge, or flag for discussion.",
  options: [
    { id: "approve", label: "Acknowledge" },
    { id: "decline", label: "Flag for discussion" },
  ],
  evidence: [],
  deciderRole: "committee",
  status: "pending",
  dueAt: null,
  createdAt: "2026-06-20T00:00:00.000Z",
  resolvedAt: null,
  decidedByName: null,
  decisionNote: null,
  resolution: null,
  ...overrides,
});

const isDecisionsList = (url: URL) => url.pathname.endsWith("/decisions");
const isVotesGet = (url: URL) => url.pathname.endsWith("/votes");
const isVotePost = (url: URL) => url.pathname.endsWith("/vote");

test("committee vote panel: custom labels, tally maths, overdue emphasis, my-vote state", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  await loginToScheme(page, MANAGER_EMAIL, MANAGER_PASS);
  const session = await (await page.request.get("/api/auth/get-session")).json();
  const myUserId: string = session.user.id;
  expect(myUserId).toBeTruthy();

  // Mutable tally: starts with one approval from another committee member.
  // 3 eligible → needs floor(3/2)+1 = 2 votes to carry.
  const tally: {
    votes: {
      userId: string;
      name: string;
      choice: string;
      note: string | null;
      createdAt: string;
    }[];
    votesFor: number;
    votesAgainst: number;
    eligible: number;
  } = {
    votes: [
      {
        userId: "user-terry",
        name: "Terry Treasurer",
        choice: "approve",
        note: "Fine by me",
        createdAt: "2026-06-21T00:00:00.000Z",
      },
    ],
    votesFor: 1,
    votesAgainst: 0,
    eligible: 3,
  };
  let votePostBody: { choice?: string; note?: string } | null = null;

  await page.route(isDecisionsList, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        // Overdue: past due date must render the critical treatment.
        decisions: [committeeDecision({ dueAt: "2026-01-15T00:00:00.000Z" })],
      }),
    }),
  );
  await page.route(isVotesGet, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tally),
    }),
  );
  await page.route(isVotePost, async (route) => {
    votePostBody = route.request().postDataJSON();
    tally.votes.push({
      userId: myUserId,
      name: "Morgan Manager",
      choice: "approve",
      note: votePostBody?.note ?? null,
      createdAt: "2026-06-22T00:00:00.000Z",
    });
    tally.votesFor = 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "approved", votesFor: 2, votesAgainst: 0, eligible: 3 }),
    });
  });

  await section(page, "decisions").click();
  const card = page.getByTestId("decision-emergency_review");
  await expect(card).toBeVisible();

  // Overdue treatment: badge + emphasised respond-by line.
  await expect(card.getByText("overdue")).toBeVisible();
  await expect(card.getByText(/respond by/)).toBeVisible();

  // Custom option labels ride on the approve/decline ids.
  const acknowledge = card.getByRole("button", { name: "Acknowledge" });
  const flag = card.getByRole("button", { name: "Flag for discussion" });
  await expect(acknowledge).toBeVisible();
  await expect(flag).toBeVisible();

  // Tally: 1 for, needs 2 of 3 eligible, per-voter row with note.
  await expect(card.getByText("1 for")).toBeVisible();
  await expect(card.getByText("2 needed · 3 eligible")).toBeVisible();
  await expect(
    card.getByRole("progressbar", { name: "1 of 2 votes needed to carry" }),
  ).toBeVisible();
  await expect(card.getByText("Terry Treasurer")).toBeVisible();
  await expect(card.getByText("Fine by me")).toBeVisible();

  // Vote with a note → toast, my-vote summary replaces the buttons, tally moves.
  await card.getByLabel("Note for the record (optional)").fill("Reviewed the invoice");
  await acknowledge.click();
  await expect(page.getByText("Vote recorded")).toBeVisible();
  expect(votePostBody).toEqual({ choice: "approve", note: "Reviewed the invoice" });
  await expect(card.getByText(/You voted for/)).toBeVisible();
  await expect(card.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
  await expect(card.getByText("2 for")).toBeVisible();

  // --- Oscar (plain owner, not committee): read-only tally, no vote controls ---
  const oscarContext = await browser.newContext();
  const oscarPage = await oscarContext.newPage();
  await loginToScheme(oscarPage, OSCAR_EMAIL, OSCAR_PASS);
  await oscarPage.route(isDecisionsList, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ decisions: [committeeDecision()] }),
    }),
  );
  await oscarPage.route(isVotesGet, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tally),
    }),
  );
  await section(oscarPage, "decisions").click();
  const oscarCard = oscarPage.getByTestId("decision-emergency_review");
  await expect(oscarCard.getByText(/This decision is with the committee/)).toBeVisible();
  // The running tally is visible to non-voters…
  await expect(oscarCard.getByText("2 for")).toBeVisible();
  await expect(oscarCard.getByText("2 needed · 3 eligible")).toBeVisible();
  // …but none of the voting controls are.
  await expect(oscarCard.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
  await expect(oscarCard.getByLabel("Note for the record (optional)")).toHaveCount(0);
  await oscarContext.close();
});

test("tally endpoint failure hides vote controls and offers a retry", async ({ page }) => {
  test.setTimeout(120_000);

  await loginToScheme(page, MANAGER_EMAIL, MANAGER_PASS);

  await page.route(isDecisionsList, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ decisions: [committeeDecision()] }),
    }),
  );
  // The tally endpoint is down — the panel must fall back, not blank out.
  await page.route(isVotesGet, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL", message: "tally unavailable" } }),
    }),
  );
  await section(page, "decisions").click();
  const card = page.getByTestId("decision-emergency_review");
  await expect(card).toBeVisible();

  // Vote state is unknown, so no possibly-duplicate action is offered.
  await expect(card.getByRole("alert")).toContainText("Couldn't check your vote.");
  await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Flag for discussion" })).toHaveCount(0);
  await expect(card.getByText("eligible")).toHaveCount(0);
});
