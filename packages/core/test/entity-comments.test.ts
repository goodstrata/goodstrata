import { randomUUID } from "node:crypto";
import { memberships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import type { EventRecord } from "@goodstrata/events";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, agentActor, fixedClock, systemActor, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as entityCommentsService from "../src/services/entityComments.js";
import * as grievancesService from "../src/services/grievances.js";
import * as maintenanceService from "../src/services/maintenance.js";
import * as notifierService from "../src/services/notifier.js";

/**
 * Comment threads on maintenance requests + complaints: participation rules
 * (requester/complainant + officers; respondent shut out), soft-delete, and
 * the notifier's counterparty fan-out.
 */

let tdb: TestDatabase;
let schemeId: string;
let requesterPersonId: string;
let complainantPersonId: string;
let respondentPersonId: string;
let requestId: string;
let complaintId: string;

const CHAIR = "user-chair-ec";
const REQUESTER = "user-requester-ec";
const COMPLAINANT = "user-complainant-ec";
const RESPONDENT = "user-respondent-ec";
const OTHER = "user-other-ec";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});
const memoryEmail = integrations.email as typeof integrations.email & {
  sent: { to: string; subject: string; text: string }[];
};

const NOW = "2026-07-05T00:00:00Z";
function ctx(actor: Actor = userActor(REQUESTER)): ServiceContext {
  return { db: tdb.db, clock: fixedClock(NOW), integrations, actor };
}

const member = (userId: string) => ({ userId, isOfficer: false });
const officer = (userId: string = CHAIR) => ({ userId, isOfficer: true });

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

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Thread Test OC",
      planOfSubdivision: "PS777001T",
      addressLine1: "7 Thread Tce",
      suburb: "Brunswick",
      postcode: "3056",
      tier: 3,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, REQUESTER, COMPLAINANT, RESPONDENT, OTHER].map((id) => ({
      id,
      name: `Name ${id}`,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2025-01-01" },
    { schemeId, userId: REQUESTER, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: COMPLAINANT, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: RESPONDENT, role: "owner", startedOn: "2025-01-01" },
    { schemeId, userId: OTHER, role: "owner", startedOn: "2025-01-01" },
  ]);
  const personRows = await tdb.db
    .insert(people)
    .values([
      { schemeId, userId: REQUESTER, givenName: "Rita", email: `${REQUESTER}@example.com` },
      { schemeId, userId: COMPLAINANT, givenName: "Cal", email: `${COMPLAINANT}@example.com` },
      { schemeId, userId: RESPONDENT, givenName: "Rex", email: `${RESPONDENT}@example.com` },
    ])
    .returning();
  requesterPersonId = personRows[0]!.id;
  complainantPersonId = personRows[1]!.id;
  respondentPersonId = personRows[2]!.id;

  const request = await maintenanceService.createMaintenanceRequest(ctx(), schemeId, {
    title: "Leaking foyer skylight",
    description: "Drips onto the mailboxes whenever it rains.",
    reportedByPersonId: requesterPersonId,
  });
  requestId = request.id;

  const complaint = await grievancesService.fileComplaint(ctx(userActor(COMPLAINANT)), schemeId, {
    complainantPersonId,
    respondentPersonId,
    subject: "Noise from lot 4 after 11pm",
    details: "Repeated loud music past midnight.",
    approvedForm: true,
  });
  complaintId = complaint.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("maintenance-request threads", () => {
  it("requester comments and sees the officer's reply in order", async () => {
    await entityCommentsService.addComment(
      ctx(userActor(REQUESTER)),
      schemeId,
      "maintenance_request",
      requestId,
      member(REQUESTER),
      { body: "Any update? It rained again last night." },
    );
    await entityCommentsService.addComment(
      ctx(userActor(CHAIR)),
      schemeId,
      "maintenance_request",
      requestId,
      officer(),
      { body: "Plumber is booked for Thursday." },
    );

    const thread = await entityCommentsService.listComments(
      ctx(userActor(REQUESTER)),
      schemeId,
      "maintenance_request",
      requestId,
      member(REQUESTER),
    );
    expect(thread.map((c) => c.body)).toEqual([
      "Any update? It rained again last night.",
      "Plumber is booked for Thursday.",
    ]);
    expect(thread[0]!.author).toMatchObject({ userId: REQUESTER, name: `Name ${REQUESTER}` });
    expect(thread[1]!.author.userId).toBe(CHAIR);
  });

  it("another member can neither read nor write the thread (403)", async () => {
    await expect(
      entityCommentsService.listComments(
        ctx(userActor(OTHER)),
        schemeId,
        "maintenance_request",
        requestId,
        member(OTHER),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(
      entityCommentsService.addComment(
        ctx(userActor(OTHER)),
        schemeId,
        "maintenance_request",
        requestId,
        member(OTHER),
        { body: "let me in" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("404s an unknown request and a request from another scheme", async () => {
    await expect(
      entityCommentsService.listComments(
        ctx(userActor(CHAIR)),
        schemeId,
        "maintenance_request",
        randomUUID(),
        officer(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects non-user actors (agents talk through their own surfaces)", async () => {
    await expect(
      entityCommentsService.addComment(
        ctx(agentActor("chair", "run-1")),
        schemeId,
        "maintenance_request",
        requestId,
        officer("agent"),
        { body: "beep" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("complaint threads (confidentiality)", () => {
  it("complainant and officers converse; both see the thread", async () => {
    await entityCommentsService.addComment(
      ctx(userActor(COMPLAINANT)),
      schemeId,
      "complaint",
      complaintId,
      member(COMPLAINANT),
      { body: "It happened again on Saturday." },
    );
    await entityCommentsService.addComment(
      ctx(userActor(CHAIR)),
      schemeId,
      "complaint",
      complaintId,
      officer(),
      { body: "Noted — we're arranging the discussion meeting." },
    );

    const asComplainant = await entityCommentsService.listComments(
      ctx(userActor(COMPLAINANT)),
      schemeId,
      "complaint",
      complaintId,
      member(COMPLAINANT),
    );
    expect(asComplainant).toHaveLength(2);

    const asOfficer = await entityCommentsService.listComments(
      ctx(userActor(CHAIR)),
      schemeId,
      "complaint",
      complaintId,
      officer(),
    );
    expect(asOfficer).toHaveLength(2);
  });

  it("the respondent gets 404 — the same as an unknown id, so existence never leaks", async () => {
    const respondentAttempt = entityCommentsService.listComments(
      ctx(userActor(RESPONDENT)),
      schemeId,
      "complaint",
      complaintId,
      member(RESPONDENT),
    );
    await expect(respondentAttempt).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    // Indistinguishable from probing a complaint that doesn't exist.
    const unknownAttempt = entityCommentsService.listComments(
      ctx(userActor(RESPONDENT)),
      schemeId,
      "complaint",
      randomUUID(),
      member(RESPONDENT),
    );
    await expect(unknownAttempt).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    await expect(
      entityCommentsService.addComment(
        ctx(userActor(RESPONDENT)),
        schemeId,
        "complaint",
        complaintId,
        member(RESPONDENT),
        { body: "my side of the story" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("any other member gets the same 404", async () => {
    await expect(
      entityCommentsService.listComments(
        ctx(userActor(OTHER)),
        schemeId,
        "complaint",
        complaintId,
        member(OTHER),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("soft delete", () => {
  it("authors retract their own; the row leaves the thread; double-delete 404s", async () => {
    const { comment } = await entityCommentsService.addComment(
      ctx(userActor(REQUESTER)),
      schemeId,
      "maintenance_request",
      requestId,
      member(REQUESTER),
      { body: "typo, deleting this" },
    );

    await entityCommentsService.deleteComment(
      ctx(userActor(REQUESTER)),
      schemeId,
      comment.id,
      member(REQUESTER),
    );
    const thread = await entityCommentsService.listComments(
      ctx(userActor(REQUESTER)),
      schemeId,
      "maintenance_request",
      requestId,
      member(REQUESTER),
    );
    expect(thread.some((c) => c.id === comment.id)).toBe(false);

    await expect(
      entityCommentsService.deleteComment(
        ctx(userActor(REQUESTER)),
        schemeId,
        comment.id,
        member(REQUESTER),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("officers moderate anyone's comment; non-authors without the role cannot", async () => {
    const { comment } = await entityCommentsService.addComment(
      ctx(userActor(REQUESTER)),
      schemeId,
      "maintenance_request",
      requestId,
      member(REQUESTER),
      { body: "something regrettable" },
    );

    // The requester can't delete the CHAIR's comments and vice versa without
    // the officer flag — here OTHER (not the author, not an officer) tries.
    await expect(
      entityCommentsService.deleteComment(
        ctx(userActor(OTHER)),
        schemeId,
        comment.id,
        member(OTHER),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await entityCommentsService.deleteComment(
      ctx(userActor(CHAIR)),
      schemeId,
      comment.id,
      officer(),
    );
    const thread = await entityCommentsService.listComments(
      ctx(userActor(CHAIR)),
      schemeId,
      "maintenance_request",
      requestId,
      officer(),
    );
    expect(thread.some((c) => c.id === comment.id)).toBe(false);
  });

  it("scopes deletes to the scheme", async () => {
    const otherSchemeRows = await tdb.db
      .insert(schemes)
      .values({
        name: "Other Thread OC",
        planOfSubdivision: "PS777002T",
        addressLine1: "9 Elsewhere St",
        suburb: "Brunswick",
        postcode: "3056",
        tier: 1,
        status: "active",
      })
      .returning();
    const { comment } = await entityCommentsService.addComment(
      ctx(userActor(CHAIR)),
      schemeId,
      "maintenance_request",
      requestId,
      officer(),
      { body: "scoped" },
    );
    await expect(
      entityCommentsService.deleteComment(
        ctx(userActor(CHAIR)),
        otherSchemeRows[0]!.id,
        comment.id,
        officer(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("notifier fan-out (entity.comment.created)", () => {
  const inAppFor = async (userId: string) =>
    await tdb.db.query.notifications.findMany({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.schemeId, schemeId), eqOp(t.userId, userId)),
    });

  it("a member's comment notifies the officer tier, never the author", async () => {
    const before = (await inAppFor(CHAIR)).length;
    const { created } = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      fakeEvent("entity.comment.created", {
        commentId: randomUUID(),
        entityType: "maintenance_request",
        entityId: requestId,
        authorUserId: REQUESTER,
      }),
    );
    expect(created).toBe(1); // chair is the only officer in this scheme

    const chairRows = await inAppFor(CHAIR);
    expect(chairRows.length).toBe(before + 1);
    expect(chairRows.at(-1)).toMatchObject({
      category: "maintenance",
      related: { type: "maintenance_request", id: requestId },
    });
    expect(chairRows.at(-1)!.title).toContain("Leaking foyer skylight");

    // The author hears nothing about their own comment.
    const requesterRows = await inAppFor(REQUESTER);
    expect(requesterRows.filter((n) => n.related?.type === "maintenance_request")).toHaveLength(0);

    // Email defaults ON for this type — the officer got one.
    expect(
      memoryEmail.sent.some(
        (m) => m.to === `${CHAIR}@example.com` && m.subject.includes("Leaking foyer skylight"),
      ),
    ).toBe(true);
  });

  it("an officer's comment notifies the requester", async () => {
    const { created } = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      fakeEvent("entity.comment.created", {
        commentId: randomUUID(),
        entityType: "maintenance_request",
        entityId: requestId,
        authorUserId: CHAIR,
      }),
    );
    expect(created).toBe(1);
    const rows = await inAppFor(REQUESTER);
    expect(rows.at(-1)).toMatchObject({
      category: "maintenance",
      related: { type: "maintenance_request", id: requestId },
    });
  });

  it("complaint replies reach the complainant only — never the respondent, and no subject line in the copy", async () => {
    const { created } = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      fakeEvent("entity.comment.created", {
        commentId: randomUUID(),
        entityType: "complaint",
        entityId: complaintId,
        authorUserId: CHAIR,
      }),
    );
    expect(created).toBe(1);

    const complainantRows = await inAppFor(COMPLAINANT);
    const last = complainantRows.at(-1)!;
    expect(last).toMatchObject({
      category: "general",
      related: { type: "complaint", id: complaintId },
    });
    // The bell surface never repeats the complaint's subject.
    expect(last.title).not.toContain("Noise from lot 4");
    expect(last.body).not.toContain("Noise from lot 4");

    const respondentRows = await inAppFor(RESPONDENT);
    expect(respondentRows.filter((n) => n.related?.type === "complaint")).toHaveLength(0);
  });

  it("a complainant's comment fans out to the officers", async () => {
    const before = (await inAppFor(CHAIR)).length;
    const { created } = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      fakeEvent("entity.comment.created", {
        commentId: randomUUID(),
        entityType: "complaint",
        entityId: complaintId,
        authorUserId: COMPLAINANT,
      }),
    );
    expect(created).toBe(1);
    expect((await inAppFor(CHAIR)).length).toBe(before + 1);
  });

  it("no-ops when the entity row is gone", async () => {
    const { created } = await notifierService.handleEventForNotifications(
      ctx(systemActor("notifier")),
      fakeEvent("entity.comment.created", {
        commentId: randomUUID(),
        entityType: "complaint",
        entityId: randomUUID(),
        authorUserId: CHAIR,
      }),
    );
    expect(created).toBe(0);
  });
});
