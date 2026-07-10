import { DomainError } from "@goodstrata/core";
import { memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemClock } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { communityRoutes } from "./community.js";

/**
 * Route-level committee-channel permutations: the officer tier (chair /
 * secretary / treasurer / committee_member / manager_admin) may create and see
 * committee-visibility posts; a plain owner gets 403 on create and 404 (never
 * 403) on every read/interaction path, so the post's existence never leaks.
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;

const CHAIR = "user-chair-cvr";
const COMMITTEE = "user-committee-cvr";
const OWNER = "user-owner-cvr";
const OUTSIDER = "user-outsider-cvr";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

function req(userId: string, path: string, init?: { method?: string; json?: unknown }) {
  return app.request(`/schemes/${schemeId}${path}`, {
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: {
      "x-test-user": userId,
      ...(init?.json !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  deps = {
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;

  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user")!;
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", communityRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Committee Channel Route OC",
      planOfSubdivision: "PS888002V",
      addressLine1: "8 Channel Ct",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, COMMITTEE, OWNER, OUTSIDER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2026-01-01" },
    { schemeId, userId: COMMITTEE, role: "committee_member", startedOn: "2026-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2026-01-01" },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("creating committee posts", () => {
  it("plain owner gets 403 FORBIDDEN", async () => {
    const res = await req(OWNER, "/community/posts", {
      json: { body: "trying the back door", visibility: "committee" },
    });
    expect(res.status).toBe(403);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("committee_member and chair can create one", async () => {
    for (const userId of [COMMITTEE, CHAIR]) {
      const res = await req(userId, "/community/posts", {
        json: { body: `committee note by ${userId}`, visibility: "committee" },
      });
      expect(res.status).toBe(201);
      const { post } = await json<{ post: { visibility: string } }>(res);
      expect(post.visibility).toBe("committee");
    }
  });

  it("422 for a bogus visibility value", async () => {
    const res = await req(CHAIR, "/community/posts", {
      json: { body: "bad visibility", visibility: "secret" },
    });
    expect(res.status).toBe(422);
  });
});

describe("committee posts are 404 to a plain owner on every path", () => {
  let postId: string;
  let commentId: string;

  beforeAll(async () => {
    const created = await req(CHAIR, "/community/posts", {
      json: { body: "quiet levy discussion", visibility: "committee" },
    });
    ({
      post: { id: postId },
    } = await json<{ post: { id: string } }>(created));
    const commented = await req(CHAIR, `/community/posts/${postId}/comments`, {
      json: { body: "I'll draft the numbers" },
    });
    ({
      comment: { id: commentId },
    } = await json<{ comment: { id: string } }>(commented));
  });

  it("feed: hidden from the owner, visible to officers", async () => {
    const ownerFeed = await json<{ posts: { id: string }[] }>(await req(OWNER, "/community/posts"));
    expect(ownerFeed.posts.find((p) => p.id === postId)).toBeUndefined();

    for (const userId of [CHAIR, COMMITTEE]) {
      const feed = await json<{ posts: { id: string }[] }>(await req(userId, "/community/posts"));
      expect(feed.posts.find((p) => p.id === postId)).toBeDefined();
    }
  });

  it("GET by id → 404 for the owner, 200 for an officer", async () => {
    const denied = await req(OWNER, `/community/posts/${postId}`);
    expect(denied.status).toBe(404);
    const allowed = await req(COMMITTEE, `/community/posts/${postId}`);
    expect(allowed.status).toBe(200);
  });

  it("comment → 404 for the owner", async () => {
    const res = await req(OWNER, `/community/posts/${postId}/comments`, {
      json: { body: "can I join?" },
    });
    expect(res.status).toBe(404);
  });

  it("post like → 404 for the owner", async () => {
    const res = await req(OWNER, `/community/posts/${postId}/like`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("comment like → 404 for the owner, works for an officer", async () => {
    const denied = await req(OWNER, `/community/comments/${commentId}/like`, { method: "POST" });
    expect(denied.status).toBe(404);
    const allowed = await req(COMMITTEE, `/community/comments/${commentId}/like`, {
      method: "POST",
    });
    expect(allowed.status).toBe(200);
  });

  it("non-member still gets 404 on the feed (scheme existence never leaked)", async () => {
    const res = await req(OUTSIDER, "/community/posts");
    expect(res.status).toBe(404);
  });
});

describe("scheme posts and moderation are unchanged", () => {
  it("owner posts to the open board; everyone sees it; an officer can remove it", async () => {
    const created = await req(OWNER, "/community/posts", { json: { body: "BBQ on Saturday" } });
    expect(created.status).toBe(201);
    const { post } = await json<{ post: { id: string; visibility: string } }>(created);
    expect(post.visibility).toBe("scheme");

    const ownerFeed = await json<{ posts: { id: string }[] }>(await req(OWNER, "/community/posts"));
    expect(ownerFeed.posts.find((p) => p.id === post.id)).toBeDefined();

    const removed = await req(CHAIR, `/community/posts/${post.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
  });
});
