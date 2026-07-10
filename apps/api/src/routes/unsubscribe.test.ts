import { unsubscribeService } from "@goodstrata/core";
import { notificationPreferences, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemClock } from "@goodstrata/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import { unsubscribeRoutes } from "./unsubscribe.js";

/**
 * The unauthenticated one-click unsubscribe endpoint:
 *  - GET with a valid token flips the user's email pref off for the token's
 *    type and answers a small confirmation page.
 *  - POST (RFC 8058 one-click) does the same and answers 200 JSON.
 *  - An invalid/absent token is a 400 that writes nothing.
 */

const SECRET = "test-unsubscribe-secret";
const ALICE = "unsub-user-alice";

let tdb: TestDatabase;
let app: Hono;

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const deps = {
    env: { UNSUBSCRIBE_SECRET: SECRET, BETTER_AUTH_SECRET: "x".repeat(32) },
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;

  app = new Hono().route("/api/unsubscribe", unsubscribeRoutes(deps));

  await tdb.db.insert(users).values({ id: ALICE, name: ALICE, email: `${ALICE}@example.com` });
});

afterAll(async () => {
  await tdb.cleanup();
});

async function aliceLevyEmailPref() {
  return await tdb.db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, ALICE),
        eq(notificationPreferences.notificationType, "levy.notice.issued"),
        eq(notificationPreferences.channel, "email"),
      ),
    );
}

describe("GET /api/unsubscribe", () => {
  it("flips the email pref off and confirms with the type's label", async () => {
    const token = unsubscribeService.createUnsubscribeToken(SECRET, ALICE, "levy.notice.issued");
    const res = await app.request(`/api/unsubscribe?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("You're unsubscribed");
    expect(html).toContain("Levy notices");

    const rows = await aliceLevyEmailPref();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });

  it("rejects a tampered token with 400 and writes nothing", async () => {
    await tdb.db.delete(notificationPreferences);
    const token = unsubscribeService.createUnsubscribeToken(SECRET, ALICE, "levy.notice.issued");
    const res = await app.request(`/api/unsubscribe?token=${encodeURIComponent(`${token}x`)}`);
    expect(res.status).toBe(400);
    expect(await aliceLevyEmailPref()).toHaveLength(0);

    const missing = await app.request("/api/unsubscribe");
    expect(missing.status).toBe(400);
  });
});

describe("POST /api/unsubscribe (RFC 8058 one-click)", () => {
  it("flips the pref and answers 200 JSON", async () => {
    await tdb.db.delete(notificationPreferences);
    const token = unsubscribeService.createUnsubscribeToken(SECRET, ALICE, "levy.notice.issued");
    const res = await app.request(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await aliceLevyEmailPref();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });

  it("answers 400 for a bad token", async () => {
    const res = await app.request("/api/unsubscribe?token=garbage", { method: "POST" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });
});
