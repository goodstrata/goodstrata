import { randomUUID } from "node:crypto";
import { lots, memberships, ownerships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as decisionsService from "../src/services/decisions.js";
import * as notificationsService from "../src/services/notifications.js";
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

const CHAIR = "user-chair-n";
const TREASURER = "user-treasurer-n";
const OWNER = "user-owner-n";

/** Build an EventRecord as the dispatcher worker would hand it to the notifier. */
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
      name: "Notify Test OC",
      planOfSubdivision: "PS999999N",
      addressLine1: "9 Signal St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;

  await tdb.db.insert(users).values([
    { id: CHAIR, name: "Casey Chair", email: "chair-n@example.com" },
    { id: TREASURER, name: "Terry Treasurer", email: "treasurer-n@example.com" },
    { id: OWNER, name: "Olly Owner", email: "owner-n@example.com" },
  ]);
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: TREASURER, role: "treasurer", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2025-01-01" },
  ]);

  // People: the chair has a phone (gets SMS); the owner is the levy recipient
  // of lot 1 and links to a login (gets levy notifications).
  await tdb.db.insert(people).values({
    schemeId,
    userId: CHAIR,
    givenName: "Casey",
    familyName: "Chair",
    email: "chair-n@example.com",
    phone: "+61411111111",
  });
  const ownerPerson = await tdb.db
    .insert(people)
    .values({
      schemeId,
      userId: OWNER,
      givenName: "Olly",
      familyName: "Owner",
      email: "owner-n@example.com",
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

describe("notifications service", () => {
  it("creates a notification and publishes notification.created", async () => {
    const notification = await notificationsService.createNotification(ctxAs(), {
      schemeId,
      userId: OWNER,
      title: "Welcome",
      body: "Your portal is ready.",
      category: "general",
    });
    expect(notification.readAt).toBeNull();

    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "notification.created"),
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)!.payload).toMatchObject({
      notificationId: notification.id,
      userId: OWNER,
      title: "Welcome",
      category: "general",
    });
  });

  it("lists own notifications, filters unread, and marks read", async () => {
    const ctx = ctxAs(userActor(OWNER));
    const all = await notificationsService.listNotifications(ctx, schemeId, OWNER);
    expect(all.length).toBeGreaterThanOrEqual(1);

    const target = all[0]!;
    await notificationsService.markRead(ctx, schemeId, OWNER, target.id);
    const unread = await notificationsService.listNotifications(ctx, schemeId, OWNER, {
      unreadOnly: true,
    });
    expect(unread.some((n) => n.id === target.id)).toBe(false);

    // Someone else's notification cannot be marked read.
    await expect(
      notificationsService.markRead(ctxAs(userActor(CHAIR)), schemeId, CHAIR, target.id),
    ).rejects.toThrow(/not found/i);

    // mark-all clears the rest.
    await notificationsService.notifyUsers(ctxAs(), schemeId, [OWNER, OWNER], {
      title: "Two more",
      body: "…",
      category: "general",
    });
    const { updated } = await notificationsService.markRead(ctx, schemeId, OWNER, "all");
    expect(updated).toBeGreaterThanOrEqual(1);
    const after = await notificationsService.listNotifications(ctx, schemeId, OWNER, {
      unreadOnly: true,
    });
    expect(after).toHaveLength(0);
  });
});

describe("the notifier", () => {
  it("decision.requested notifies the committee in-app, by email, and by SMS", async () => {
    memoryEmail.sent.length = 0;
    memorySms.sent.length = 0;

    const decision = await decisionsService.requestDecision(ctxAs(userActor(CHAIR)), {
      schemeId,
      kind: "other",
      title: "Approve the gate repair quote",
      summaryMd: "…",
      deciderRole: "committee",
    });
    const event = await tdb.db.query.eventLog.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.type, "decision.requested"), eq(t.stream, `decision:${decision.id}`)),
    });

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      event as unknown as EventRecord,
    );
    expect(created).toBe(2); // chair + treasurer, not the owner

    for (const userId of [CHAIR, TREASURER]) {
      const rows = await notificationsService.listNotifications(ctxAs(), schemeId, userId, {
        unreadOnly: true,
      });
      const match = rows.find((n) => n.related?.id === decision.id);
      expect(match).toMatchObject({
        category: "decision",
        title: "Decision requested: Approve the gate repair quote",
        related: { type: "decision", id: decision.id },
      });
    }

    // Both committee users get email; only the chair (has a phone) gets SMS.
    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      "chair-n@example.com",
      "treasurer-n@example.com",
    ]);
    expect(memorySms.sent).toHaveLength(1);
    expect(memorySms.sent[0]!.to).toBe("+61411111111");
    expect(memorySms.sent[0]!.body).toContain("Approve the gate repair quote");
  });

  it("levy.notice.issued notifies the lot's levy recipient when they have a login", async () => {
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("levy.notice.issued", {
        levyNoticeId: randomUUID(),
        lotId,
        noticeNumber: "LN-2026-01-1",
        totalCents: 125_000,
        dueOn: "2026-08-01",
        payid: null,
      }),
    );
    expect(created).toBe(1);

    const rows = await notificationsService.listNotifications(ctxAs(), schemeId, OWNER, {
      unreadOnly: true,
    });
    const notice = rows.find((n) => n.title.includes("LN-2026-01-1"))!;
    expect(notice.category).toBe("finance");
    expect(notice.body).toContain("$1,250.00");
    expect(notice.body).toContain("lot 1");
  });

  it("arrears.stage.reached notifies the committee only from stage 3", async () => {
    const payload = (stage: number) => ({
      lotId,
      stage,
      kind: "levy",
      daysOverdue: 40,
      outstandingCents: 99_00,
      interestAccruedCents: 0,
      earliestDueOn: "2026-05-01",
    });

    const early = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("arrears.stage.reached", payload(2)),
    );
    expect(early.created).toBe(0);

    const late = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("arrears.stage.reached", payload(3)),
    );
    expect(late.created).toBe(2); // committee only
  });

  it("minutes.drafted notifies every member; maintenance + work orders go to committee", async () => {
    const minutes = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("minutes.drafted", { meetingId: randomUUID(), documentId: randomUUID() }),
    );
    expect(minutes.created).toBe(3); // chair, treasurer, owner

    const maintenance = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("maintenance.request.created", {
        requestId: randomUUID(),
        title: "Leaking roof",
        description: "…",
        lotId: null,
      }),
    );
    expect(maintenance.created).toBe(2);

    const workOrder = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("work_order.dispatched", {
        workOrderId: randomUUID(),
        contractorId: randomUUID(),
      }),
    );
    expect(workOrder.created).toBe(2);
  });

  it("ignores events without a scheme and unknown types", async () => {
    const noScheme = await notifierService.handleEventForNotifications(ctxAs(), {
      ...fakeEvent("minutes.drafted", { meetingId: "m", documentId: "d" }),
      schemeId: null,
    });
    expect(noScheme.created).toBe(0);

    const unknown = await notifierService.handleEventForNotifications(
      ctxAs(),
      fakeEvent("payment.received", { paymentId: "p", amountCents: 1, payid: null }),
    );
    expect(unknown.created).toBe(0);
  });
});
