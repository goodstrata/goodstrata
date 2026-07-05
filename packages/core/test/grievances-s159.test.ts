/**
 * s 159 AGM grievance report (OC Act 2006 (Vic)).
 *
 * s 159(1): the OC must report the number and nature of complaints, actions
 * taken, VCAT applications and outcomes to the AGM. s 159(2): "The report
 * must not identify the person who made a complaint or the lot owner or
 * occupier alleged to have committed the breach."
 *
 * The anonymity tests here are the regression guard for s 159(2): they seed
 * complaints and notices whose free text names both parties, then assert that
 * neither party's name, email or person id — nor any of that free text, nor
 * any row id that joins back to them — appears anywhere in the rendered
 * report. The key-set tests lock the report's field surface so a new field
 * cannot be added without consciously updating the allowed list.
 */
import { people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as grievances from "../src/services/grievances.js";
import type { S159Report } from "../src/services/grievances.js";

let tdb: TestDatabase;
let schemeId: string;
let complainantPersonId: string;
let respondentPersonId: string;

const OFFICER = userActor("user-s159-officer");

// Distinctive strings so a leak cannot hide behind a coincidental match with
// legitimate report content (statuses, dates, kinds).
const COMPLAINANT_GIVEN = "Vexana";
const COMPLAINANT_FAMILY = "Quorrelheim";
const COMPLAINANT_EMAIL = "vexana.quorrelheim@example.com";
const RESPONDENT_GIVEN = "Braxwell";
const RESPONDENT_FAMILY = "Ollivandros";
const RESPONDENT_EMAIL = "braxwell.ollivandros@example.com";

const SUBJECT_A = "Braxwell Ollivandros's dog barking at all hours";
const DETAILS_A =
  "Vexana Quorrelheim reports that Braxwell Ollivandros of lot 7 leaves his dog on the balcony overnight.";
const DISCUSSION_NOTE = "Met with Vexana and Braxwell over video on 3 July; no agreement reached.";
const NOTICE_DETAILS = "Braxwell Ollivandros must keep the dog inside between 10pm and 7am.";
const CLOSE_NOTE = "Inspected 10 July — Braxwell has complied; Vexana satisfied.";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

function ctx(at: string, actor: Actor = OFFICER): ServiceContext {
  return { db: tdb.db, clock: fixedClock(at), integrations, actor };
}

/** Seeded ids the leak assertions ban from the rendered report. */
let complaintAId: string;
let complaintBId: string;
let noticeId: string;
let report: S159Report;

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "S159 Report OC",
      planOfSubdivision: "PS159159S",
      addressLine1: "159 Report Rd",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 3,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db
    .insert(users)
    .values({ id: OFFICER.id, name: "Olive Officer", email: "olive.s159@example.com" });
  const personRows = await tdb.db
    .insert(people)
    .values([
      {
        schemeId,
        givenName: COMPLAINANT_GIVEN,
        familyName: COMPLAINANT_FAMILY,
        email: COMPLAINANT_EMAIL,
      },
      {
        schemeId,
        givenName: RESPONDENT_GIVEN,
        familyName: RESPONDENT_FAMILY,
        email: RESPONDENT_EMAIL,
      },
    ])
    .returning();
  complainantPersonId = personRows[0]!.id;
  respondentPersonId = personRows[1]!.id;

  // Complaint A: full walk with identifying free text at every step.
  const complaintA = await grievances.fileComplaint(ctx("2026-07-02T10:00:00Z"), schemeId, {
    complainantPersonId,
    respondentPersonId,
    subject: SUBJECT_A,
    details: DETAILS_A,
    approvedForm: true,
  });
  complaintAId = complaintA.id;
  await grievances.advanceComplaint(ctx("2026-07-03T10:00:00Z"), schemeId, complaintAId, {
    status: "under_discussion",
    note: DISCUSSION_NOTE,
  });
  await grievances.advanceComplaint(ctx("2026-07-04T09:00:00Z"), schemeId, complaintAId, {
    status: "notice_to_rectify",
  });
  const notice = await grievances.issueBreachNotice(ctx("2026-07-04T10:00:00Z"), schemeId, {
    complaintId: complaintAId,
    subjectPersonId: respondentPersonId,
    ruleRef: "Model Rule 4.1",
    type: "notice_to_rectify",
    details: NOTICE_DETAILS,
  });
  noticeId = notice.id;
  await grievances.closeBreachNotice(ctx("2026-07-10T10:00:00Z"), schemeId, noticeId, {
    status: "rectified",
    note: CLOSE_NOTE,
  });
  await grievances.advanceComplaint(ctx("2026-07-15T09:00:00Z"), schemeId, complaintAId, {
    status: "resolved",
  });

  // Complaint B: open, no respondent named.
  const complaintB = await grievances.fileComplaint(ctx("2026-07-03T12:00:00Z"), schemeId, {
    complainantPersonId,
    subject: "Vexana Quorrelheim: broken intercom at the lobby entrance",
    details: "The lobby intercom has been dead for a fortnight.",
    approvedForm: false,
  });
  complaintBId = complaintB.id;

  // Complaint C: outside the July reporting window (excluded from the report).
  await grievances.fileComplaint(ctx("2026-06-01T10:00:00Z"), schemeId, {
    complainantPersonId,
    respondentPersonId,
    subject: "Out-of-window complaint",
    details: "Received in June; belongs to last period's report.",
    approvedForm: true,
  });

  report = await grievances.generateS159Report(ctx("2026-07-20T00:00:00Z"), schemeId, {
    from: "2026-07-01",
    to: "2026-07-19",
  });
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("generateS159Report — s 159(1) contents", () => {
  it("counts complaints in the period by status and outcome", () => {
    expect(report.complaints.total).toBe(2); // June complaint excluded
    expect(report.complaints.resolved).toBe(1);
    expect(report.complaints.unresolved).toBe(1);
    expect(report.complaints.byStatus.resolved).toBe(1);
    expect(report.complaints.byStatus.received).toBe(1);
    expect(report.periodStart).toBe("2026-07-01");
    expect(report.periodEnd).toBe("2026-07-19");
  });

  it("gives each complaint an anonymised timeline: dates, statuses and actions taken", () => {
    const [a, b] = report.complaints.items;
    // Chronological refs: A (2 July) then B (3 July).
    expect(a).toEqual({
      ref: 1,
      receivedOn: "2026-07-02",
      status: "resolved",
      onApprovedForm: true,
      actionsTaken: ["filed", "discussion", "notice_issued", "notice_issued", "rectified", "resolved"],
      resolvedOn: "2026-07-15",
    });
    expect(b).toEqual({
      ref: 2,
      receivedOn: "2026-07-03",
      status: "received",
      onApprovedForm: false,
      actionsTaken: ["filed"],
      resolvedOn: null,
    });
  });

  it("summarises breach notices by type/outcome with the rule cited as the nature", () => {
    expect(report.breachNotices.total).toBe(1);
    expect(report.breachNotices.byType.notice_to_rectify).toBe(1);
    expect(report.breachNotices.byStatus.rectified).toBe(1);
    expect(report.breachNotices.items[0]).toEqual({
      ref: 1,
      complaintRef: 1, // links to Complaint 1 by report-local ref, not row id
      type: "notice_to_rectify",
      ruleRef: "Model Rule 4.1",
      issuedOn: "2026-07-04",
      rectifyByDate: "2026-08-01",
      status: "rectified",
    });
  });

  it("defaults to all-time (June complaint included) when no window is given", async () => {
    const allTime = await grievances.generateS159Report(ctx("2026-07-20T00:00:00Z"), schemeId);
    expect(allTime.complaints.total).toBe(3);
    expect(allTime.periodStart).toBeNull();
    expect(allTime.periodEnd).toBe("2026-07-20");
  });
});

describe("generateS159Report — s 159(2) anonymity", () => {
  it("identifies neither the complainant nor the respondent anywhere in the rendered report", () => {
    // Render exactly as the API does (c.json(...) → JSON.stringify) and ban
    // every string that identifies a party or joins back to one.
    const rendered = JSON.stringify(report).toLowerCase();
    const banned = [
      COMPLAINANT_GIVEN,
      COMPLAINANT_FAMILY,
      COMPLAINANT_EMAIL,
      RESPONDENT_GIVEN,
      RESPONDENT_FAMILY,
      RESPONDENT_EMAIL,
      complainantPersonId,
      respondentPersonId,
      // Row ids resolve to the parties for anyone with register access.
      complaintAId,
      complaintBId,
      noticeId,
      // Officer-written free text names the parties; none of it may appear.
      SUBJECT_A,
      DETAILS_A,
      DISCUSSION_NOTE,
      NOTICE_DETAILS,
      CLOSE_NOTE,
    ];
    for (const s of banned) {
      expect(rendered, `s 159(2) leak: report contains ${JSON.stringify(s)}`).not.toContain(
        s.toLowerCase(),
      );
    }
  });

  it("locks the report's field surface so a leak cannot be reintroduced silently", () => {
    // If a field is added to the report, this test fails until the new field
    // is consciously added to the allowed sets below — review it against
    // s 159(2) before doing so.
    expect(Object.keys(report).sort()).toEqual([
      "breachNotices",
      "complaints",
      "generatedAt",
      "periodEnd",
      "periodStart",
      "schemeId",
    ]);
    expect(Object.keys(report.complaints).sort()).toEqual([
      "byStatus",
      "items",
      "resolved",
      "total",
      "unresolved",
    ]);
    expect(Object.keys(report.breachNotices).sort()).toEqual([
      "byStatus",
      "byType",
      "items",
      "total",
    ]);
    for (const item of report.complaints.items) {
      expect(Object.keys(item).sort()).toEqual([
        "actionsTaken",
        "onApprovedForm",
        "receivedOn",
        "ref",
        "resolvedOn",
        "status",
      ]);
    }
    for (const item of report.breachNotices.items) {
      expect(Object.keys(item).sort()).toEqual([
        "complaintRef",
        "issuedOn",
        "rectifyByDate",
        "ref",
        "ruleRef",
        "status",
        "type",
      ]);
    }
  });
});
