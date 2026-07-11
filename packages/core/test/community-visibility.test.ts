import { schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as community from "../src/services/community.js";

/**
 * Committee-only visibility on the community board. Committee posts must be
 * invisible AND inaccessible to non-officers on every path — the feed, the
 * thread, comments, likes, image bytes and even the feed cursor anchor — and
 * only the officer tier may create them.
 */

let tdb: TestDatabase;
let schemeId: string;

const CHAIR = "user-chair-cv";
const OWNER = "user-owner-cv";

const OFFICER = { isOfficer: true };
const PLAIN = { isOfficer: false };

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

function ctx(actor: Actor = userActor(CHAIR)): ServiceContext {
  return { db: tdb.db, clock: fixedClock("2026-07-03T00:00:00Z"), integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Committee Channel OC",
      planOfSubdivision: "PS777001V",
      addressLine1: "7 Quorum Ct",
      suburb: "Carlton",
      postcode: "3053",
      tier: 3,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  await tdb.db.insert(users).values([
    { id: CHAIR, name: "Casey Chair", email: "chair-cv@example.com" },
    { id: OWNER, name: "Olly Owner", email: "owner-cv@example.com" },
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

describe("creating committee posts", () => {
  it("rejects a non-officer creating a committee-visibility post", async () => {
    await expect(
      community.createPost(
        ctx(userActor(OWNER)),
        schemeId,
        { body: "sneaky", visibility: "committee" },
        [],
        PLAIN,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("defaults to scheme visibility when none is given", async () => {
    const post = await community.createPost(ctx(userActor(OWNER)), schemeId, { body: "open post" });
    expect(post.visibility).toBe("scheme");
  });

  it("lets an officer create a committee post", async () => {
    const post = await community.createPost(
      ctx(),
      schemeId,
      { body: "quiet committee chat", visibility: "committee" },
      [],
      OFFICER,
    );
    expect(post.visibility).toBe("committee");
  });
});

describe("committee posts are invisible & inaccessible to non-officers", () => {
  let committeePostId: string;
  let committeeImageId: string;
  let committeeCommentId: string;

  beforeAll(async () => {
    const post = await community.createPost(
      ctx(),
      schemeId,
      { body: "levy strategy — committee eyes only", visibility: "committee" },
      [png("secret")],
      OFFICER,
    );
    committeePostId = post.id;
    committeeImageId = post.images[0]!.id;
    const { comment } = await community.addComment(
      ctx(),
      schemeId,
      committeePostId,
      { body: "agreed" },
      OFFICER,
    );
    committeeCommentId = comment.id;
  });

  it("is filtered out of the plain-owner feed but present in the officer feed", async () => {
    const ownerFeed = await community.listFeed(
      ctx(userActor(OWNER)),
      schemeId,
      OWNER,
      undefined,
      PLAIN,
    );
    expect(ownerFeed.posts.find((p) => p.id === committeePostId)).toBeUndefined();

    const officerFeed = await community.listFeed(ctx(), schemeId, CHAIR, undefined, OFFICER);
    const found = officerFeed.posts.find((p) => p.id === committeePostId);
    expect(found).toBeDefined();
    expect(found!.visibility).toBe("committee");
  });

  it("thread read is NOT_FOUND (not 403) for a plain owner", async () => {
    await expect(
      community.getThread(ctx(userActor(OWNER)), schemeId, committeePostId, OWNER, PLAIN),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Officer still reads the full thread.
    const { post } = await community.getThread(ctx(), schemeId, committeePostId, CHAIR, OFFICER);
    expect(post.comments).toHaveLength(1);
  });

  it("commenting is NOT_FOUND for a plain owner", async () => {
    await expect(
      community.addComment(ctx(userActor(OWNER)), schemeId, committeePostId, { body: "hi" }, PLAIN),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("post like is NOT_FOUND for a plain owner; officer can like", async () => {
    await expect(
      community.togglePostLike(ctx(userActor(OWNER)), schemeId, committeePostId, OWNER, PLAIN),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const on = await community.togglePostLike(ctx(), schemeId, committeePostId, CHAIR, OFFICER);
    expect(on.liked).toBe(true);
  });

  it("comment like is NOT_FOUND for a plain owner", async () => {
    await expect(
      community.toggleCommentLike(
        ctx(userActor(OWNER)),
        schemeId,
        committeeCommentId,
        OWNER,
        PLAIN,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("image bytes are NOT_FOUND for a plain owner; officer can read them", async () => {
    await expect(
      community.getPostImage(ctx(userActor(OWNER)), schemeId, committeeImageId, PLAIN),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { bytes } = await community.getPostImage(ctx(), schemeId, committeeImageId, OFFICER);
    expect(new TextDecoder().decode(bytes)).toBe("fake-png-secret");
  });

  it("channel=committee lists only committee posts for an officer, nothing for a plain owner", async () => {
    const officerChannel = await community.listFeed(
      ctx(),
      schemeId,
      CHAIR,
      undefined,
      OFFICER,
      "committee",
    );
    expect(officerChannel.posts.length).toBeGreaterThan(0);
    expect(officerChannel.posts.every((p) => p.visibility === "committee")).toBe(true);

    // For a non-officer the channel filter composes with their scheme-only
    // scope into a contradiction: an empty page, not a leak.
    const ownerProbe = await community.listFeed(
      ctx(userActor(OWNER)),
      schemeId,
      OWNER,
      undefined,
      PLAIN,
      "committee",
    );
    expect(ownerProbe.posts).toHaveLength(0);
  });

  it("a committee post id cannot anchor a non-officer feed cursor", async () => {
    // For a non-officer the anchor lookup excludes committee posts, so the
    // cursor behaves exactly like a nonexistent id (empty page, no probe).
    const probed = await community.listFeed(
      ctx(userActor(OWNER)),
      schemeId,
      OWNER,
      committeePostId,
      PLAIN,
    );
    expect(probed.posts).toHaveLength(0);
    // An officer can keep paging from the same anchor.
    const officerPage = await community.listFeed(ctx(), schemeId, CHAIR, committeePostId, OFFICER);
    expect(Array.isArray(officerPage.posts)).toBe(true);
  });

  it("moderation is unchanged: an officer can still remove the committee post", async () => {
    const post = await community.createPost(
      ctx(),
      schemeId,
      { body: "to be withdrawn", visibility: "committee" },
      [],
      OFFICER,
    );
    await community.deletePost(ctx(), schemeId, post.id, { userId: CHAIR, canModerate: true });
    await expect(
      community.getThread(ctx(), schemeId, post.id, CHAIR, OFFICER),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
