import { expect, test } from "@playwright/test";
import { attemptId, attemptPlan, schemeIdFromPage } from "./test-fixtures";

test("communications surfaces stay scannable, recoverable and keyboard friendly", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const id = attemptId(testInfo);

  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("Casey Communicator");
  await page.getByPlaceholder("you@example.com").fill(`communications.${id}@example.com`);
  await page.getByPlaceholder("Choose a password").fill("communications-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();

  await page
    .getByPlaceholder("e.g. 48 Rose St Owners Corporation")
    .fill(`78 Ledger Lane Owners Corporation ${id}`);
  await page.getByPlaceholder("e.g. PS543210V").fill(attemptPlan("78", "C", testInfo));
  await page.getByPlaceholder("Street address").fill("78 Ledger Lane");
  await page.getByPlaceholder("Suburb").fill("Fitzroy");
  await page.getByPlaceholder("Postcode").fill("3065");
  await page.getByRole("button", { name: "Create building & continue" }).click();
  await page.getByRole("button", { name: "I'll add these later" }).click();
  await page.getByRole("button", { name: "I'll do this later" }).click();
  await page.getByRole("button", { name: "Go to your building" }).click();

  const schemeId = schemeIdFromPage(page);
  const now = new Date().toISOString();
  const inboxPattern = new RegExp(`/api/schemes/${schemeId}/messages/conversations(?:\\?.*)?$`);
  await page.route(inboxPattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      json: {
        conversations: [
          {
            id: "conversation-alex",
            subject: "Lift access",
            otherParticipants: [{ userId: "alex", name: "Alex Owner", image: null }],
            lastMessage: { body: "The key is ready", senderUserId: "alex", createdAt: now },
            unreadCount: 2,
            createdAt: now,
            lastMessageAt: now,
          },
          {
            id: "conversation-sam",
            subject: "Garden roster",
            otherParticipants: [{ userId: "sam", name: "Sam Resident", image: null }],
            lastMessage: { body: "Saturday works", senderUserId: "sam", createdAt: now },
            unreadCount: 0,
            createdAt: now,
            lastMessageAt: now,
          },
        ],
      },
    });
  });
  await page.route(
    new RegExp(
      `/api/schemes/${schemeId}/messages/conversations/conversation-alex/messages(?:\\?.*)?$`,
    ),
    async (route) => {
      await route.fulfill({
        json: {
          messages: [
            {
              id: "message-1",
              conversationId: "conversation-alex",
              body: "The key is ready",
              sender: { userId: "alex", name: "Alex Owner", image: null },
              createdAt: now,
            },
          ],
        },
      });
    },
  );
  await page.route(
    new RegExp(`/api/schemes/${schemeId}/messages/conversations/conversation-alex/read$`),
    async (route) => {
      await route.fulfill({ json: { conversationId: "conversation-alex", lastReadAt: now } });
    },
  );

  await page.goto(`/schemes/${schemeId}?section=messages`);
  const conversationSearch = page.getByLabel("Search loaded conversations");
  await expect(conversationSearch).toHaveAttribute("placeholder", "Search loaded conversations");
  await conversationSearch.fill("garden");
  await expect(page.getByText("Sam Resident", { exact: true })).toBeVisible();
  await expect(page.getByText("Alex Owner", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear conversation search" }).click();
  await page.getByRole("button", { name: "Unread only" }).click();
  await expect(page.getByText("Alex Owner", { exact: true })).toBeVisible();
  await expect(page.getByText("Sam Resident", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const alexRow = page.getByRole("button").filter({ hasText: "Alex Owner" });
  await alexRow.click();
  await expect(page.getByRole("heading", { name: "Alex Owner" })).toBeVisible();
  await page.getByRole("button", { name: "Back to conversations" }).click();
  await expect(alexRow).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 900 });

  const communityPattern = new RegExp(`/api/schemes/${schemeId}/community/posts(?:\\?.*)?$`);
  await page.route(communityPattern, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      json: {
        posts: [
          {
            id: "post-pool",
            body: "Pool gate will close early",
            status: "visible",
            visibility: "scheme",
            author: { userId: "ava", name: "Ava Owner", image: null },
            images: [],
            likeCount: 0,
            commentCount: 0,
            likedByMe: false,
            createdAt: now,
          },
          {
            id: "post-garden",
            body: "Garden working bee Saturday",
            status: "visible",
            visibility: "scheme",
            author: { userId: "sam", name: "Sam Resident", image: null },
            images: [],
            likeCount: 0,
            commentCount: 0,
            likedByMe: false,
            createdAt: now,
          },
        ],
      },
    });
  });
  let releaseLike: (() => void) | undefined;
  const likeHeld = new Promise<void>((resolve) => {
    releaseLike = resolve;
  });
  await page.route(
    new RegExp(`/api/schemes/${schemeId}/community/posts/post-pool/like$`),
    async (route) => {
      await likeHeld;
      await route.fulfill({ json: { liked: true, likeCount: 1 } });
    },
  );

  await page.goto(`/schemes/${schemeId}?section=community`);
  const postSearch = page.getByLabel("Search community posts");
  await expect(postSearch).toHaveAttribute("placeholder", "Search loaded posts");
  await postSearch.fill("garden");
  await expect(page.getByText("Garden working bee Saturday")).toBeVisible();
  await expect(page.getByText("Pool gate will close early")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear post search" }).click();
  await page.getByRole("button", { name: "Like post" }).first().click();
  const pendingLike = page.getByRole("button", { name: "Unlike post" }).first();
  await expect(pendingLike).toBeDisabled();
  releaseLike?.();
  await expect(pendingLike).toBeEnabled();

  await page.goto(`/schemes/${schemeId}?section=activity`);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const activitySearch = page.getByLabel("Search activity");
  await activitySearch.fill("an-event-that-does-not-exist");
  await expect(page.getByText("No activity matches these filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("event-feed")).toBeVisible();

  await page.goto(`/schemes/${schemeId}?section=committee`);
  await expect(
    page.getByText("No issued AGM is available. Send an AGM notice before recording its election."),
  ).toBeVisible();
  const ownerSearch = page.getByRole("textbox", { name: "Find an owner" });
  await ownerSearch.fill("nobody matches this");
  await expect(page.getByText("No members match this search.")).toBeVisible();

  const membersPattern = new RegExp(`/api/schemes/${schemeId}/members(?:\\?.*)?$`);
  await page.route(membersPattern, async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "TEMPORARILY_UNAVAILABLE",
          message: "The member register is temporarily unavailable",
        },
      },
    });
  });
  await page.reload();
  await expect(page.getByText("Couldn't load the committee workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(1);
});
