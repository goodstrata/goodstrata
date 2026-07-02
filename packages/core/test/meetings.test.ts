import { funds, lots, ownerships, people, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as budgetsService from "../src/services/budgets.js";
import * as decisionsService from "../src/services/decisions.js";
import * as leviesService from "../src/services/levies.js";
import * as meetingsService from "../src/services/meetings.js";

let tdb: TestDatabase;
let schemeId: string;
const lotByNumber = new Map<string, string>();
const personByName = new Map<string, string>();

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

const NOW = "2026-07-02T00:00:00Z";
function ctxAt(iso: string, actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso), integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name: "AGM Test OC",
      planOfSubdivision: "PS555555G",
      addressLine1: "5 Vote St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;
  await tdb.db.insert(funds).values([
    { schemeId, kind: "admin", name: "Admin" },
    { schemeId, kind: "maintenance", name: "Maintenance" },
  ]);

  // Shop (20) + three flats (10 each) = 50 total entitlement.
  const specs = [
    ["1", 20, "Sam"],
    ["2", 10, "Alex"],
    ["3", 10, "Kim"],
    ["4", 10, "Pat"],
  ] as const;
  for (const [num, ent, name] of specs) {
    const lotRows = await tdb.db
      .insert(lots)
      .values({ schemeId, lotNumber: num, entitlement: ent, liability: ent })
      .returning();
    lotByNumber.set(num, lotRows[0]!.id);
    const personRows = await tdb.db
      .insert(people)
      .values({ schemeId, givenName: name, email: `${name.toLowerCase()}@example.com` })
      .returning();
    personByName.set(name, personRows[0]!.id);
    await tdb.db.insert(ownerships).values({
      schemeId,
      lotId: lotRows[0]!.id,
      personId: personRows[0]!.id,
      startedOn: "2020-01-01",
    });
  }
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("AGM lifecycle", () => {
  let meetingId: string;
  let motionId: string;
  let specialMotionId: string;

  it("schedules with agenda and enforces the 14-day notice rule", async () => {
    const ctx = ctxAt(NOW);
    const early = await meetingsService.createMeeting(ctx, schemeId, {
      kind: "agm",
      title: "Rushed AGM",
      scheduledAt: "2026-07-10T09:00:00Z", // 8 days out
      agenda: [],
    });
    await expect(meetingsService.sendMeetingNotice(ctx, schemeId, early.id)).rejects.toThrow(
      /14 days/,
    );

    const meeting = await meetingsService.createMeeting(ctx, schemeId, {
      kind: "agm",
      title: "2026 Annual General Meeting",
      scheduledAt: "2026-08-01T09:00:00Z",
      location: "Common room",
      agenda: [{ title: "Financial statements" }, { title: "Committee election" }],
    });
    meetingId = meeting.id;

    memoryEmail.sent.length = 0;
    const result = await meetingsService.sendMeetingNotice(ctx, schemeId, meetingId);
    expect(result.recipients).toBe(4);
    expect(memoryEmail.sent).toHaveLength(4);
    expect(memoryEmail.sent[0]!.subject).toContain("Notice of AGM");
    expect(memoryEmail.sent[0]!.text).toContain("Financial statements");
  });

  it("tracks quorum from attendance and proxies by entitlement", async () => {
    const ctx = ctxAt(NOW);
    // Alex (10) attends — 10/50, not quorate.
    let quorum = await meetingsService.recordAttendance(
      ctx,
      schemeId,
      meetingId,
      personByName.get("Alex")!,
      "online",
    );
    expect(quorum.quorate).toBe(false);

    // Sam (20) gives Alex a proxy — 30/50 = 60% ≥ 50%: now quorate.
    await meetingsService.submitProxy(ctx, schemeId, personByName.get("Sam")!, {
      lotId: lotByNumber.get("1")!,
      proxyPersonId: personByName.get("Alex")!,
      meetingId,
    });
    quorum = await meetingsService.quorumStatus(ctx, schemeId, meetingId);
    expect(quorum.representedEntitlement).toBe(30);
    expect(quorum.quorate).toBe(true);

    // Kim (10) attends too — 40/50 represented.
    quorum = await meetingsService.recordAttendance(
      ctx,
      schemeId,
      meetingId,
      personByName.get("Kim")!,
      "in_person",
    );
    expect(quorum.representedEntitlement).toBe(40);
    expect(quorum.quorate).toBe(true);
  });

  it("only owners or proxy holders can vote, once per lot", async () => {
    const ctx = ctxAt(NOW);
    const motion = await meetingsService.addMotion(ctx, schemeId, {
      meetingId,
      title: "Repaint the stairwell",
      text: "That the OC engages a painter for the common stairwell.",
      resolutionType: "ordinary",
    });
    motionId = motion.id;
    await meetingsService.openMotion(ctx, schemeId, motionId);

    // Pat cannot vote for Sam's lot (no proxy).
    await expect(
      meetingsService.castVote(ctx, schemeId, personByName.get("Pat")!, {
        motionId,
        lotId: lotByNumber.get("1")!,
        choice: "for",
      }),
    ).rejects.toThrow(/standing|proxy/i);

    // Alex votes their own lot; Alex also votes Sam's lot via proxy.
    await meetingsService.castVote(ctx, schemeId, personByName.get("Alex")!, {
      motionId,
      lotId: lotByNumber.get("2")!,
      choice: "for",
    });
    await meetingsService.castVote(ctx, schemeId, personByName.get("Alex")!, {
      motionId,
      lotId: lotByNumber.get("1")!,
      choice: "for",
    });

    // Kim votes against; double-vote for the same lot is rejected.
    await meetingsService.castVote(ctx, schemeId, personByName.get("Kim")!, {
      motionId,
      lotId: lotByNumber.get("3")!,
      choice: "against",
    });
    await expect(
      meetingsService.castVote(ctx, schemeId, personByName.get("Kim")!, {
        motionId,
        lotId: lotByNumber.get("3")!,
        choice: "for",
      }),
    ).rejects.toThrow(/already/i);
  });

  it("s 89: a lot in arrears cannot vote on ordinary resolutions", async () => {
    // Put Pat's lot 4 into arrears: adopt a budget, issue levies due long ago.
    const mgr = userActor("mgr-agm");
    await tdb.db.insert((await import("@goodstrata/db")).users).values({
      id: "mgr-agm",
      name: "Mgr",
      email: "mgr@example.com",
    });
    const ctxPast = ctxAt("2026-01-01T00:00:00Z", mgr);
    const budget = await budgetsService.createBudget(ctxPast, schemeId, {
      fiscalYearStart: "2026-01-01",
      adminCents: 500_000,
      maintenanceCents: 0,
    });
    const pending = await decisionsService.listDecisions(ctxPast, schemeId, "pending");
    const budgetDecision = pending.find((d) => (d.subject as { id?: string })?.id === budget.id)!;
    await decisionsService.resolveDecision(ctxPast, schemeId, budgetDecision.id, "approve", [
      "treasurer",
    ]);
    await decisionsService.executeDecisionFollowUp(
      ctxAt("2026-01-01T00:00:00Z"),
      budgetDecision.id,
    );
    const schedule = await leviesService.createLevySchedule(ctxPast, schemeId, {
      budgetId: budget.id,
      frequency: "annual",
      firstDueOn: "2026-02-01",
    });
    await leviesService.issueLevyRun(ctxPast, schemeId, schedule.id, 1);
    // It is now July; everyone is overdue. Pay everyone EXCEPT Pat.
    const notices = await leviesService.listNotices(ctxAt(NOW), schemeId);
    const provider = integrations.payments;
    const paymentsService = await import("../src/services/payments.js");
    for (const notice of notices) {
      if (notice.lotId === lotByNumber.get("4")) continue;
      const body = provider.buildWebhookBody({
        payid: notice.payid!,
        amountCents: notice.totalCents,
        paidAt: "2026-03-01T00:00:00Z",
        payerName: "owner",
      });
      await paymentsService.recordInboundPayment(ctxAt(NOW), "mock", provider.parseWebhook(body));
    }

    // Pat (lot 4, in arrears) is barred from the ordinary motion.
    await expect(
      meetingsService.castVote(ctxAt(NOW), schemeId, personByName.get("Pat")!, {
        motionId,
        lotId: lotByNumber.get("4")!,
        choice: "against",
      }),
    ).rejects.toThrow(/s 89/i);
  });

  it("closes the motion with the entitlement-weighted tally", async () => {
    const ctx = ctxAt(NOW);
    const tally = await meetingsService.closeMotion(ctx, schemeId, motionId);
    // For: Alex(10) + Sam-via-proxy(20) = 30; Against: Kim(10).
    expect(tally).toMatchObject({
      forWeight: 30,
      againstWeight: 10,
      carried: true,
      resolutionType: "ordinary",
    });
  });

  it("special resolutions need 75% of ALL entitlements — arrears lots may vote", async () => {
    const ctx = ctxAt(NOW);
    const motion = await meetingsService.addMotion(ctx, schemeId, {
      meetingId,
      title: "Amend the rules",
      text: "That the OC adopts amended rules.",
      resolutionType: "special",
    });
    specialMotionId = motion.id;
    await meetingsService.openMotion(ctx, schemeId, specialMotionId);

    // Pat CAN vote on a special resolution despite arrears (s 89 covers ordinary only).
    await meetingsService.castVote(ctx, schemeId, personByName.get("Pat")!, {
      motionId: specialMotionId,
      lotId: lotByNumber.get("4")!,
      choice: "for",
    });
    await meetingsService.castVote(ctx, schemeId, personByName.get("Alex")!, {
      motionId: specialMotionId,
      lotId: lotByNumber.get("2")!,
      choice: "for",
    });
    await meetingsService.castVote(ctx, schemeId, personByName.get("Kim")!, {
      motionId: specialMotionId,
      lotId: lotByNumber.get("3")!,
      choice: "for",
    });
    // 30/50 = 60% < 75% — lost without Sam.
    const tally = await meetingsService.closeMotion(ctx, schemeId, specialMotionId);
    expect(tally.carried).toBe(false);
    expect(tally.forWeight).toBe(30);
  });

  it("closing the meeting records quorum and emits meeting.closed", async () => {
    const ctx = ctxAt(NOW);
    const quorum = await meetingsService.closeMeeting(ctx, schemeId, meetingId);
    expect(quorum.quorate).toBe(true);
    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.closed"),
    });
    expect(events).toHaveLength(1);
  });
});
