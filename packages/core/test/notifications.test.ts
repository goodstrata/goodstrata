import { randomUUID } from "node:crypto";
import {
  lots,
  memberships,
  organizations,
  ownerships,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as complianceService from "../src/services/compliance.js";
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

describe("the notifier — org-scoped compliance obligations", () => {
  const MGR_BOTH = "user-mgr-both-n"; // manager_admin in schemes A and B
  const MGR_ONE = "user-mgr-one-n"; // manager_admin in scheme A only
  const ORG_OWNER = "user-org-owner-n"; // plain owner in scheme A — never notified
  let organizationId: string;
  let schemeA: string;
  let schemeB: string;

  beforeAll(async () => {
    const orgRows = await tdb.db
      .insert(organizations)
      .values({ name: "Good Strata Management" })
      .returning();
    organizationId = orgRows[0]!.id;

    const schemeRows = await tdb.db
      .insert(schemes)
      .values([
        {
          organizationId,
          name: "Org OC A",
          planOfSubdivision: "PS888801N",
          addressLine1: "1 Manager Way",
          suburb: "Carlton",
          postcode: "3053",
          tier: 3,
          status: "active",
        },
        {
          organizationId,
          name: "Org OC B",
          planOfSubdivision: "PS888802N",
          addressLine1: "2 Manager Way",
          suburb: "Carlton",
          postcode: "3053",
          tier: 3,
          status: "active",
        },
      ])
      .returning();
    schemeA = schemeRows[0]!.id;
    schemeB = schemeRows[1]!.id;

    await tdb.db.insert(users).values([
      { id: MGR_BOTH, name: "Manny Manager", email: "mgr-both-n@example.com" },
      { id: MGR_ONE, name: "Mona Manager", email: "mgr-one-n@example.com" },
      { id: ORG_OWNER, name: "Orla Owner", email: "org-owner-n@example.com" },
    ]);
    await tdb.db.insert(memberships).values([
      { schemeId: schemeA, userId: MGR_BOTH, role: "manager_admin", startedOn: "2025-01-01" },
      { schemeId: schemeB, userId: MGR_BOTH, role: "manager_admin", startedOn: "2025-01-01" },
      { schemeId: schemeA, userId: MGR_ONE, role: "manager_admin", startedOn: "2025-01-01" },
      { schemeId: schemeA, userId: ORG_OWNER, role: "owner", startedOn: "2025-01-01" },
    ]);
  });

  it("pi_expiry sweep event notifies org admins in-app (per scheme) and by email (once)", async () => {
    memoryEmail.sent.length = 0;

    // Raise the org-level obligation well ahead (band: none at 2026-07-02)…
    const obligation = await complianceService.raiseObligation(ctxAs(), {
      organizationId,
      kind: "pi_expiry",
      dueOn: "2026-11-15",
      subjectRef: "pi_policy:test",
    });
    expect(obligation.schemeId).toBeNull();

    // …then sweep from inside the 30-day window so the band change publishes
    // compliance.obligation.due with schemeId null + the organizationId.
    const laterCtx: ServiceContext = {
      db: tdb.db,
      clock: fixedClock("2026-10-20T00:00:00Z"),
      integrations,
      actor: systemActor("cron.compliance.daily"),
    };
    const { notified } = await complianceService.sweep(laterCtx, { organizationId });
    expect(notified).toBe(1);

    const event = await tdb.db.query.eventLog.findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.type, "compliance.obligation.due"),
          eq(t.stream, `compliance_obligation:${obligation.id}`),
        ),
    });
    expect(event!.schemeId).toBeNull();

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      event as unknown as EventRecord,
    );
    // Scheme A: both managers; scheme B: the cross-scheme manager. Never the owner.
    expect(created).toBe(3);

    for (const [scheme, userId] of [
      [schemeA, MGR_BOTH],
      [schemeA, MGR_ONE],
      [schemeB, MGR_BOTH],
    ] as const) {
      const rows = await notificationsService.listNotifications(ctxAs(), scheme, userId, {
        unreadOnly: true,
      });
      const match = rows.find((n) => n.related?.id === obligation.id);
      expect(match).toMatchObject({
        category: "general",
        title: "Manager PI insurance expiry — due 2026-11-15",
        related: { type: "compliance_obligation", id: obligation.id },
      });
    }
    const ownerRows = await notificationsService.listNotifications(ctxAs(), schemeA, ORG_OWNER, {
      unreadOnly: true,
    });
    expect(ownerRows.some((n) => n.related?.id === obligation.id)).toBe(false);

    // Email: one per distinct admin, linking to the manager back-office.
    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      "mgr-both-n@example.com",
      "mgr-one-n@example.com",
    ]);
    expect(memoryEmail.sent[0]!.subject).toBe("Manager PI insurance expiry — due 2026-11-15");
    expect(memoryEmail.sent[0]!.text).toContain("/manager");
  });

  it("overdue registration_renewal reads as overdue; an org with no admins is a no-op", async () => {
    memoryEmail.sent.length = 0;

    const obligation = await complianceService.raiseObligation(ctxAs(), {
      organizationId,
      kind: "registration_renewal",
      title: "Manager registration review",
      dueOn: "2026-06-01", // already past NOW (2026-07-02) → overdue at raise
      subjectRef: "registration",
    });

    const orgEvent = (payload: { organizationId: string }): EventRecord => ({
      ...fakeEvent("compliance.obligation.due", {
        obligationId: obligation.id,
        kind: "registration_renewal",
        dueOn: "2026-06-01",
        status: "overdue",
        escalationState: "overdue",
        responsibleRole: "manager_admin",
        schemeId: null,
        ...payload,
      }),
      schemeId: null,
    });

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      orgEvent({ organizationId }),
    );
    expect(created).toBe(3);

    const rows = await notificationsService.listNotifications(ctxAs(), schemeB, MGR_BOTH, {
      unreadOnly: true,
    });
    const match = rows.find((n) => n.related?.id === obligation.id)!;
    expect(match.title).toBe("Overdue: Manager registration review");
    expect(match.body).toContain("was due 2026-06-01");
    expect(memoryEmail.sent).toHaveLength(2);

    // An org nobody administers (or a payload without an org) creates nothing.
    const emptyOrg = await tdb.db.insert(organizations).values({ name: "Empty Org" }).returning();
    const none = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      orgEvent({ organizationId: emptyOrg[0]!.id }),
    );
    expect(none.created).toBe(0);
  });
});
