import { schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, agentActor, fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import { DomainError } from "../src/errors.js";
import * as community from "../src/services/community.js";

let tdb: TestDatabase;
let schemeId: string;

const ALICE = "user-alice-c";
const BOB = "user-bob-c";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

function ctx(actor: Actor = userActor(ALICE)): ServiceContext {
  return { db: tdb.db, clock: fixedClock("2026-07-03T00:00:00Z"), integrations, actor };
}

async function newScheme(name: string): Promise<string> {
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name,
      planOfSubdivision: `PS${Math.floor(Math.random() * 900000) + 100000}C`,
      addressLine1: "12 Board St",
      suburb: "Carlton",
      postcode: "3053",
      tier: 2,
      status: "active",
    })
    .returning();
  return rows[0]!.id;
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  schemeId = await newScheme("Community Test OC");
  await tdb.db.insert(users).values([
    { id: ALICE, name: "Alice Owner", email: "alice@example.com" },
    { id: BOB, name: "Bob Neighbour", email: "bob@example.com" },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

const png = (label: string) => ({
  filename: `${label}.png`,
  contentType: "image/png",
  content: new TextEncoder().encode(`fake-png-${label}`),
});

describe("posts", () => {
  it("creates a post with images and serves the bytes back", async () => {
    const post = await community.createPost(ctx(), schemeId, { body: "Pool is open again" }, [
      png("one"),
      png("two"),
    ]);

    expect(post.author.name).toBe("Alice Owner");
    expect(post.images).toHaveLength(2);
    expect(post.likeCount).toBe(0);
    expect(post.commentCount).toBe(0);

    const { row, bytes } = await community.getPostImage(ctx(), schemeId, post.images[0]!.id);
    expect(row.mime).toBe("image/png");
    expect(new TextDecoder().decode(bytes)).toBe("fake-png-one");

    const feed = await community.listFeed(ctx(), schemeId, BOB);
    const inFeed = feed.posts.find((p) => p.id === post.id);
    expect(inFeed).toBeDefined();
    expect(inFeed!.images).toHaveLength(2);
    expect(inFeed!.likedByMe).toBe(false);
  });

  it("rejects more than 8 images", async () => {
    const files = Array.from({ length: 9 }, (_, i) => png(`n${i}`));
    await expect(
      community.createPost(ctx(), schemeId, { body: "too many" }, files),
    ).rejects.toThrow(/at most 8 images/i);
  });

  it("rejects non-user actors (the AI never posts as the community)", async () => {
    await expect(
      community.createPost(ctx(agentActor("chair", "run-1")), schemeId, { body: "beep" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("scopes images to the scheme", async () => {
    const otherScheme = await newScheme("Other OC");
    const post = await community.createPost(ctx(), schemeId, { body: "scoped" }, [png("scoped")]);
    await expect(
      community.getPostImage(ctx(), otherScheme, post.images[0]!.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("comments and likes", () => {
  it("adds a comment, counts it in the feed, and soft-deletes it", async () => {
    const post = await community.createPost(ctx(), schemeId, { body: "BBQ on Saturday?" });
    const { comment } = await community.addComment(ctx(userActor(BOB)), schemeId, post.id, {
      body: "Count me in",
    });
    expect(comment.author.name).toBe("Bob Neighbour");

    let feed = await community.listFeed(ctx(), schemeId, ALICE);
    expect(feed.posts.find((p) => p.id === post.id)!.commentCount).toBe(1);

    // Alice is neither the comment author nor a moderator → forbidden.
    await expect(
      community.deleteComment(ctx(), schemeId, comment.id, { userId: ALICE, canModerate: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // An officer (canModerate) can remove it.
    await community.deleteComment(ctx(), schemeId, comment.id, {
      userId: ALICE,
      canModerate: true,
    });
    feed = await community.listFeed(ctx(), schemeId, ALICE);
    expect(feed.posts.find((p) => p.id === post.id)!.commentCount).toBe(0);

    const { post: thread } = await community.getThread(ctx(), schemeId, post.id, ALICE);
    expect(thread.comments).toHaveLength(0);
  });

  it("toggles post likes per user", async () => {
    const post = await community.createPost(ctx(), schemeId, { body: "New bike racks!" });

    const on = await community.togglePostLike(ctx(userActor(BOB)), schemeId, post.id, BOB);
    expect(on).toEqual({ liked: true, likeCount: 1 });

    const bobView = await community.listFeed(ctx(userActor(BOB)), schemeId, BOB);
    expect(bobView.posts.find((p) => p.id === post.id)!.likedByMe).toBe(true);
    const aliceView = await community.listFeed(ctx(), schemeId, ALICE);
    expect(aliceView.posts.find((p) => p.id === post.id)!.likedByMe).toBe(false);

    const off = await community.togglePostLike(ctx(userActor(BOB)), schemeId, post.id, BOB);
    expect(off).toEqual({ liked: false, likeCount: 0 });
  });

  it("toggles comment likes and rejects likes on removed comments", async () => {
    const post = await community.createPost(ctx(), schemeId, { body: "Garden working bee" });
    const { comment } = await community.addComment(ctx(userActor(BOB)), schemeId, post.id, {
      body: "I'll bring gloves",
    });

    const on = await community.toggleCommentLike(ctx(), schemeId, comment.id, ALICE);
    expect(on).toEqual({ liked: true, likeCount: 1 });

    await community.deleteComment(ctx(userActor(BOB)), schemeId, comment.id, {
      userId: BOB,
      canModerate: false,
    });
    await expect(
      community.toggleCommentLike(ctx(), schemeId, comment.id, ALICE),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("moderation (soft delete)", () => {
  it("lets only the author or a moderator remove a post", async () => {
    const post = await community.createPost(ctx(), schemeId, { body: "For sale: pot plants" });

    await expect(
      community.deletePost(ctx(userActor(BOB)), schemeId, post.id, {
        userId: BOB,
        canModerate: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await community.deletePost(ctx(), schemeId, post.id, { userId: ALICE, canModerate: false });

    const feed = await community.listFeed(ctx(), schemeId, ALICE);
    expect(feed.posts.find((p) => p.id === post.id)).toBeUndefined();
    await expect(community.getThread(ctx(), schemeId, post.id, ALICE)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Removed posts reject further interaction.
    await expect(
      community.addComment(ctx(userActor(BOB)), schemeId, post.id, { body: "late reply" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      community.togglePostLike(ctx(userActor(BOB)), schemeId, post.id, BOB),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Deleting again 404s rather than double-publishing the removal event.
    await expect(
      community.deletePost(ctx(), schemeId, post.id, { userId: ALICE, canModerate: true }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe("feed pagination", () => {
  it("pages the whole feed with no skips or duplicates, even with same-millisecond posts", async () => {
    // Isolated scheme so counts are exact.
    const pagedScheme = await newScheme("Paged OC");
    const created: string[] = [];
    for (let i = 0; i < 25; i++) {
      const p = await community.createPost(ctx(), pagedScheme, { body: `post ${i}` });
      created.push(p.id);
    }

    const page1 = await community.listFeed(ctx(), pagedScheme, ALICE);
    expect(page1.posts).toHaveLength(20);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await community.listFeed(ctx(), pagedScheme, ALICE, page1.nextCursor);
    expect(page2.posts).toHaveLength(5);
    expect(page2.nextCursor).toBeUndefined();

    const seen = [...page1.posts, ...page2.posts].map((p) => p.id);
    expect(new Set(seen).size).toBe(25);
    expect(new Set(seen)).toEqual(new Set(created));
    // Newest first.
    expect(page1.posts[0]!.id).toBe(created[created.length - 1]);
  });

  it("does not anchor on a cursor id from another scheme", async () => {
    const otherScheme = await newScheme("Cursor Probe OC");
    const foreign = await community.createPost(ctx(), otherScheme, { body: "foreign anchor" });
    // Anchor lookup is scheme-scoped: a foreign post id behaves exactly like a
    // nonexistent one (empty page), so cursors can't probe other schemes.
    const probed = await community.listFeed(ctx(), schemeId, ALICE, foreign.id);
    expect(probed.posts).toHaveLength(0);
    expect(probed.nextCursor).toBeUndefined();
  });

  it("still accepts a legacy ISO-date cursor", async () => {
    const feed = await community.listFeed(ctx(), schemeId, ALICE, "2100-01-01T00:00:00.000Z");
    expect(feed.posts.length).toBeGreaterThan(0);
  });
});
