import { funds, lots, ownerships, people, schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import {
  type ConsoleVideoProvider,
  integrationsFromEnv,
  mockPaymentsProvider,
} from "@goodstrata/integrations";
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

  it("meetingDetail carries each motion's recorded votes so clients can gate the controls", async () => {
    const ctx = ctxAt(NOW);
    const detail = await meetingsService.meetingDetail(ctx, schemeId, meetingId);
    const voted = detail.motions.find((m) => m.id === motionId)!;
    expect(voted.votes).toHaveLength(3);
    expect(voted.votes).toEqual(
      expect.arrayContaining([
        { lotId: lotByNumber.get("1")!, choice: "for" },
        { lotId: lotByNumber.get("2")!, choice: "for" },
        { lotId: lotByNumber.get("3")!, choice: "against" },
      ]),
    );

    // A motion nobody has voted on reads as an empty list, never undefined —
    // clients treat a missing list as "state unknown" and withdraw the controls.
    const untouched = await meetingsService.addMotion(ctx, schemeId, {
      meetingId,
      title: "Note the fire-safety statement",
      text: "That the OC notes the annual essential-safety-measures report.",
      resolutionType: "ordinary",
    });
    const after = await meetingsService.meetingDetail(ctx, schemeId, meetingId);
    expect(after.motions.find((m) => m.id === untouched.id)!.votes).toEqual([]);
  });

  it("s 89B: a lot in arrears cannot vote on ordinary resolutions", async () => {
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

    // Pat (lot 4, in arrears) is barred from the ordinary motion (s 89B, ex-s 94).
    await expect(
      meetingsService.castVote(ctxAt(NOW), schemeId, personByName.get("Pat")!, {
        motionId,
        lotId: lotByNumber.get("4")!,
        choice: "against",
      }),
    ).rejects.toThrow(/s 89B/i);
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

    // Pat CAN vote on a special resolution despite arrears (s 94 covers ordinary only).
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
    // 30/50 = 60% for, 0 against — short of the s 96 75% but, at this quorate
    // AGM, an INTERIM special resolution under s 97 (provisionally carried,
    // ripening after 29 days).
    const tally = await meetingsService.closeMotion(ctx, schemeId, specialMotionId);
    expect(tally.forWeight).toBe(30);
    expect(tally.carried).toBe(true);
    expect(tally.interim).toBe(true);
    expect(tally.interimKind).toBe("interim_special");
    const row = await tdb.db.query.motions.findFirst({
      where: (t, { eq }) => eq(t.id, specialMotionId),
    });
    expect(row!.status).toBe("carried");
    expect((row!.result as { interim: boolean }).interim).toBe(true);
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

describe("video meetings", () => {
  let committeeMeetingId: string;

  it("starts a video room for a committee meeting and flips notice_sent → in_progress", async () => {
    const ctx = ctxAt(NOW);
    const meeting = await meetingsService.createMeeting(ctx, schemeId, {
      kind: "committee",
      title: "July committee catch-up",
      scheduledAt: "2026-07-03T09:00:00Z",
      agenda: [],
    });
    committeeMeetingId = meeting.id;
    await meetingsService.sendMeetingNotice(ctx, schemeId, committeeMeetingId);

    // Joining before the room exists is rejected.
    await expect(
      meetingsService.joinVideoMeeting(ctx, schemeId, committeeMeetingId, "Alex Chen"),
    ).rejects.toThrow(/not been started/i);

    const { url } = await meetingsService.startVideoMeeting(ctx, schemeId, committeeMeetingId);
    expect(url).toContain(meetingsService.videoRoomName(committeeMeetingId));

    const updated = await tdb.db.query.meetings.findFirst({
      where: (t, { eq }) => eq(t.id, committeeMeetingId),
    });
    expect(updated!.videoUrl).toBe(url);
    expect(updated!.status).toBe("in_progress");

    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.video.started"),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ meetingId: committeeMeetingId, url });

    // Idempotent: a second start returns the same room without a new event.
    const again = await meetingsService.startVideoMeeting(ctx, schemeId, committeeMeetingId);
    expect(again.url).toBe(url);
    const eventsAfter = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.video.started"),
    });
    expect(eventsAfter).toHaveLength(1);
  });

  it("members join with a room-scoped token", async () => {
    const ctx = ctxAt(NOW);
    const { url, token } = await meetingsService.joinVideoMeeting(
      ctx,
      schemeId,
      committeeMeetingId,
      "Alex Chen",
    );
    expect(url).toContain(meetingsService.videoRoomName(committeeMeetingId));
    expect(token).toContain(meetingsService.videoRoomName(committeeMeetingId));
    expect(token).toContain("Alex_Chen");
  });

  it("rejects video for SGMs", async () => {
    const ctx = ctxAt(NOW);
    const sgm = await meetingsService.createMeeting(ctx, schemeId, {
      kind: "sgm",
      title: "Special general meeting",
      scheduledAt: "2026-09-01T09:00:00Z",
      agenda: [],
    });
    await expect(meetingsService.startVideoMeeting(ctx, schemeId, sgm.id)).rejects.toThrow(
      /committee meetings and AGMs/,
    );
  });

  it("started transcription with the room and reports it in meetingDetail", async () => {
    const ctx = ctxAt(NOW);
    const video = integrations.video as ConsoleVideoProvider;
    expect(video.transcribingRooms.has(meetingsService.videoRoomName(committeeMeetingId))).toBe(
      true,
    );
    const detail = await meetingsService.meetingDetail(ctx, schemeId, committeeMeetingId);
    expect(detail.transcriptionStarted).toBe(true);
    expect(detail.chairLog).toEqual([]);
  });

  it("chair notes append to the log, publish an event, and post to the room chat", async () => {
    const ctx = ctxAt(NOW);
    const entry = await meetingsService.chairNote(ctx, schemeId, committeeMeetingId, {
      kind: "guidance",
      note: "Welcome everyone — we will start with item 1.",
    });
    expect(entry).toEqual({
      at: "2026-07-02T00:00:00.000Z",
      kind: "guidance",
      note: "Welcome everyone — we will start with item 1.",
    });

    const detail = await meetingsService.meetingDetail(ctx, schemeId, committeeMeetingId);
    expect(detail.chairLog).toEqual([entry]);

    const video = integrations.video as ConsoleVideoProvider;
    expect(video.chatMessages).toContainEqual({
      roomName: meetingsService.videoRoomName(committeeMeetingId),
      text: "Welcome everyone — we will start with item 1.",
      fromName: "GoodStrata Chair",
    });

    const events = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.chair.note"),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      meetingId: committeeMeetingId,
      kind: "guidance",
      note: "Welcome everyone — we will start with item 1.",
    });
  });

  it("conductTick publishes tick events while in progress and enforces the cap", async () => {
    const ctx = ctxAt(NOW);
    const first = await meetingsService.conductTick(ctx, schemeId, committeeMeetingId, 1);
    expect(first).toEqual({ proceed: true });

    const ticks = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.conduct.tick"),
    });
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.payload).toMatchObject({ meetingId: committeeMeetingId, tick: 1 });

    // Runaway guard: past the cap the loop stops without publishing.
    const capped = await meetingsService.conductTick(
      ctx,
      schemeId,
      committeeMeetingId,
      meetingsService.MAX_CONDUCT_TICKS + 1,
    );
    expect(capped).toEqual({ proceed: false, reason: "tick_cap" });
  });

  it("closeMeeting stops transcription, stores the transcript, and links it in the event", async () => {
    const ctx = ctxAt(NOW);
    const video = integrations.video as ConsoleVideoProvider;
    const roomName = meetingsService.videoRoomName(committeeMeetingId);
    video.setTranscript(
      roomName,
      "Alex Chen: I move we accept the gutter quote.\nKim Nguyen: Seconded.",
    );

    await meetingsService.closeMeeting(ctx, schemeId, committeeMeetingId);

    expect(video.transcribingRooms.has(roomName)).toBe(false);

    const docs = await tdb.db.query.documents.findMany({
      where: (t, { eq }) => eq(t.title, "Meeting transcript"),
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ category: "minutes", accessLevel: "committee" });
    const stored = await integrations.storage.get(docs[0]!.storageKey);
    expect(new TextDecoder().decode(stored)).toContain("Seconded.");

    const closed = await tdb.db.query.eventLog.findMany({
      where: (t, { eq }) => eq(t.type, "meeting.closed"),
    });
    const committeeClosed = closed.find(
      (e) => (e.payload as { meetingId: string }).meetingId === committeeMeetingId,
    );
    expect(committeeClosed?.payload).toMatchObject({ transcriptDocumentId: docs[0]!.id });

    // The conductor loop refuses to continue once the meeting has closed.
    const after = await meetingsService.conductTick(ctx, schemeId, committeeMeetingId, 2);
    expect(after).toEqual({ proceed: false, reason: "not_in_progress" });
  });
});

describe("polls (s 92(3)–(5)) and proxy validity", () => {
  let sgmId: string;
  let pollMotionId: string;

  it("a lot owner can demand a poll, but only while voting is open", async () => {
    const ctx = ctxAt(NOW);
    const meeting = await meetingsService.createMeeting(ctx, schemeId, {
      kind: "sgm",
      title: "Bike rack SGM",
      scheduledAt: "2026-08-15T09:00:00Z",
      agenda: [],
    });
    sgmId = meeting.id;
    const motion = await meetingsService.addMotion(ctx, schemeId, {
      meetingId: sgmId,
      title: "Install a bike rack",
      text: "That the OC installs a bike rack in the basement.",
      resolutionType: "ordinary",
    });
    pollMotionId = motion.id;

    // Voting hasn't opened yet.
    await expect(
      meetingsService.demandPoll(ctx, schemeId, personByName.get("Sam")!, pollMotionId),
    ).rejects.toThrow(/open/i);

    await meetingsService.openMotion(ctx, schemeId, pollMotionId);
    const res = await meetingsService.demandPoll(
      ctx,
      schemeId,
      personByName.get("Sam")!,
      pollMotionId,
    );
    expect(res.pollDemanded).toBe(true);
    // A second demand is a no-op, not an error.
    const again = await meetingsService.demandPoll(
      ctx,
      schemeId,
      personByName.get("Sam")!,
      pollMotionId,
    );
    expect(again.pollDemanded).toBe(true);
  });

  it("polls don't apply to special resolutions", async () => {
    const ctx = ctxAt(NOW);
    const special = await meetingsService.addMotion(ctx, schemeId, {
      meetingId: sgmId,
      title: "Change the rules",
      text: "That the OC adopts new model rules.",
      resolutionType: "special",
    });
    await meetingsService.openMotion(ctx, schemeId, special.id);
    await expect(
      meetingsService.demandPoll(ctx, schemeId, personByName.get("Sam")!, special.id),
    ).rejects.toThrow(/ordinary/i);
  });

  it("a demanded poll re-tallies the motion by entitlement", async () => {
    const ctx = ctxAt(NOW);
    // Sam's big lot (20) for; Alex (10) against; Kim (10) abstains.
    // Headcount would be a 1–1 tie (lost); the poll carries it 20 v 10.
    await meetingsService.castVote(ctx, schemeId, personByName.get("Sam")!, {
      motionId: pollMotionId,
      lotId: lotByNumber.get("1")!,
      choice: "for",
    });
    await meetingsService.castVote(ctx, schemeId, personByName.get("Alex")!, {
      motionId: pollMotionId,
      lotId: lotByNumber.get("2")!,
      choice: "against",
    });
    await meetingsService.castVote(ctx, schemeId, personByName.get("Kim")!, {
      motionId: pollMotionId,
      lotId: lotByNumber.get("3")!,
      choice: "abstain",
    });

    const tally = await meetingsService.closeMotion(ctx, schemeId, pollMotionId);
    expect(tally).toMatchObject({
      carried: true,
      basis: "entitlement",
      pollDemanded: true,
      forWeight: 20,
      againstWeight: 10,
      forCount: 1,
      againstCount: 1,
    });
  });

  it("expired proxies no longer count toward quorum", async () => {
    const ctx = ctxAt(NOW);
    // Kim (10) attends; Pat's proxy to Kim lapsed before today, so lot 4 is
    // NOT represented and quorum stays at 10/50.
    await meetingsService.recordAttendance(ctx, schemeId, sgmId, personByName.get("Kim")!, "online");
    await meetingsService.submitProxy(ctx, schemeId, personByName.get("Pat")!, {
      lotId: lotByNumber.get("4")!,
      proxyPersonId: personByName.get("Kim")!,
      meetingId: sgmId,
      expiresOn: "2026-06-30",
    });
    const quorum = await meetingsService.quorumStatus(ctx, schemeId, sgmId);
    expect(quorum.representedEntitlement).toBe(10);
    expect(quorum.quorate).toBe(false);
  });
});
