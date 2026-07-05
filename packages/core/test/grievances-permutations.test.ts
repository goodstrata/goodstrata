/**
 * Permutation coverage for the grievance family (P0-3):
 *
 *   - input-schema permutations (field boundaries the RaiseComplaintDialog /
 *     IssueBreachNotice / StatusControls forms rely on),
 *   - the complaint state machine (every legal walk the StatusControls select
 *     offers, and the illegal jumps the server must refuse),
 *   - breach-notice issue/close permutations incl. double-close (the
 *     BreachNoticeRow "buttons hidden after close" server invariant),
 *   - owner-vs-register list scoping (listMyComplaints vs listComplaints).
 *
 * Role *gating* (owner/committee_member cannot reach the register or advance)
 * is an API-middleware concern covered in
 * apps/api/src/grievances-compliance-permutations.test.ts.
 */
import { people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import { DomainError } from "../src/errors.js";
import * as grievances from "../src/services/grievances.js";
import {
  advanceComplaintInput,
  fileComplaintInput,
  issueBreachNoticeInput,
} from "../src/services/grievances.js";

let tdb: TestDatabase;
let schemeId: string;
let otherSchemeId: string;
/** Person on the roll with no login (the usual respondent). */
let respondentPersonId: string;
/** Person linked to the OWNER login (self-service complainant). */
let ownerPersonId: string;
/** A person in a DIFFERENT scheme (cross-scheme rejection cases). */
let strangerPersonId: string;

/** Officer login — the service trusts the API layer for role gating. */
const OFFICER = userActor("user-gp-officer");
/** Owner login linked to a person row (files on their own behalf). */
const OWNER = userActor("user-gp-owner");
/** A login with no people row anywhere (unlinked). */
const UNLINKED = userActor("user-gp-unlinked");

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

const NOW = "2026-07-01T00:00:00Z";

function ctx(actor: Actor = OFFICER, at: string = NOW): ServiceContext {
  return { db: tdb.db, clock: fixedClock(at), integrations, actor };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const schemeRows = await tdb.db
    .insert(schemes)
    .values([
      {
        name: "Permutation OC",
        planOfSubdivision: "PS777001P",
        addressLine1: "1 Matrix Way",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 3,
        status: "active",
      },
      {
        name: "Elsewhere OC",
        planOfSubdivision: "PS777002P",
        addressLine1: "2 Elsewhere St",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 1,
        status: "active",
      },
    ])
    .returning();
  schemeId = schemeRows[0]!.id;
  otherSchemeId = schemeRows[1]!.id;

  await tdb.db.insert(users).values([
    { id: OFFICER.id, name: "Olive Officer", email: "olive@example.com" },
    { id: OWNER.id, name: "Owen Owner", email: "owen@example.com" },
    { id: UNLINKED.id, name: "Uma Unlinked", email: "uma@example.com" },
  ]);

  const personRows = await tdb.db
    .insert(people)
    .values([
      { schemeId, givenName: "Rita", familyName: "Respondent", email: "rita@example.com" },
      {
        schemeId,
        givenName: "Owen",
        familyName: "Owner",
        email: "owen@example.com",
        userId: OWNER.id,
      },
      {
        schemeId: otherSchemeId,
        givenName: "Sam",
        familyName: "Stranger",
        email: "sam@example.com",
      },
    ])
    .returning();
  respondentPersonId = personRows[0]!.id;
  ownerPersonId = personRows[1]!.id;
  strangerPersonId = personRows[2]!.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

// ---------------------------------------------------------------------------
// Input-schema permutations (what the API's zv() gate accepts/rejects).
// ---------------------------------------------------------------------------

describe("fileComplaintInput — field permutations", () => {
  const base = { subject: "abc", details: "abc" };

  it("rejects a 2-character subject and accepts the 3-character minimum", () => {
    const short = fileComplaintInput.safeParse({ ...base, subject: "ab" });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.path).toEqual(["subject"]);
    expect(fileComplaintInput.safeParse(base).success).toBe(true);
  });

  it("rejects 2-character details and accepts the 3-character minimum", () => {
    const short = fileComplaintInput.safeParse({ ...base, details: "ab" });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.path).toEqual(["details"]);
  });

  it("caps the subject at 200 characters", () => {
    expect(fileComplaintInput.safeParse({ ...base, subject: "s".repeat(200) }).success).toBe(true);
    expect(fileComplaintInput.safeParse({ ...base, subject: "s".repeat(201) }).success).toBe(false);
  });

  it("defaults approvedForm to false and keeps respondent optional", () => {
    const parsed = fileComplaintInput.parse(base);
    expect(parsed.approvedForm).toBe(false);
    expect(parsed.respondentPersonId).toBeUndefined();
  });

  it("rejects the UI's 'none' sentinel — the form must map it to undefined", () => {
    // RaiseComplaintDialog sends respondentPersonId: undefined for "No one in
    // particular"; sending the literal sentinel would be a 422, not a null.
    expect(fileComplaintInput.safeParse({ ...base, respondentPersonId: "none" }).success).toBe(
      false,
    );
  });
});

describe("advanceComplaintInput — status/note permutations", () => {
  it("accepts every known status and an optional note", () => {
    for (const status of [
      "received",
      "under_discussion",
      "notice_to_rectify",
      "final_notice",
      "resolved",
      "withdrawn",
      "vcat",
    ]) {
      expect(advanceComplaintInput.safeParse({ status }).success).toBe(true);
    }
    expect(advanceComplaintInput.parse({ status: "resolved" }).note).toBeUndefined();
    expect(advanceComplaintInput.parse({ status: "resolved", note: "done" }).note).toBe("done");
  });

  it("rejects unknown statuses and a missing status (button stays disabled)", () => {
    expect(advanceComplaintInput.safeParse({ status: "reopened" }).success).toBe(false);
    expect(advanceComplaintInput.safeParse({}).success).toBe(false);
    expect(advanceComplaintInput.safeParse({ status: "" }).success).toBe(false);
  });
});

describe("issueBreachNoticeInput — field permutations", () => {
  const base = {
    subjectPersonId: "00000000-0000-4000-8000-000000000001",
    ruleRef: "Model Rule 1.1",
    type: "notice_to_rectify",
    details: "abc",
  };

  it("rejects an empty ruleRef", () => {
    expect(issueBreachNoticeInput.safeParse({ ...base, ruleRef: "" }).success).toBe(false);
  });

  it("rejects a notice naming neither a subject lot nor a person (forced via API)", () => {
    const { subjectPersonId: _drop, ...noSubject } = base;
    const result = issueBreachNoticeInput.safeParse(noSubject);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/subject lot or person/);
  });

  it("accepts both notice types and rejects anything else", () => {
    expect(issueBreachNoticeInput.safeParse({ ...base, type: "final_notice" }).success).toBe(true);
    expect(issueBreachNoticeInput.safeParse({ ...base, type: "warning" }).success).toBe(false);
  });

  it("holds details to the same 3-character minimum as complaints", () => {
    expect(issueBreachNoticeInput.safeParse({ ...base, details: "ab" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fileComplaint behaviour permutations.
// ---------------------------------------------------------------------------

describe("fileComplaint — respondent permutations", () => {
  it("stores NULL when no respondent is named ('No one in particular')", async () => {
    const complaint = await grievances.fileComplaint(ctx(OWNER), schemeId, {
      subject: "Gate left unlocked",
      details: "The rear gate is repeatedly left unlocked overnight.",
      approvedForm: true,
    });
    expect(complaint.respondentPersonId).toBeNull();
    expect(complaint.complainantPersonId).toBe(ownerPersonId);
  });

  it("stores the respondent and stamps the 28-day statutory clock", async () => {
    const complaint = await grievances.fileComplaint(ctx(OWNER), schemeId, {
      respondentPersonId: respondentPersonId,
      subject: "Noise after midnight",
      details: "Loud parties on 27 and 28 June.",
      approvedForm: true,
    });
    expect(complaint.respondentPersonId).toBe(respondentPersonId);
    expect(complaint.status).toBe("received");
    // 2026-07-01 + 28 days.
    expect(complaint.meetByDate).toBe("2026-07-29");
  });

  it("rejects a respondent who belongs to another scheme", async () => {
    await expect(
      grievances.fileComplaint(ctx(OWNER), schemeId, {
        respondentPersonId: strangerPersonId,
        subject: "Cross-scheme respondent",
        details: "Should not be accepted.",
        approvedForm: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

// ---------------------------------------------------------------------------
// State machine.
// ---------------------------------------------------------------------------

async function file(subject: string, withRespondent = true) {
  return await grievances.fileComplaint(ctx(OWNER), schemeId, {
    respondentPersonId: withRespondent ? respondentPersonId : undefined,
    subject,
    details: `${subject} — details for the record.`,
    approvedForm: true,
  });
}

describe("advanceComplaint — state-machine permutations", () => {
  it("walks received → under_discussion → notice_to_rectify → resolved and stamps resolvedAt", async () => {
    const complaint = await file("Full walk to resolved");

    const discussed = await grievances.advanceComplaint(ctx(), schemeId, complaint.id, {
      status: "under_discussion",
      note: "Committee met 1 July.",
    });
    expect(discussed.status).toBe("under_discussion");
    expect(discussed.resolvedAt).toBeNull();

    const noticed = await grievances.advanceComplaint(ctx(), schemeId, complaint.id, {
      status: "notice_to_rectify",
    });
    expect(noticed.status).toBe("notice_to_rectify");
    expect(noticed.resolvedAt).toBeNull();

    const resolved = await grievances.advanceComplaint(
      ctx(OFFICER, "2026-07-10T00:00:00Z"),
      schemeId,
      complaint.id,
      { status: "resolved" },
    );
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt?.toISOString()).toBe("2026-07-10T00:00:00.000Z");

    // The audit trail recorded every step in order; the optional note stuck
    // where given and stayed null where omitted.
    const detail = await grievances.getComplaintDetail(ctx(), schemeId, complaint.id);
    expect(detail.events.map((e) => e.kind)).toEqual([
      "filed",
      "discussion",
      "notice_issued",
      "resolved",
    ]);
    expect(detail.events[1]!.note).toBe("Committee met 1 July.");
    expect(detail.events[2]!.note).toBeNull();
  });

  it("allows the VCAT path: under_discussion → vcat → resolved", async () => {
    const complaint = await file("Escalates to VCAT");
    await grievances.advanceComplaint(ctx(), schemeId, complaint.id, {
      status: "under_discussion",
    });
    const vcat = await grievances.advanceComplaint(ctx(), schemeId, complaint.id, {
      status: "vcat",
    });
    expect(vcat.status).toBe("vcat");
    const resolved = await grievances.advanceComplaint(ctx(), schemeId, complaint.id, {
      status: "resolved",
    });
    expect(resolved.status).toBe("resolved");
  });

  it("rejects an illegal jump (received → final_notice) with 409", async () => {
    const complaint = await file("Illegal jump");
    await expect(
      grievances.advanceComplaint(ctx(), schemeId, complaint.id, { status: "final_notice" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
  });

  it("rejects a no-op transition (received → received) with 409", async () => {
    const complaint = await file("No-op transition");
    await expect(
      grievances.advanceComplaint(ctx(), schemeId, complaint.id, { status: "received" }),
    ).rejects.toMatchObject({ code: "NO_CHANGE", status: 409 });
  });

  it("refuses to advance a complaint already closed elsewhere (concurrent close → 4xx)", async () => {
    const complaint = await file("Closed concurrently");
    await grievances.advanceComplaint(ctx(), schemeId, complaint.id, { status: "resolved" });

    // A second officer with a stale sheet picks "under discussion": the UI
    // surfaces this DomainError inline via advance.isError (role=alert).
    const attempt = grievances.advanceComplaint(ctx(), schemeId, complaint.id, {
      status: "under_discussion",
    });
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    await expect(attempt).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
  });

  it("treats withdrawn as terminal", async () => {
    const complaint = await file("Withdrawn is terminal");
    await grievances.advanceComplaint(ctx(), schemeId, complaint.id, { status: "withdrawn" });
    await expect(
      grievances.advanceComplaint(ctx(), schemeId, complaint.id, { status: "resolved" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
  });

  it("404s for a complaint id that isn't in this scheme", async () => {
    const complaint = await file("Wrong scheme lookup");
    await expect(
      grievances.advanceComplaint(ctx(), otherSchemeId, complaint.id, {
        status: "under_discussion",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Breach notices.
// ---------------------------------------------------------------------------

describe("issueBreachNotice / closeBreachNotice — permutations", () => {
  it("issues a notice-to-rectify with a 28-day clock and records it on the complaint trail", async () => {
    const complaint = await file("Breach: notice to rectify");
    const notice = await grievances.issueBreachNotice(ctx(), schemeId, {
      complaintId: complaint.id,
      subjectPersonId: respondentPersonId,
      ruleRef: "Model Rule 4.1",
      type: "notice_to_rectify",
      details: "Cease amplified music after 11pm.",
    });

    expect(notice.status).toBe("issued");
    expect(notice.rectifyByDate).toBe("2026-07-29"); // 2026-07-01 + 28 days
    expect(notice.complaintId).toBe(complaint.id);

    const detail = await grievances.getComplaintDetail(ctx(), schemeId, complaint.id);
    const trail = detail.events.at(-1)!;
    expect(trail.kind).toBe("notice_issued");
    expect(trail.note).toBe("Notice to rectify issued (Model Rule 4.1); 28 days to comply.");
    expect(detail.breachNotices.map((n) => n.id)).toContain(notice.id);
  });

  it("labels a final notice as such on the trail", async () => {
    const complaint = await file("Breach: final notice");
    await grievances.issueBreachNotice(ctx(), schemeId, {
      complaintId: complaint.id,
      subjectPersonId: respondentPersonId,
      ruleRef: "Model Rule 4.1",
      type: "final_notice",
      details: "Final notice after continued breaches.",
    });
    const detail = await grievances.getComplaintDetail(ctx(), schemeId, complaint.id);
    expect(detail.events.at(-1)!.note).toMatch(/^Final notice issued/);
  });

  it("rejects a subject person from another scheme and an unknown complaint", async () => {
    await expect(
      grievances.issueBreachNotice(ctx(), schemeId, {
        subjectPersonId: strangerPersonId,
        ruleRef: "Model Rule 1.1",
        type: "notice_to_rectify",
        details: "Cross-scheme subject.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      grievances.issueBreachNotice(ctx(), schemeId, {
        complaintId: "00000000-0000-4000-8000-00000000dead",
        subjectPersonId: respondentPersonId,
        ruleRef: "Model Rule 1.1",
        type: "notice_to_rectify",
        details: "Unknown complaint.",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    "rectified",
    "escalated",
    "withdrawn",
  ] as const)("closes an issued notice as %s and blocks a second close (409)", async (outcome) => {
    const complaint = await file(`Breach closed ${outcome}`);
    const notice = await grievances.issueBreachNotice(ctx(), schemeId, {
      complaintId: complaint.id,
      subjectPersonId: respondentPersonId,
      ruleRef: "Model Rule 4.1",
      type: "notice_to_rectify",
      details: "Comply within the statutory period.",
    });

    const closed = await grievances.closeBreachNotice(ctx(), schemeId, notice.id, {
      status: outcome,
    });
    expect(closed.status).toBe(outcome);

    // The linked complaint trail records the right audit kind per outcome.
    const detail = await grievances.getComplaintDetail(ctx(), schemeId, complaint.id);
    const expectedKind = { rectified: "rectified", escalated: "escalated", withdrawn: "note" }[
      outcome
    ];
    expect(detail.events.at(-1)!.kind).toBe(expectedKind);

    // Second close (BreachNoticeRow buttons are hidden, but the server is
    // the invariant): 409 NOTICE_CLOSED.
    await expect(
      grievances.closeBreachNotice(ctx(), schemeId, notice.id, { status: "rectified" }),
    ).rejects.toMatchObject({ code: "NOTICE_CLOSED", status: 409 });
  });

  it("appends the officer's note to the close outcome on the trail", async () => {
    const complaint = await file("Breach close with note");
    const notice = await grievances.issueBreachNotice(ctx(), schemeId, {
      complaintId: complaint.id,
      subjectPersonId: respondentPersonId,
      ruleRef: "Model Rule 2.2",
      type: "notice_to_rectify",
      details: "Remove items from common property.",
    });
    await grievances.closeBreachNotice(ctx(), schemeId, notice.id, {
      status: "rectified",
      note: "Inspected 10 July — items removed.",
    });
    const detail = await grievances.getComplaintDetail(ctx(), schemeId, complaint.id);
    expect(detail.events.at(-1)!.note).toBe(
      "Notice to rectify (Model Rule 2.2) marked rectified. Inspected 10 July — items removed.",
    );
  });

  it("404s when closing a notice through the wrong scheme", async () => {
    const complaint = await file("Breach wrong-scheme close");
    const notice = await grievances.issueBreachNotice(ctx(), schemeId, {
      complaintId: complaint.id,
      subjectPersonId: respondentPersonId,
      ruleRef: "Model Rule 3.3",
      type: "notice_to_rectify",
      details: "Wrong-scheme close attempt.",
    });
    await expect(
      grievances.closeBreachNotice(ctx(), otherSchemeId, notice.id, { status: "rectified" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Owner view vs officer register.
// ---------------------------------------------------------------------------

describe("listMyComplaints vs listComplaints — view scoping", () => {
  it("shows an owner only what they lodged; the register shows everything", async () => {
    const mine = await grievances.listMyComplaints(ctx(OWNER), schemeId);
    expect(mine.length).toBeGreaterThan(0);
    // Every complaint in "mine" was lodged by the owner's linked person.
    expect(mine.every((c) => c.complainantPersonId === ownerPersonId)).toBe(true);

    // Seed one lodged on behalf of somebody else: it must NOT appear in "mine".
    const other = await grievances.fileComplaint(ctx(OFFICER), schemeId, {
      complainantPersonId: respondentPersonId,
      subject: "Lodged on Rita's behalf",
      details: "Officer intake for a person with no login.",
      approvedForm: true,
    });
    const mineAfter = await grievances.listMyComplaints(ctx(OWNER), schemeId);
    expect(mineAfter.map((c) => c.id)).not.toContain(other.id);

    const register = await grievances.listComplaints(ctx(OFFICER), schemeId);
    expect(register.map((c) => c.id)).toContain(other.id);
    expect(register.length).toBeGreaterThan(mineAfter.length);
  });

  it("returns an empty list (no error) for a login with no person record", async () => {
    await expect(grievances.listMyComplaints(ctx(UNLINKED), schemeId)).resolves.toEqual([]);
  });

  it("does not leak another scheme's complaints into this register", async () => {
    const register = await grievances.listComplaints(ctx(OFFICER), otherSchemeId);
    expect(register).toEqual([]);
  });
});
