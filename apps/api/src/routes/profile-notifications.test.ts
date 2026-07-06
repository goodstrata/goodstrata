import { DomainError } from "@goodstrata/core";
import { notificationPreferences, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { NOTIFICATION_DEFAULTS, systemClock } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { profileRoutes } from "./profile.js";

/**
 * Route-level behaviour for the per-user notification preferences endpoints:
 *  - GET returns the full type × channel matrix (defaults filled in) grouped
 *    for the settings screen, plus phone-on-file state.
 *  - PATCH upserts one or many (type, channel, enabled) for the SESSION user
 *    only — the body carries no userId, so prefs can never be written for
 *    another account.
 *  - bad type/channel/enabled surface as the 422 validation envelope.
 *  - smsAvailable follows users.phone (or a linked people.phone).
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;

const ALICE = "prefs-user-alice";
const BOB = "prefs-user-bob";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

interface PrefsPayload {
  smsAvailable: boolean;
  phone: string | null;
  groups: Array<{
    key: string;
    label: string;
    types: Array<{
      type: string;
      label: string;
      help: string;
      channels: { in_app: boolean; email: boolean; sms: boolean };
    }>;
  }>;
}

function req(userId: string, init?: { method?: string; json?: unknown }) {
  return app.request("/profile/notification-preferences", {
    method: init?.method ?? (init?.json !== undefined ? "PATCH" : "GET"),
    headers: {
      "x-test-user": userId,
      ...(init?.json !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
}

/** Pull one type's channel row out of the grouped payload. */
function channelsFor(payload: PrefsPayload, type: string) {
  for (const group of payload.groups) {
    const found = group.types.find((t) => t.type === type);
    if (found) return found.channels;
  }
  throw new Error(`type ${type} not in payload`);
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
    .route("/profile", profileRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  await tdb.db.insert(users).values([
    { id: ALICE, name: ALICE, email: `${ALICE}@example.com` },
    { id: BOB, name: BOB, email: `${BOB}@example.com` },
  ]);
});

afterAll(async () => {
  await tdb.cleanup();
});

describe("GET /profile/notification-preferences", () => {
  it("returns the full grouped matrix with defaults when no rows exist", async () => {
    const res = await req(ALICE);
    expect(res.status).toBe(200);
    const body = await json<PrefsPayload>(res);

    // Every type from the shared registry is present exactly once.
    const types = body.groups.flatMap((g) => g.types.map((t) => t.type));
    expect(new Set(types).size).toBe(Object.keys(NOTIFICATION_DEFAULTS).length);

    // Effective channels equal the shared defaults for a user with zero rows.
    for (const [type, def] of Object.entries(NOTIFICATION_DEFAULTS)) {
      expect(channelsFor(body, type)).toEqual(def);
    }

    // No phone on file → SMS not available.
    expect(body.smsAvailable).toBe(false);
    expect(body.phone).toBeNull();

    // Labels/help come from the registry (copy lives in one place).
    const decision = channelsFor(body, "decision.requested");
    expect(decision.sms).toBe(true);
  });

  it("reflects a stored override on top of the default", async () => {
    // decision.requested defaults sms:true; turn it off.
    const patch = await req(ALICE, {
      json: { type: "decision.requested", channel: "sms", enabled: false },
    });
    expect(patch.status).toBe(200);

    const res = await req(ALICE);
    const body = await json<PrefsPayload>(res);
    expect(channelsFor(body, "decision.requested").sms).toBe(false);
    // Other channels of the same type keep their defaults.
    expect(channelsFor(body, "decision.requested").in_app).toBe(true);
    expect(channelsFor(body, "decision.requested").email).toBe(true);
  });
});

describe("PATCH /profile/notification-preferences", () => {
  it("upserts a single edit and returns the fresh payload", async () => {
    // community.comment.created defaults email:false; turn it on.
    const res = await req(ALICE, {
      json: { type: "community.comment.created", channel: "email", enabled: true },
    });
    expect(res.status).toBe(200);
    const body = await json<PrefsPayload>(res);
    expect(channelsFor(body, "community.comment.created").email).toBe(true);

    // A second edit on the same key updates in place (no duplicate row).
    await req(ALICE, {
      json: { type: "community.comment.created", channel: "email", enabled: false },
    });
    const rows = await tdb.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, ALICE),
          eq(notificationPreferences.notificationType, "community.comment.created"),
          eq(notificationPreferences.channel, "email"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });

  it("applies a batch of edits under `updates`", async () => {
    const res = await req(ALICE, {
      json: {
        updates: [
          { type: "levy.notice.issued", channel: "sms", enabled: true },
          { type: "work_order.dispatched", channel: "email", enabled: true },
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = await json<PrefsPayload>(res);
    expect(channelsFor(body, "levy.notice.issued").sms).toBe(true);
    expect(channelsFor(body, "work_order.dispatched").email).toBe(true);
  });

  it("writes prefs only for the session user, never another account", async () => {
    await req(BOB, {
      json: { type: "minutes.drafted", channel: "sms", enabled: true },
    });
    // Bob's edit does not appear under Alice.
    const aliceRows = await tdb.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, ALICE),
          eq(notificationPreferences.notificationType, "minutes.drafted"),
          eq(notificationPreferences.channel, "sms"),
        ),
      );
    expect(aliceRows).toHaveLength(0);

    const bobBody = await json<PrefsPayload>(await req(BOB));
    expect(channelsFor(bobBody, "minutes.drafted").sms).toBe(true);
    const aliceBody = await json<PrefsPayload>(await req(ALICE));
    // Alice's minutes.drafted sms stays at its default (false).
    expect(channelsFor(aliceBody, "minutes.drafted").sms).toBe(false);
  });

  it("rejects an unknown type/channel with the 422 validation envelope", async () => {
    const badType = await req(ALICE, {
      json: { type: "not.a.real.type", channel: "sms", enabled: true },
    });
    expect(badType.status).toBe(422);
    expect((await json<ErrorEnvelope>(badType)).error.code).toBe("VALIDATION");

    const badChannel = await req(ALICE, {
      json: { type: "decision.requested", channel: "post", enabled: true },
    });
    expect(badChannel.status).toBe(422);

    const badEnabled = await req(ALICE, {
      json: { type: "decision.requested", channel: "sms", enabled: "yes" },
    });
    expect(badEnabled.status).toBe(422);
  });
});

describe("smsAvailable / phone", () => {
  it("is true once users.phone is set", async () => {
    await tdb.db.update(users).set({ phone: "+61400000001" }).where(eq(users.id, BOB));
    const body = await json<PrefsPayload>(await req(BOB));
    expect(body.smsAvailable).toBe(true);
    expect(body.phone).toBe("+61400000001");
  });

  it("falls back to a linked people.phone when users.phone is unset", async () => {
    const schemeRows = await tdb.db
      .insert(schemes)
      .values({
        name: "Prefs Phone OC",
        planOfSubdivision: "PS777001R",
        addressLine1: "1 Pref St",
        suburb: "Carlton",
        postcode: "3053",
        tier: 2,
        status: "active",
      })
      .returning();
    await tdb.db.insert(people).values({
      schemeId: schemeRows[0]!.id,
      userId: ALICE,
      givenName: "Alice",
      familyName: "Owner",
      phone: "+61400000002",
    });
    const body = await json<PrefsPayload>(await req(ALICE));
    expect(body.smsAvailable).toBe(true);
    expect(body.phone).toBe("+61400000002");
  });
});
