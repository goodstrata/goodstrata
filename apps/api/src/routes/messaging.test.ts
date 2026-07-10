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
import { messagingRoutes } from "./messaging.js";

/**
 * Route-level permutations for private messaging:
 *  - a member can open a conversation with the committee or a specific officer
 *  - plain member↔member is rejected at the service (403 through the envelope)
 *  - non-members of the scheme get 404 from the membership middleware
 *  - members who aren't participants get 404 from the service (no existence leak)
 *  - unread badge + markRead round-trip
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;

const CHAIR = "msg-user-chair";
const OWNER = "msg-user-owner";
const OWNER2 = "msg-user-owner2";
const OUTSIDER = "msg-user-outsider";

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

  // Fake session: identity from a header, then the REAL scheme-membership
  // middleware runs against the real database (same as app.ts wiring).
  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user")!;
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", messagingRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Messaging Route Test OC",
      planOfSubdivision: "PS888003M",
      addressLine1: "3 Route St",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 5,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, OWNER, OWNER2, OUTSIDER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2026-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2026-01-01" },
    { schemeId, userId: OWNER2, role: "owner", startedOn: "2026-01-01" },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

interface ConversationPayload {
  conversation: { id: string; unreadCount: number; otherParticipants: { userId: string }[] };
  message: { id: string; body: string };
}

describe("messaging routes", () => {
  it("member starts a committee conversation, officer replies, unread + markRead round-trip", async () => {
    const started = await req(OWNER, "/messages/conversations", {
      json: {
        subject: "Bin room",
        body: "The bin room door is jammed",
        to: { kind: "committee" },
      },
    });
    expect(started.status).toBe(201);
    const { conversation } = await json<ConversationPayload>(started);
    expect(conversation.otherParticipants.map((p) => p.userId)).toEqual([CHAIR]);

    // The chair's badge and inbox see it.
    const badge = await req(CHAIR, "/messages/unread-count");
    expect(badge.status).toBe(200);
    expect(await json<{ unread: number }>(badge)).toEqual({ unread: 1 });

    const inbox = await req(CHAIR, "/messages/conversations");
    expect(inbox.status).toBe(200);
    const inboxBody = await json<{ conversations: { id: string; unreadCount: number }[] }>(inbox);
    expect(inboxBody.conversations.find((c) => c.id === conversation.id)?.unreadCount).toBe(1);

    // Chair reads the thread and replies.
    const thread = await req(CHAIR, `/messages/conversations/${conversation.id}/messages`);
    expect(thread.status).toBe(200);
    const threadBody = await json<{ messages: { body: string }[] }>(thread);
    expect(threadBody.messages[0]!.body).toBe("The bin room door is jammed");

    const read = await req(CHAIR, `/messages/conversations/${conversation.id}/read`, { json: {} });
    expect(read.status).toBe(200);
    expect(await json<{ unread: number }>(await req(CHAIR, "/messages/unread-count"))).toEqual({
      unread: 0,
    });

    const reply = await req(CHAIR, `/messages/conversations/${conversation.id}/messages`, {
      json: { body: "Locksmith booked for Tuesday" },
    });
    expect(reply.status).toBe(201);

    // The owner now has one unread; the chair (sender) still has none.
    expect(await json<{ unread: number }>(await req(OWNER, "/messages/unread-count"))).toEqual({
      unread: 1,
    });
    expect(await json<{ unread: number }>(await req(CHAIR, "/messages/unread-count"))).toEqual({
      unread: 0,
    });
  });

  it("rejects member↔member with 403 and validates the payload with 422", async () => {
    const forbidden = await req(OWNER, "/messages/conversations", {
      json: { body: "hey neighbour", to: { kind: "user", userId: OWNER2 } },
    });
    expect(forbidden.status).toBe(403);
    expect((await json<ErrorEnvelope>(forbidden)).error.code).toBe("FORBIDDEN");

    const invalid = await req(OWNER, "/messages/conversations", {
      json: { body: "", to: { kind: "committee" } },
    });
    expect(invalid.status).toBe(422);
  });

  it("non-members get 404 from the membership guard; non-participants get 404 from the service", async () => {
    const started = await req(OWNER, "/messages/conversations", {
      json: { body: "participants only", to: { kind: "committee" } },
    });
    const { conversation } = await json<ConversationPayload>(started);

    // OUTSIDER holds no membership: the scheme itself reads as not found.
    for (const path of [
      "/messages/conversations",
      "/messages/unread-count",
      `/messages/conversations/${conversation.id}/messages`,
    ]) {
      const res = await req(OUTSIDER, path);
      expect(res.status).toBe(404);
    }

    // OWNER2 is a member but not a participant: same 404, nothing leaked.
    const asMember = await req(OWNER2, `/messages/conversations/${conversation.id}/messages`);
    expect(asMember.status).toBe(404);
    expect((await json<ErrorEnvelope>(asMember)).error.code).toBe("NOT_FOUND");

    const sendAttempt = await req(OWNER2, `/messages/conversations/${conversation.id}/messages`, {
      json: { body: "sneaking in" },
    });
    expect(sendAttempt.status).toBe(404);

    const readAttempt = await req(OWNER2, `/messages/conversations/${conversation.id}/read`, {
      json: {},
    });
    expect(readAttempt.status).toBe(404);
  });
});
