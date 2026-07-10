import { DomainError } from "@goodstrata/core";
import { pushTokens, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemClock } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { profileRoutes } from "./profile.js";

/**
 * Route-level behaviour of the device push-token endpoints:
 *  - POST /profile/push-tokens registers for the SESSION user and upserts on
 *    the token (re-register refreshes; another account's sign-in re-points).
 *  - DELETE /profile/push-tokens removes only the session user's own row and
 *    is idempotent (sign-out never fails on an already-pruned token).
 *  - bad platform / missing token surface as the 422 validation envelope.
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;

const ALICE = "push-user-alice";
const BOB = "push-user-bob";
const TOKEN = "ExponentPushToken[route-test-1]";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  PUSH_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function req(userId: string, method: "POST" | "DELETE", json: unknown) {
  return app.request("/profile/push-tokens", {
    method,
    headers: { "x-test-user": userId, "content-type": "application/json" },
    body: JSON.stringify(json),
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

describe("POST /profile/push-tokens", () => {
  it("registers a device for the session user", async () => {
    const res = await req(ALICE, "POST", {
      token: TOKEN,
      platform: "ios",
      deviceName: "Alice's iPhone",
    });
    expect(res.status).toBe(201);

    const rows = await tdb.db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(ALICE);
    expect(rows[0]!.platform).toBe("ios");
    expect(rows[0]!.deviceName).toBe("Alice's iPhone");
  });

  it("upserts by token — re-registering refreshes, no duplicate row", async () => {
    const res = await req(ALICE, "POST", { token: TOKEN, platform: "ios" });
    expect(res.status).toBe(201);
    const rows = await tdb.db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN));
    expect(rows).toHaveLength(1);
    // deviceName follows the latest registration (now omitted → null).
    expect(rows[0]!.deviceName).toBeNull();
  });

  it("re-points a shared device when another account signs in", async () => {
    const res = await req(BOB, "POST", { token: TOKEN, platform: "ios" });
    expect(res.status).toBe(201);
    const rows = await tdb.db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(BOB);
  });

  it("rejects an unknown platform or missing token with the 422 envelope", async () => {
    const badPlatform = await req(ALICE, "POST", { token: "x", platform: "windows_phone" });
    expect(badPlatform.status).toBe(422);
    expect(((await badPlatform.json()) as ErrorEnvelope).error.code).toBe("VALIDATION");

    const noToken = await req(ALICE, "POST", { platform: "ios" });
    expect(noToken.status).toBe(422);
  });
});

describe("DELETE /profile/push-tokens", () => {
  it("only removes the session user's own registration", async () => {
    // TOKEN now belongs to BOB (re-pointed above); Alice's delete is a no-op.
    const asAlice = await req(ALICE, "DELETE", { token: TOKEN });
    expect(asAlice.status).toBe(200);
    expect(await asAlice.json()).toEqual({ ok: true, removed: 0 });
    expect(await tdb.db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN))).toHaveLength(
      1,
    );

    const asBob = await req(BOB, "DELETE", { token: TOKEN });
    expect(await asBob.json()).toEqual({ ok: true, removed: 1 });
    expect(await tdb.db.select().from(pushTokens).where(eq(pushTokens.token, TOKEN))).toHaveLength(
      0,
    );
  });

  it("is idempotent — deleting an already-pruned token still succeeds", async () => {
    const res = await req(BOB, "DELETE", { token: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: 0 });
  });
});
