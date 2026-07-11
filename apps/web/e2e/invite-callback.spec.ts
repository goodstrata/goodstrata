import { expect, type Page, test } from "@playwright/test";

const API = "http://localhost:3105";
const runId = Date.now().toString(36);
const MANAGER_EMAIL = `manager.invite-callback.${runId}@example.com`;
const OWNER_EMAIL = `owner.invite-callback.${runId}@example.com`;
const SCHEME_NAME = `Invite callback ${runId}`;

const section = (page: Page, name: string) =>
  page.getByRole("link", { name: new RegExp(`^${name}$`, "i") });

test("invite signup preserves the token in its verification callback", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("Morgan Manager");
  await page.getByPlaceholder("you@example.com").fill(MANAGER_EMAIL);
  await page.getByPlaceholder("Choose a password").fill("manager-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: /set up your building/i })).toBeVisible();
  await page.getByPlaceholder("e.g. 48 Rose St Owners Corporation").fill(SCHEME_NAME);
  await page.getByPlaceholder("e.g. PS543210V").fill("PS765432C");
  await page.getByPlaceholder("Street address").fill("7 Callback Lane");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();

  await section(page, "lots").click();
  await page
    .getByTestId("csv-input")
    .fill(
      `lot_number,entitlement,liability,lot_type,owner_name,owner_email\n1,10,10,residential,Alex Owner,${OWNER_EMAIL}`,
    );
  await page.getByRole("button", { name: "Import lots" }).click();
  await expect(page.getByRole("cell", { name: "Alex Owner" })).toBeVisible();

  await section(page, "people").click();
  const ownerRow = page.getByTestId(`person-${OWNER_EMAIL}`);
  await ownerRow.getByRole("button", { name: "Invite" }).click();
  await expect(ownerRow.getByText("invited")).toBeVisible();

  const outbox = await (await fetch(`${API}/dev/outbox`)).json();
  const invite = outbox.emails.find(
    (email: { to: string; text: string }) => email.to === OWNER_EMAIL,
  );
  const joinUrl = invite?.text.match(/http:\/\/\S+\/join\?token=\S+/)?.[0] as string | undefined;
  expect(joinUrl).toBeTruthy();
  const token = new URL(joinUrl!).searchParams.get("token");
  expect(token).toBeTruthy();

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(joinUrl!);
  await expect(ownerPage.getByText(/invited as/)).toBeVisible();
  await ownerPage.getByPlaceholder("Choose a password").fill("owner-pass-123");

  const signupRequest = ownerPage.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes("/api/auth/sign-up/email"),
  );
  await ownerPage.getByRole("button", { name: "Create account & join" }).click();
  const signupBody = (await signupRequest).postDataJSON() as { callbackURL?: string };
  expect(signupBody.callbackURL).toBe(`/join?token=${encodeURIComponent(token!)}`);
  await ownerPage.waitForURL(/\/schemes\//);
  await ownerContext.close();
});
