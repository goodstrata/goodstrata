import { randomUUID } from "node:crypto";
import { lots, memberships, notificationPreferences, ownerships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as notificationPreferencesService from "../src/services/notificationPreferences.js";
import * as notifierService from "../src/services/notifier.js";

let tdb: TestDatabase;
let schemeId: string;
let lotId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  }),
  payments: mockPaymentsProvider(),
};
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};
const memorySms = integrations.sms as typeof integrations.sms & {
  sent: { to: string; body: string }[];
};

const NOW = "2026-07-02T00:00:00Z";
function ctxAs(actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

const CHAIR = "user-chair-pref"; // committee, phone via people
const TREASURER = "user-treasurer-pref"; // committee, no phone anywhere
const OWNER = "user-owner-pref"; // levy recipient of lot 1, phone via users.phone

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
      name: "Prefs Test OC",
      planOfSubdivision: "PS777777P",
      addressLine1: "7 Pref St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;

  await tdb.db.insert(users).values([
    { id: CHAIR, name: "Casey Chair", email: "chair-pref@example.com" },
    { id: TREASURER, name: "Terry Treasurer", email: "treasurer-pref@example.com" },
    // OWNER carries a user-level phone (E.164) — exercises users.phone resolution.
    { id: OWNER, name: "Olly Owner", email: "owner-pref@example.com", phone: "+61422222222" },
  ]);
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: TREASURER, role: "treasurer", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2025-01-01" },
  ]);

  // The chair's phone lives on the scheme roll (people.phone) — exercises the
  // cross-scheme fallback. Treasurer has no phone at all.
  await tdb.db.insert(people).values({
    schemeId,
    userId: CHAIR,
    givenName: "Casey",
    familyName: "Chair",
    email: "chair-pref@example.com",
    phone: "+61411111111",
  });
  const ownerPerson = await tdb.db
    .insert(people)
    .values({
      schemeId,
      userId: OWNER,
      givenName: "Olly",
      familyName: "Owner",
      email: "owner-pref@example.com",
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
  memoryEmail.sent.length = 0;
  memorySms.sent.length = 0;
  // Reset to a clean, default (sparse) preference state before each test.
  await tdb.db.delete(notificationPreferences);
});

describe("resolveRecipientChannels — defaults", () => {
  it("with no pref rows, applies NOTIFICATION_DEFAULTS per type", async () => {
    // decision.requested defaults ON for all three channels.
    const decision = await notificationPreferencesService.resolveRecipientChannels(
      ctxAs(),
      [CHAIR, TREASURER, OWNER],
      "decision.requested",
    );
    expect(decision.inApp.sort()).toEqual([CHAIR, OWNER, TREASURER].sort());
    expect(decision.email.map((e) => e.userId).sort()).toEqual([CHAIR, OWNER, TREASURER].sort());
    // SMS: all three want it by default, but only those with a phone resolve —
    // chair (people.phone) and owner (users.phone); treasurer has none.
    expect(decision.sms.map((s) => s.userId).sort()).toEqual([CHAIR, OWNER].sort());
    expect(decision.sms.find((s) => s.userId === CHAIR)!.phone).toBe("+61411111111");
    expect(decision.sms.find((s) => s.userId === OWNER)!.phone).toBe("+61422222222");
  });

  it("work_order.dispatched defaults email + sms OFF (in_app only)", async () => {
    const resolved = await notificationPreferencesService.resolveRecipientChannels(
      ctxAs(),
      [CHAIR, TREASURER],
      "work_order.dispatched",
    );
    expect(resolved.inApp.sort()).toEqual([CHAIR, TREASURER].sort());
    expect(resolved.email).toHaveLength(0);
    expect(resolved.sms).toHaveLength(0);
  });

  it("levy.notice.issued defaults sms OFF even for a user with a phone", async () => {
    const resolved = await notificationPreferencesService.resolveRecipientChannels(
      ctxAs(),
      [OWNER],
      "levy.notice.issued",
    );
    expect(resolved.inApp).toEqual([OWNER]);
    expect(resolved.email.map((e) => e.userId)).toEqual([OWNER]);
    expect(resolved.sms).toHaveLength(0); // owner has a phone, but default is OFF
  });
});

describe("resolveRecipientChannels — overrides", () => {
  it("a stored override wins over the default (opt OUT of a default-on channel)", async () => {
    await notificationPreferencesService.upsertPreference(ctxAs(), CHAIR, {
      notificationType: "decision.requested",
      channel: "in_app",
      enabled: false,
    });
    const resolved = await notificationPreferencesService.resolveRecipientChannels(
      ctxAs(),
      [CHAIR, TREASURER],
      "decision.requested",
    );
    // Chair opted out of the bell; treasurer keeps the default.
    expect(resolved.inApp).toEqual([TREASURER]);
  });

  it("upsert is idempotent on (userId, type, channel)", async () => {
    await notificationPreferencesService.upsertPreference(ctxAs(), OWNER, {
      notificationType: "levy.notice.issued",
      channel: "sms",
      enabled: true,
    });
    await notificationPreferencesService.upsertPreference(ctxAs(), OWNER, {
      notificationType: "levy.notice.issued",
      channel: "sms",
      enabled: false,
    });
    const rows = await tdb.db.query.notificationPreferences.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.enabled).toBe(false);
  });
});

describe("listEffectivePreferences", () => {
  it("returns the full matrix merged over defaults", async () => {
    await notificationPreferencesService.upsertPreference(ctxAs(), OWNER, {
      notificationType: "levy.notice.issued",
      channel: "sms",
      enabled: true,
    });
    const matrix = await notificationPreferencesService.listEffectivePreferences(ctxAs(), OWNER);
    // Overridden cell reflects the stored value…
    expect(matrix["levy.notice.issued"].sms).toBe(true);
    // …untouched cells fall back to defaults.
    expect(matrix["levy.notice.issued"].in_app).toBe(true);
    expect(matrix["work_order.dispatched"].email).toBe(false);
    expect(matrix["decision.requested"].sms).toBe(true);
  });
});

describe("resolveUserPhone", () => {
  it("prefers users.phone, falls back to people.phone, and reports none", async () => {
    expect((await notificationPreferencesService.resolveUserPhone(ctxAs(), OWNER)).phone).toBe(
      "+61422222222",
    );
    expect((await notificationPreferencesService.resolveUserPhone(ctxAs(), CHAIR)).phone).toBe(
      "+61411111111",
    );
    const none = await notificationPreferencesService.resolveUserPhone(ctxAs(), TREASURER);
    expect(none.hasPhone).toBe(false);
    expect(none.phone).toBeNull();
  });
});

describe("notifier honours preferences per channel", () => {
  it("(a) defaults preserve today's behaviour for levy.notice.issued (in-app + email, no SMS)", async () => {
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("levy.notice.issued", {
        levyNoticeId: randomUUID(),
        lotId,
        noticeNumber: "LN-PREF-1",
        totalCents: 100_000,
        dueOn: "2026-08-01",
      }),
    );
    expect(created).toBe(1); // owner gets the bell row
    expect(memoryEmail.sent.map((e) => e.to)).toEqual(["owner-pref@example.com"]);
    expect(memorySms.sent).toHaveLength(0); // levy SMS default OFF — unchanged from today
  });

  it("(b) an SMS-enabled pref sends SMS for a type that never SMSed before", async () => {
    await notificationPreferencesService.upsertPreference(ctxAs(), OWNER, {
      notificationType: "levy.notice.issued",
      channel: "sms",
      enabled: true,
    });
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("levy.notice.issued", {
        levyNoticeId: randomUUID(),
        lotId,
        noticeNumber: "LN-PREF-2",
        totalCents: 100_000,
        dueOn: "2026-08-01",
      }),
    );
    expect(created).toBe(1);
    expect(memorySms.sent).toHaveLength(1);
    expect(memorySms.sent[0]!.to).toBe("+61422222222"); // owner's users.phone
    expect(memorySms.sent[0]!.body).toContain("LN-PREF-2");
  });

  it("(c) SMS enabled but no phone on file => no SMS and no crash", async () => {
    // Treasurer has no phone anywhere; turn maintenance SMS on for them.
    await notificationPreferencesService.upsertPreference(ctxAs(), TREASURER, {
      notificationType: "maintenance.request.created",
      channel: "sms",
      enabled: true,
    });
    // Chair opts OUT of maintenance email to keep the assertion tight.
    await notificationPreferencesService.upsertPreference(ctxAs(), CHAIR, {
      notificationType: "maintenance.request.created",
      channel: "sms",
      enabled: true,
    });

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("maintenance.request.created", {
        requestId: randomUUID(),
        title: "Broken gate",
        description: "…",
        lotId: null,
      }),
    );
    expect(created).toBe(2); // chair + treasurer bell rows

    // Only the chair (has a people.phone) receives the SMS; treasurer is skipped
    // silently — no throw, no send.
    expect(memorySms.sent.map((s) => s.to)).toEqual(["+61411111111"]);
  });

  it("opting out of in_app suppresses the bell row (created count drops)", async () => {
    await notificationPreferencesService.upsertPreference(ctxAs(), CHAIR, {
      notificationType: "maintenance.request.created",
      channel: "in_app",
      enabled: false,
    });
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("maintenance.request.created", {
        requestId: randomUUID(),
        title: "Leaky tap",
        description: "…",
        lotId: null,
      }),
    );
    expect(created).toBe(1); // only treasurer's bell row now
  });
});
