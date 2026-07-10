import { randomUUID } from "node:crypto";
import {
  lots,
  memberships,
  notificationPreferences,
  ownerships,
  people,
  pushTokens,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as notificationPreferencesService from "../src/services/notificationPreferences.js";
import * as notifierService from "../src/services/notifier.js";

/**
 * The push channel end to end in core:
 *  - registerPushToken upserts on the token (a shared device re-points to the
 *    new account) and removePushToken is user-scoped + idempotent.
 *  - resolveRecipientChannels includes push ONLY for users with both the pref
 *    on (default on everywhere) and at least one registered token.
 *  - the notifier fans a delivery out to every registered device with the
 *    in-app title/body and the deep-link data payload.
 *  - a DeviceNotRegistered ticket prunes the token row.
 */

let tdb: TestDatabase;
let schemeId: string;
let lotId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    PUSH_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};
const memoryPush = integrations.push as typeof integrations.push & {
  sent: { to: string; title: string; body: string; data?: Record<string, unknown> }[];
  deadTokens: Set<string>;
};

const NOW = "2026-07-02T00:00:00Z";
function ctxAs(actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

const CHAIR = "user-chair-push"; // committee, two devices
const TREASURER = "user-treasurer-push"; // committee, no devices
const OWNER = "user-owner-push"; // levy recipient of lot 1, one device

const CHAIR_TOKEN_1 = "ExponentPushToken[chair-1]";
const CHAIR_TOKEN_2 = "ExponentPushToken[chair-2]";
const OWNER_TOKEN = "ExponentPushToken[owner-1]";

function fakeEvent(type: string, payload: unknown): EventRecord {
  return {
    id: randomUUID(),
    seq: 0,
    schemeId,
    stream: "test",
    type,
    payload,
    actor: systemActor("test"),
    correlationId: randomUUID(),
    causationId: null,
    causationDepth: 0,
    occurredAt: new Date(NOW),
  };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "Push Test OC",
      planOfSubdivision: "PS777788P",
      addressLine1: "8 Push St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;

  await tdb.db.insert(users).values([
    { id: CHAIR, name: "Casey Chair", email: "chair-push@example.com" },
    { id: TREASURER, name: "Terry Treasurer", email: "treasurer-push@example.com" },
    { id: OWNER, name: "Olly Owner", email: "owner-push@example.com" },
  ]);
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: TREASURER, role: "treasurer", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2025-01-01" },
  ]);

  const ownerPerson = await tdb.db
    .insert(people)
    .values({
      schemeId,
      userId: OWNER,
      givenName: "Olly",
      familyName: "Owner",
      email: "owner-push@example.com",
    })
    .returning();
  const lotRows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "1", entitlement: 10, liability: 10 })
    .returning();
  lotId = lotRows[0]!.id;
  await tdb.db.insert(ownerships).values({
    schemeId,
    lotId,
    personId: ownerPerson[0]!.id,
    startedOn: "2025-01-01",
  });
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

beforeEach(async () => {
  memoryPush.sent.length = 0;
  memoryPush.deadTokens.clear();
  await tdb.db.delete(notificationPreferences);
  await tdb.db.delete(pushTokens);
  // Baseline devices: chair has two, owner one, treasurer none.
  await notificationPreferencesService.registerPushToken(ctxAs(), CHAIR, {
    token: CHAIR_TOKEN_1,
    platform: "ios",
    deviceName: "Casey's iPhone",
  });
  await notificationPreferencesService.registerPushToken(ctxAs(), CHAIR, {
    token: CHAIR_TOKEN_2,
    platform: "android",
  });
  await notificationPreferencesService.registerPushToken(ctxAs(), OWNER, {
    token: OWNER_TOKEN,
    platform: "ios",
  });
});

describe("registerPushToken / removePushToken", () => {
  it("upserts on the token — a shared device re-points to the new account", async () => {
    await notificationPreferencesService.registerPushToken(ctxAs(), TREASURER, {
      token: CHAIR_TOKEN_1,
      platform: "ios",
      deviceName: "Handed-down iPhone",
    });
    const rows = await tdb.db.query.pushTokens.findMany({
      where: eq(pushTokens.token, CHAIR_TOKEN_1),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(TREASURER);
    expect(rows[0]!.deviceName).toBe("Handed-down iPhone");
  });

  it("removePushToken is scoped to the owner and idempotent", async () => {
    // Another user cannot delete the chair's registration.
    expect(
      await notificationPreferencesService.removePushToken(ctxAs(), TREASURER, CHAIR_TOKEN_1),
    ).toEqual({ removed: 0 });

    expect(
      await notificationPreferencesService.removePushToken(ctxAs(), CHAIR, CHAIR_TOKEN_1),
    ).toEqual({ removed: 1 });
    // Second delete of the same token: quiet no-op.
    expect(
      await notificationPreferencesService.removePushToken(ctxAs(), CHAIR, CHAIR_TOKEN_1),
    ).toEqual({ removed: 0 });
  });
});

describe("resolveRecipientChannels — push", () => {
  it("includes push only for users with registered tokens (default pref on)", async () => {
    const resolved = await notificationPreferencesService.resolveRecipientChannels(
      ctxAs(),
      [CHAIR, TREASURER, OWNER],
      "decision.requested",
    );
    // Chair appears once per device; treasurer (no devices) not at all.
    expect(resolved.push.map((p) => p.token).sort()).toEqual(
      [CHAIR_TOKEN_1, CHAIR_TOKEN_2, OWNER_TOKEN].sort(),
    );
    expect(resolved.push.filter((p) => p.userId === CHAIR)).toHaveLength(2);
    expect(resolved.push.some((p) => p.userId === TREASURER)).toBe(false);
  });

  it("excludes a user who turned the push pref off, despite their tokens", async () => {
    await notificationPreferencesService.upsertPreference(ctxAs(), CHAIR, {
      notificationType: "decision.requested",
      channel: "push",
      enabled: false,
    });
    const resolved = await notificationPreferencesService.resolveRecipientChannels(
      ctxAs(),
      [CHAIR, OWNER],
      "decision.requested",
    );
    expect(resolved.push.map((p) => p.token)).toEqual([OWNER_TOKEN]);
    // The opt-out is per channel: the chair still gets the bell row.
    expect(resolved.inApp.sort()).toEqual([CHAIR, OWNER].sort());
  });
});

describe("notifier sends push", () => {
  it("delivers the in-app title/body + deep-link data to every device", async () => {
    const levyNoticeId = randomUUID();
    await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("levy.notice.issued", {
        levyNoticeId,
        lotId,
        noticeNumber: "LN-PUSH-1",
        totalCents: 100_000,
        dueOn: "2026-08-01",
      }),
    );
    // Only the owner is the levy recipient — one device, one push.
    expect(memoryPush.sent).toHaveLength(1);
    const push = memoryPush.sent[0]!;
    expect(push.to).toBe(OWNER_TOKEN);
    expect(push.title).toBe("Levy notice LN-PUSH-1 issued");
    expect(push.body).toContain("due 2026-08-01");
    expect(push.data).toEqual({
      schemeId,
      category: "finance",
      related: { type: "levy_notice", id: levyNoticeId },
    });
  });

  it("fans out to every registered device of every recipient", async () => {
    await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("decision.requested", {
        decisionId: randomUUID(),
        title: "Paint the lobby",
        kind: "committee",
      }),
    );
    // Committee = chair (2 devices) + treasurer (0 devices).
    expect(memoryPush.sent.map((m) => m.to).sort()).toEqual([CHAIR_TOKEN_1, CHAIR_TOKEN_2].sort());
  });

  it("prunes tokens that come back DeviceNotRegistered", async () => {
    memoryPush.deadTokens.add(CHAIR_TOKEN_2);
    await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("decision.requested", {
        decisionId: randomUUID(),
        title: "Replace the gate",
        kind: "committee",
      }),
    );
    const remaining = await tdb.db.query.pushTokens.findMany({
      where: eq(pushTokens.userId, CHAIR),
    });
    // The dead device is gone; the live one survives.
    expect(remaining.map((r) => r.token)).toEqual([CHAIR_TOKEN_1]);
  });
});
