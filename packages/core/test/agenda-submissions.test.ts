import { randomUUID } from "node:crypto";
import {
  lots,
  memberships,
  notifications,
  ownerships,
  people,
  schemes,
  users,
} from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as meetingsService from "../src/services/meetings.js";
import * as notifierService from "../src/services/notifier.js";

/**
 * Owner-submitted motions/agenda items: an owner proposes a motion for an
 * upcoming meeting → pending agenda item + officer notification; an officer
 * accepts (→ real agenda item + draft motion through the addMotion path) or
 * rejects with a reason (→ submitter notified). General-meeting acceptance is
 * closed once the statutory notice has gone out (ss 72(2)/76).
 */

let tdb: TestDatabase;
let schemeId: string;
let ownerPersonId: string;
let chairPersonId: string;

const CHAIR = "user-chair-as";
const OWNER = "user-owner-as";

const NOW = "2026-07-02T00:00:00Z";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

function ctx(actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

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
      name: "Agenda Submissions OC",
      planOfSubdivision: "PS777002A",
      addressLine1: "2 Motion Mews",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = rows[0]!.id;

  await tdb.db.insert(users).values([
    { id: CHAIR, name: "Casey Chair", email: "chair-as@example.com" },
    { id: OWNER, name: "Olly Owner", email: "owner-as@example.com" },
  ]);
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2025-01-01" },
  ]);

  const chairPerson = await tdb.db
    .insert(people)
    .values({ schemeId, userId: CHAIR, givenName: "Casey", email: "chair-as@example.com" })
    .returning();
  chairPersonId = chairPerson[0]!.id;
  const ownerPerson = await tdb.db
    .insert(people)
    .values({ schemeId, userId: OWNER, givenName: "Olly", email: "owner-as@example.com" })
    .returning();
  ownerPersonId = ownerPerson[0]!.id;

  const lotRows = await tdb.db
    .insert(lots)
    .values({ schemeId, lotNumber: "1", entitlement: 10, liability: 10 })
    .returning();
  await tdb.db.insert(ownerships).values({
    schemeId,
    lotId: lotRows[0]!.id,
    personId: ownerPersonId,
    startedOn: "2020-01-01",
  });
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("owner submits → officer accepts → real agenda item + draft motion", () => {
  let meetingId: string;
  let itemId: string;

  it("stores the submission as a PENDING agenda item after the standing agenda", async () => {
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "agm",
      title: "2026 AGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [{ title: "Adopt the annual budget" }],
    });
    meetingId = meeting.id;

    const item = await meetingsService.submitAgendaItem(
      ctx(userActor(OWNER)),
      schemeId,
      meetingId,
      ownerPersonId,
      {
        title: "Install EV chargers",
        motionText: "That the owners corporation install two EV chargers in visitor parking.",
        rationale: "Three owners now drive EVs and the nearest charger is 4 km away.",
      },
    );
    expect(item.status).toBe("pending");
    expect(item.submittedByPersonId).toBe(ownerPersonId);
    expect(item.motionText).toContain("EV chargers");
    expect(item.body).toContain("4 km away");
    expect(item.order).toBe(2); // after the standing item
    itemId = item.id;

    // Pending items are NOT part of the agenda proper.
    const detail = await meetingsService.meetingDetail(ctx(), schemeId, meetingId);
    expect(detail.agenda.map((a) => a.title)).toEqual(["Adopt the annual budget"]);
    expect(detail.submissions.map((s) => s.id)).toEqual([itemId]);
  });

  it("notifies the officers (but never the submitter about their own proposal)", async () => {
    const { created } = await notifierService.handleEventForNotifications(
      ctx(),
      fakeEvent("agenda_item.submitted", {
        agendaItemId: itemId,
        meetingId,
        title: "Install EV chargers",
        submittedByPersonId: ownerPersonId,
      }),
    );
    expect(created).toBe(1); // the chair
    const chairBell = await tdb.db.query.notifications.findMany({
      where: eq(notifications.userId, CHAIR),
    });
    expect(chairBell.some((n) => n.title.includes("Install EV chargers"))).toBe(true);

    // An officer submitting their own item is excluded from the fan-out.
    const selfSubmitted = await notifierService.handleEventForNotifications(
      ctx(),
      fakeEvent("agenda_item.submitted", {
        agendaItemId: randomUUID(),
        meetingId,
        title: "Chair's own item",
        submittedByPersonId: chairPersonId,
      }),
    );
    expect(selfSubmitted.created).toBe(0);
  });

  it("is scheme-scoped: another scheme cannot accept the item", async () => {
    const other = await tdb.db
      .insert(schemes)
      .values({
        name: "Other OC",
        planOfSubdivision: "PS777003B",
        addressLine1: "3 Foreign St",
        suburb: "Brunswick",
        postcode: "3056",
        tier: 5,
        status: "active",
      })
      .returning();
    await expect(
      meetingsService.acceptAgendaItem(ctx(userActor(CHAIR)), other[0]!.id, itemId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accept turns it into a real agenda item with a draft motion", async () => {
    const { agendaItem, motion } = await meetingsService.acceptAgendaItem(
      ctx(userActor(CHAIR)),
      schemeId,
      itemId,
    );
    expect(agendaItem.status).toBe("accepted");
    expect(motion.status).toBe("draft");
    expect(motion.meetingId).toBe(meetingId);
    expect(motion.agendaItemId).toBe(itemId);
    expect(motion.title).toBe("Install EV chargers");
    expect(motion.text).toContain("install two EV chargers");
    expect(motion.resolutionType).toBe("ordinary");

    // Now it IS on the agenda and listed among the meeting's motions.
    const detail = await meetingsService.meetingDetail(ctx(), schemeId, meetingId);
    expect(detail.agenda.map((a) => a.title)).toEqual([
      "Adopt the annual budget",
      "Install EV chargers",
    ]);
    expect(detail.submissions).toHaveLength(0);
    expect(detail.motions.some((m) => m.id === motion.id)).toBe(true);

    // Accepting again 409s rather than double-creating the motion.
    await expect(
      meetingsService.acceptAgendaItem(ctx(userActor(CHAIR)), schemeId, itemId),
    ).rejects.toMatchObject({ code: "BAD_STATUS" });
  });

  it("notifies the submitter on acceptance", async () => {
    const { created } = await notifierService.handleEventForNotifications(
      ctx(),
      fakeEvent("agenda_item.accepted", {
        agendaItemId: itemId,
        meetingId,
        motionId: randomUUID(),
        submittedByPersonId: ownerPersonId,
      }),
    );
    expect(created).toBe(1);
    const ownerBell = await tdb.db.query.notifications.findMany({
      where: eq(notifications.userId, OWNER),
    });
    expect(ownerBell.some((n) => n.title.includes("accepted"))).toBe(true);
  });
});

describe("general-meeting notice closes the agenda (ss 72(2)/76)", () => {
  let meetingId: string;
  let pendingBeforeNoticeId: string;

  it("a pending submission never rides the statutory notice", async () => {
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "agm",
      title: "Notice Discipline AGM",
      scheduledAt: "2026-08-15T09:00:00Z",
      agenda: [{ title: "Standing business" }],
    });
    meetingId = meeting.id;
    const pending = await meetingsService.submitAgendaItem(
      ctx(userActor(OWNER)),
      schemeId,
      meetingId,
      ownerPersonId,
      { title: "Repaint the lobby", motionText: "That the OC repaint the lobby." },
    );
    pendingBeforeNoticeId = pending.id;

    memoryEmail.sent.length = 0;
    await meetingsService.sendMeetingNotice(ctx(), schemeId, meetingId);
    expect(memoryEmail.sent.length).toBeGreaterThan(0);
    expect(memoryEmail.sent[0]!.text).toContain("Standing business");
    expect(memoryEmail.sent[0]!.text).not.toContain("Repaint the lobby");
  });

  it("submitting to a noticed general meeting is refused", async () => {
    await expect(
      meetingsService.submitAgendaItem(ctx(userActor(OWNER)), schemeId, meetingId, ownerPersonId, {
        title: "Too late item",
        motionText: "That this arrives after the notice.",
      }),
    ).rejects.toMatchObject({ code: "NOTICE_SENT" });
  });

  it("accepting after the notice went out is refused, but rejecting still works", async () => {
    await expect(
      meetingsService.acceptAgendaItem(ctx(userActor(CHAIR)), schemeId, pendingBeforeNoticeId),
    ).rejects.toMatchObject({ code: "NOTICE_SENT" });

    const { agendaItem } = await meetingsService.rejectAgendaItem(
      ctx(userActor(CHAIR)),
      schemeId,
      pendingBeforeNoticeId,
      { reason: "The notice has already gone out; resubmit for the next general meeting." },
    );
    expect(agendaItem.status).toBe("rejected");
    expect(agendaItem.rejectedReason).toContain("notice has already gone out");

    // Rejecting twice 409s.
    await expect(
      meetingsService.rejectAgendaItem(ctx(userActor(CHAIR)), schemeId, pendingBeforeNoticeId, {
        reason: "again",
      }),
    ).rejects.toMatchObject({ code: "BAD_STATUS" });
  });

  it("reject path notifies the submitter with the reason", async () => {
    const before = await tdb.db.query.notifications.findMany({
      where: eq(notifications.userId, OWNER),
    });
    const { created } = await notifierService.handleEventForNotifications(
      ctx(),
      fakeEvent("agenda_item.rejected", {
        agendaItemId: pendingBeforeNoticeId,
        meetingId,
        reason: "The notice has already gone out; resubmit for the next general meeting.",
        submittedByPersonId: ownerPersonId,
      }),
    );
    expect(created).toBe(1);
    const after = await tdb.db.query.notifications.findMany({
      where: eq(notifications.userId, OWNER),
    });
    const fresh = after.filter((n) => !before.some((b) => b.id === n.id));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.title).toContain("declined");
    expect(fresh[0]!.body).toContain("resubmit for the next general meeting");
  });
});

describe("committee meetings keep accepting items after their notice", () => {
  it("submit and accept still work while a committee meeting is notice_sent", async () => {
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "committee",
      title: "July committee meeting",
      scheduledAt: "2026-07-10T18:00:00Z", // <14 days is fine for committee notices
      agenda: [],
    });
    await meetingsService.sendMeetingNotice(ctx(), schemeId, meeting.id);

    const item = await meetingsService.submitAgendaItem(
      ctx(userActor(OWNER)),
      schemeId,
      meeting.id,
      ownerPersonId,
      { title: "Review gardening quotes", motionText: "That the committee review the quotes." },
    );
    expect(item.status).toBe("pending");

    const { motion } = await meetingsService.acceptAgendaItem(
      ctx(userActor(CHAIR)),
      schemeId,
      item.id,
      { resolutionType: "ordinary" },
    );
    expect(motion.meetingId).toBe(meeting.id);
  });
});
