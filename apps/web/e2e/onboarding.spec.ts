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
});
