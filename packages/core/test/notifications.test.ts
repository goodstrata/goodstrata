import { randomUUID } from "node:crypto";
import {
  budgets,
  complaints,
  contractors,
  decisionVotes,
  levyNotices,
  levySchedules,
  lots,
  maintenanceRequests,
  meetings,
  memberships,
  notificationDeliveryClaims,
  organizations,
  ownerships,
  paymentAllocations,
  payments,
  people,
  pushTokens,
  schemes,
  users,
  workOrders,
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
let ownerPersonId: string;

const integrations = {
  ...integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    PUSH_PROVIDER: "memory",
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
const memoryPush = integrations.push as typeof integrations.push & {
  sent: { to: string; title: string; body: string; data?: Record<string, unknown> }[];
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
  ownerPersonId = ownerPerson[0]!.id;
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
    const notification = (await notificationsService.createNotification(ctxAs(), {
      schemeId,
      userId: OWNER,
      title: "Welcome",
      body: "Your portal is ready.",
      category: "general",
    }))!;
    expect(notification).not.toBeNull();
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

  it("notifies officers when a quote arrives and a contractor accepts the job", async () => {
    const quote = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("quote.received", {
        quoteId: randomUUID(),
        rfqId: randomUUID(),
        contractorId: randomUUID(),
        amountCents: 125_000,
      }),
    );
    const accepted = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("work_order.accepted", {
        workOrderId: randomUUID(),
        contractorId: randomUUID(),
      }),
    );

    expect(quote.created).toBe(2);
    expect(accepted.created).toBe(2);
    const ownerRows = await notificationsService.listNotifications(ctxAs(), schemeId, OWNER);
    expect(ownerRows.some((row) => row.title.includes("contractor quote"))).toBe(false);
  });

  it("notifies the complainant when their complaint advances", async () => {
    const rows = await tdb.db
      .insert(complaints)
      .values({
        schemeId,
        complainantPersonId: ownerPersonId,
        subject: "Test complaint update",
        details: "Enough detail for notifier coverage.",
        meetByDate: "2026-07-30",
      })
      .returning();
    const complaintId = rows[0]!.id;

    const result = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("complaint.advanced", {
        complaintId,
        fromStatus: "received",
        toStatus: "under_discussion",
      }),
    );

    expect(result.created).toBe(1);
    const ownerRows = await notificationsService.listNotifications(ctxAs(), schemeId, OWNER);
    expect(ownerRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Your complaint was updated",
          body: expect.stringContaining("under discussion"),
        }),
      ]),
    );
  });

  it("ignores events without a scheme and unknown types", async () => {
    const noScheme = await notifierService.handleEventForNotifications(ctxAs(), {
      ...fakeEvent("minutes.drafted", { meetingId: "m", documentId: "d" }),
      schemeId: null,
    });
    expect(noScheme.created).toBe(0);

    const unknown = await notifierService.handleEventForNotifications(ctxAs(), fakeEvent("x", {}));
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
    await tdb.db.insert(pushTokens).values({
      userId: MGR_BOTH,
      token: "ExponentPushToken[org-manager]",
      platform: "ios",
    });
  });

  it("pi_expiry sweep event notifies org admins in-app (per scheme) and by email (once)", async () => {
    memoryEmail.sent.length = 0;
    memoryPush.sent.length = 0;

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
    const orgPush = memoryPush.sent[0]!;
    expect(orgPush.to).toBe("ExponentPushToken[org-manager]");
    const pushData = orgPush.data as {
      schemeId: string;
      notificationId: string;
      related: { type: string; id: string };
    };
    expect(pushData.related).toEqual({ type: "compliance_obligation", id: obligation.id });
    const anchorRows = await notificationsService.listNotifications(
      ctxAs(),
      pushData.schemeId,
      MGR_BOTH,
    );
    expect(pushData.notificationId).toBe(
      anchorRows.find((notification) => notification.related?.id === obligation.id)!.id,
    );

    // Org-scoped delivery has multiple bell rows for one admin, but outbound
    // claims remain one per event/user/channel and survive job redelivery.
    const repeated = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      event as unknown as EventRecord,
    );
    expect(repeated.created).toBe(0);
    expect(memoryEmail.sent).toHaveLength(2);
    expect(memoryPush.sent).toHaveLength(1);
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

describe("the notifier — delivery hardening", () => {
  it("is idempotent per (event, recipient): a redelivered job re-sends nothing", async () => {
    memoryEmail.sent.length = 0;
    memorySms.sent.length = 0;

    const event = fakeEvent("decision.requested", {
      decisionId: randomUUID(),
      title: "Repaint the lobby",
      kind: "other",
      deciderRole: "committee",
    });

    const first = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      event,
    );
    expect(first.created).toBe(2); // chair + treasurer bells
    expect(memoryEmail.sent).toHaveLength(2);
    expect(memorySms.sent).toHaveLength(1);

    // pg-boss redelivers the same job (same event id) — nothing new happens.
    const second = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      event,
    );
    expect(second.created).toBe(0);
    expect(memoryEmail.sent).toHaveLength(2);
    expect(memorySms.sent).toHaveLength(1);

    // Exactly one bell row per recipient for this event.
    const rows = await tdb.db.query.notifications.findMany();
    const forEvent = rows.filter((n) => n.dedupeKey?.startsWith(event.id));
    expect(forEvent).toHaveLength(2);
  });

  it("records every notifier email/SMS in the messages correspondence log", async () => {
    const decisionId = randomUUID();
    await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("decision.requested", {
        decisionId,
        title: "Audit trail check",
        kind: "other",
        deciderRole: "committee",
      }),
    );

    const rows = await tdb.db.query.messages.findMany();
    const mine = rows.filter((m) => (m.related as { id?: string } | null)?.id === decisionId);
    const emails = mine.filter((m) => m.channel === "email");
    const sms = mine.filter((m) => m.channel === "sms");
    expect(emails.map((m) => m.toAddress).sort()).toEqual([
      "chair-n@example.com",
      "treasurer-n@example.com",
    ]);
    expect(sms.map((m) => m.toAddress)).toEqual(["+61411111111"]);
    for (const m of mine) {
      expect(m.status).toBe("sent");
      expect(m.providerMessageId).toBeTruthy();
      expect(m.template).toBe("notifier:decision.requested");
      expect(m.direction).toBe("outbound");
    }
  });

  it("isolates a failed recipient: the rest of the fan-out still delivers", async () => {
    // An email provider that rejects the treasurer but accepts everyone else.
    const flakySent: { to: string }[] = [];
    let failTreasurer = true;
    const flakyCtx: ServiceContext = {
      db: tdb.db,
      clock: fixedClock(NOW),
      actor: systemActor("notifier"),
      integrations: {
        ...integrations,
        email: {
          name: "flaky",
          async send(email: { to: string }) {
            if (failTreasurer && email.to === "treasurer-n@example.com") {
              throw new Error("mailbox on fire");
            }
            flakySent.push({ to: email.to });
            return { providerMessageId: `flaky-${flakySent.length}` };
          },
        },
      },
    };

    const decisionId = randomUUID();
    const event = fakeEvent("decision.requested", {
      decisionId,
      title: "Isolation test",
      kind: "other",
      deciderRole: "committee",
    });
    await expect(notifierService.handleEventForNotifications(flakyCtx, event)).rejects.toThrow(
      /notifier delivery incomplete/,
    );

    // Bells and every unaffected channel delivered before the aggregate asks
    // pg-boss to retry the failed recipient.
    expect(flakySent.map((s) => s.to)).toEqual(["chair-n@example.com"]);

    const firstClaims = await tdb.db.query.notificationDeliveryClaims.findMany({
      where: (t, { eq }) => eq(t.eventId, event.id),
    });
    expect(
      firstClaims.find((claim) => claim.userId === CHAIR && claim.channel === "email")!.completedAt,
    ).not.toBeNull();
    const failedClaim = firstClaims.find(
      (claim) => claim.userId === TREASURER && claim.channel === "email",
    )!;
    expect(failedClaim.completedAt).toBeNull();
    expect(failedClaim.lastError).toContain("mailbox on fire");

    failTreasurer = false;
    const retry = await notifierService.handleEventForNotifications(flakyCtx, event);
    expect(retry.created).toBe(0);
    // Only the released failed lease re-sends; chair/SMS/push successes remain terminal.
    expect(flakySent.map((send) => send.to)).toEqual([
      "chair-n@example.com",
      "treasurer-n@example.com",
    ]);
    const retriedClaim = await tdb.db.query.notificationDeliveryClaims.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.eventId, event.id), eq(t.userId, TREASURER), eq(t.channel, "email")),
    });
    expect(retriedClaim).toMatchObject({ attempts: 2, lastError: null });
    expect(retriedClaim!.completedAt).not.toBeNull();

    // The correspondence log retains both the failed attempt and successful retry.
    const rows = await tdb.db.query.messages.findMany();
    const mine = rows.filter(
      (m) => (m.related as { id?: string } | null)?.id === decisionId && m.channel === "email",
    );
    expect(
      mine
        .filter((m) => m.toAddress === "treasurer-n@example.com")
        .map((m) => m.status)
        .sort(),
    ).toEqual(["failed", "sent"]);
    expect(mine.find((m) => m.toAddress === "chair-n@example.com")!.status).toBe("sent");
  });

  it("keeps a live crash lease concurrent-safe, then retries it after expiry", async () => {
    memoryEmail.sent.length = 0;
    memorySms.sent.length = 0;
    const event = fakeEvent("decision.requested", {
      decisionId: randomUUID(),
      title: "Crash lease exercise",
      kind: "other",
      deciderRole: "committee",
    });
    await tdb.db.insert(notificationDeliveryClaims).values({
      eventId: event.id,
      userId: CHAIR,
      channel: "email",
      leaseId: randomUUID(),
      leaseUntil: new Date("2026-07-02T00:02:00Z"),
      attempts: 1,
    });

    await expect(
      notifierService.handleEventForNotifications(ctxAs(systemActor("notifier")), event),
    ).rejects.toThrow(/email delivery lease still active/);
    expect(memoryEmail.sent.map((send) => send.to)).toEqual(["treasurer-n@example.com"]);
    expect(memorySms.sent).toHaveLength(1);

    const afterExpiry: ServiceContext = {
      ...ctxAs(systemActor("notifier")),
      clock: fixedClock("2026-07-02T00:03:00Z"),
    };
    const retry = await notifierService.handleEventForNotifications(afterExpiry, event);
    expect(retry.created).toBe(0);
    expect(memoryEmail.sent.map((send) => send.to).sort()).toEqual(
      ["chair-n@example.com", "treasurer-n@example.com"].sort(),
    );
    expect(memorySms.sent).toHaveLength(1);
  });
});

describe("the notifier — new event handlers", () => {
  it("meeting.scheduled notifies every member in-app (email is opt-in)", async () => {
    memoryEmail.sent.length = 0;
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("meeting.scheduled", {
        meetingId: randomUUID(),
        kind: "agm",
        title: "2026 AGM",
        scheduledAt: "2026-08-20T09:00:00.000Z",
      }),
    );
    expect(created).toBe(3); // chair, treasurer, owner
    expect(memoryEmail.sent).toHaveLength(0); // default email OFF for this type

    const rows = await notificationsService.listNotifications(ctxAs(), schemeId, OWNER, {
      unreadOnly: true,
    });
    const match = rows.find((n) => n.title === "Meeting scheduled: 2026 AGM")!;
    expect(match.category).toBe("meeting");
    expect(match.body).toContain("2026-08-20");
  });

  it("meeting.notice.issued notifies every member with the meeting's title", async () => {
    memoryEmail.sent.length = 0;
    const meetingRows = await tdb.db
      .insert(meetings)
      .values({
        schemeId,
        kind: "agm",
        title: "2026 AGM",
        scheduledAt: new Date("2026-08-20T09:00:00Z"),
      })
      .returning();
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("meeting.notice.issued", { meetingId: meetingRows[0]!.id, recipients: 3 }),
    );
    expect(created).toBe(3);
    expect(memoryEmail.sent).toHaveLength(0); // statutory notice is its own email

    const rows = await notificationsService.listNotifications(ctxAs(), schemeId, CHAIR, {
      unreadOnly: true,
    });
    const match = rows.find((n) => n.related?.id === meetingRows[0]!.id)!;
    expect(match.title).toBe("Notice of meeting: 2026 AGM");
  });

  it("decision.resolved notifies the voters; decision.expired falls back to the committee", async () => {
    memoryEmail.sent.length = 0;
    const decision = await decisionsService.requestDecision(ctxAs(userActor(CHAIR)), {
      schemeId,
      kind: "other",
      title: "Replace the intercom",
      summaryMd: "…",
      deciderRole: "committee",
    });
    // Only the chair voted.
    await tdb.db.insert(decisionVotes).values({
      decisionId: decision.id,
      userId: CHAIR,
      choice: "approve",
    });

    const resolved = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("decision.resolved", {
        decisionId: decision.id,
        optionId: "approve",
        resolvedBy: CHAIR,
      }),
    );
    expect(resolved.created).toBe(1); // the voter, not the whole committee
    const chairRows = await notificationsService.listNotifications(ctxAs(), schemeId, CHAIR, {
      unreadOnly: true,
    });
    const match = chairRows.find((n) => n.title === "Decision resolved: Replace the intercom")!;
    expect(match.category).toBe("decision");
    expect(match.body).toContain("approve");
    expect(memoryEmail.sent.map((e) => e.to)).toEqual(["chair-n@example.com"]);

    // A decision nobody voted on expires → the committee hears about it.
    const lapsed = await decisionsService.requestDecision(ctxAs(userActor(CHAIR)), {
      schemeId,
      kind: "other",
      title: "Lapsed question",
      summaryMd: "…",
      deciderRole: "committee",
    });
    const expired = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("decision.expired", { decisionId: lapsed.id }),
    );
    expect(expired.created).toBe(2); // chair + treasurer
  });

  it("payment.received (unmatched) notifies the treasurer only", async () => {
    memoryEmail.sent.length = 0;
    const paymentRows = await tdb.db
      .insert(payments)
      .values({
        schemeId,
        provider: "manual",
        providerRef: `test-unmatched-${randomUUID()}`,
        amountCents: 50_000,
        paidAt: new Date(NOW),
        status: "unmatched",
      })
      .returning();

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("payment.received", {
        paymentId: paymentRows[0]!.id,
        amountCents: 50_000,
        payid: null,
        rail: "manual",
      }),
    );
    expect(created).toBe(1); // treasurer only — no matched lot yet

    const rows = await notificationsService.listNotifications(ctxAs(), schemeId, TREASURER, {
      unreadOnly: true,
    });
    const match = rows.find((n) => n.related?.id === paymentRows[0]!.id)!;
    expect(match.category).toBe("finance");
    expect(match.body).toContain("not yet matched");
  });

  it("payment.received (matched) sends the lot owner a receipt confirmation + tells the treasurer", async () => {
    memoryEmail.sent.length = 0;
    const budgetRows = await tdb.db
      .insert(budgets)
      .values({ schemeId, fiscalYearStart: "2026-07-01" })
      .returning();
    const scheduleRows = await tdb.db
      .insert(levySchedules)
      .values({ schemeId, budgetId: budgetRows[0]!.id, firstDueOn: "2026-08-01" })
      .returning();
    const noticeRows = await tdb.db
      .insert(levyNotices)
      .values({
        schemeId,
        lotId,
        levyScheduleId: scheduleRows[0]!.id,
        instalment: 1,
        noticeNumber: "LN-PAY-1",
        dueOn: "2026-08-01",
        totalCents: 125_000,
        status: "paid",
      })
      .returning();
    const paymentRows = await tdb.db
      .insert(payments)
      .values({
        schemeId,
        provider: "manual",
        providerRef: `test-matched-${randomUUID()}`,
        amountCents: 125_000,
        paidAt: new Date(NOW),
        status: "matched",
      })
      .returning();
    await tdb.db.insert(paymentAllocations).values({
      paymentId: paymentRows[0]!.id,
      levyNoticeId: noticeRows[0]!.id,
      amountCents: 125_000,
    });

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("payment.received", {
        paymentId: paymentRows[0]!.id,
        amountCents: 125_000,
        payid: null,
      }),
    );
    expect(created).toBe(2); // the paying lot's owner + the treasurer

    const ownerRows = await notificationsService.listNotifications(ctxAs(), schemeId, OWNER, {
      unreadOnly: true,
    });
    const receipt = ownerRows.find((n) => n.related?.id === paymentRows[0]!.id)!;
    expect(receipt.body).toContain("$1,250.00");
    expect(receipt.body).toContain("LN-PAY-1");

    // Owner receipt confirmation email (default ON for payment.received).
    expect(memoryEmail.sent.map((e) => e.to).sort()).toEqual([
      "owner-n@example.com",
      "treasurer-n@example.com",
    ]);
  });

  it("work_order.completed notifies the original requester", async () => {
    memoryEmail.sent.length = 0;
    const contractorRows = await tdb.db
      .insert(contractors)
      .values({ schemeId, businessName: "Fix It Fast" })
      .returning();
    const requestRows = await tdb.db
      .insert(maintenanceRequests)
      .values({
        schemeId,
        title: "Broken letterbox",
        description: "…",
        reportedByPersonId: ownerPersonId,
      })
      .returning();
    const woRows = await tdb.db
      .insert(workOrders)
      .values({
        schemeId,
        requestId: requestRows[0]!.id,
        contractorId: contractorRows[0]!.id,
        scope: "Fix the letterbox",
        approvedAmountCents: 10_000,
        status: "completed",
      })
      .returning();

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("work_order.completed", { workOrderId: woRows[0]!.id }),
    );
    expect(created).toBe(1); // the reporter (owner), not the committee

    const rows = await notificationsService.listNotifications(ctxAs(), schemeId, OWNER, {
      unreadOnly: true,
    });
    const match = rows.find((n) => n.related?.id === requestRows[0]!.id)!;
    expect(match.title).toBe("Work completed: Broken letterbox");
    expect(match.category).toBe("maintenance");
    expect(match.related).toEqual({ type: "maintenance_request", id: requestRows[0]!.id });
    expect(memoryEmail.sent.map((e) => e.to)).toEqual(["owner-n@example.com"]);
  });

  it("complaint.filed notifies the officers with the statutory deadline", async () => {
    memoryEmail.sent.length = 0;
    const complaintId = randomUUID();
    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("complaint.filed", {
        complaintId,
        complainantPersonId: ownerPersonId,
        subject: "Noise from lot 3",
        meetByDate: "2026-07-30",
      }),
    );
    expect(created).toBe(2); // chair + treasurer (the officers), never the owner

    const rows = await notificationsService.listNotifications(ctxAs(), schemeId, CHAIR, {
      unreadOnly: true,
    });
    const match = rows.find((n) => n.related?.id === complaintId)!;
    expect(match.title).toBe("New complaint: Noise from lot 3");
    expect(match.body).toContain("2026-07-30");
    expect(memoryEmail.sent).toHaveLength(2);
  });
});

describe("the notifier — agent.run.failed → org admins", () => {
  const ADMIN = "user-agent-admin-n";
  let orgSchemeId: string;

  beforeAll(async () => {
    const orgRows = await tdb.db
      .insert(organizations)
      .values({ name: "Agent Failure Mgmt" })
      .returning();
    const schemeRows = await tdb.db
      .insert(schemes)
      .values({
        organizationId: orgRows[0]!.id,
        name: "Agent OC",
        planOfSubdivision: "PS888803N",
        addressLine1: "3 Agent Way",
        suburb: "Carlton",
        postcode: "3053",
        tier: 3,
        status: "active",
      })
      .returning();
    orgSchemeId = schemeRows[0]!.id;
    await tdb.db.insert(users).values({
      id: ADMIN,
      name: "Ada Admin",
      email: "agent-admin-n@example.com",
    });
    await tdb.db.insert(memberships).values({
      schemeId: orgSchemeId,
      userId: ADMIN,
      role: "manager_admin",
      startedOn: "2025-01-01",
    });
  });

  it("notifies the org admins with the error and a link to the run", async () => {
    memoryEmail.sent.length = 0;
    const runId = randomUUID();
    const event: EventRecord = {
      ...fakeEvent("agent.run.failed", {
        agentRunId: runId,
        agent: "finance",
        error: "model timeout after 30s",
      }),
      schemeId: orgSchemeId,
    };

    const { created } = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      event,
    );
    expect(created).toBe(1);

    const rows = await notificationsService.listNotifications(ctxAs(), orgSchemeId, ADMIN, {
      unreadOnly: true,
    });
    const match = rows.find((n) => n.related?.id === runId)!;
    expect(match.title).toBe("Agent run failed: finance");
    expect(match.body).toContain("model timeout after 30s");
    expect(match.category).toBe("general");
    expect(memoryEmail.sent.map((e) => e.to)).toEqual(["agent-admin-n@example.com"]);
    expect(memoryEmail.sent[0]!.text).toContain("Review agent runs");
  });

  it("is a no-op for a scheme with no org and no manager_admin", async () => {
    const none = await notifierService.handleEventForNotifications(
      ctxAs(systemActor("notifier")),
      fakeEvent("agent.run.failed", {
        agentRunId: randomUUID(),
        agent: "finance",
        error: "boom",
      }),
    );
    expect(none.created).toBe(0);
  });
});
