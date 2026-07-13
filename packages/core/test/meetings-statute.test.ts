import { funds, lots, ownerships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv, mockPaymentsProvider } from "@goodstrata/integrations";
import { type Actor, fixedClock, systemActor } from "@goodstrata/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServiceContext } from "../src/context.js";
import * as budgetsService from "../src/services/budgets.js";
import * as committeeService from "../src/services/committee.js";
import * as documentsService from "../src/services/documents.js";
import * as leviesService from "../src/services/levies.js";
import * as meetingsService from "../src/services/meetings.js";
import * as paymentsService from "../src/services/payments.js";

/**
 * Statutory-alignment coverage for the meetings service against the current
 * authorised Owners Corporations Act 2006 (Vic) (v023): the s 89(3)–(5) poll
 * window, s 89B(3)/s 89C(10) arrears bars, ss 78/97 interim resolutions,
 * ss 89C–89D proxy controls, s 72(2) AGM notice content and ss 85/86(2)(a)
 * circular-resolution safeguards. See docs/legal/statute-map.md §5.
 */

let tdb: TestDatabase;

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

const NOW = "2026-07-08T00:00:00Z";
function ctxAt(iso: string, actor: Actor = systemActor("test")): ServiceContext {
  return { db: tdb.db, clock: fixedClock(iso), integrations, actor };
}
const ctx = () => ctxAt(NOW);

let schemeSeq = 0;
/** Seed a scheme with lots, owners and (per spec) the admin/maintenance funds. */
async function seedScheme(
  name: string,
  specs: readonly (readonly [string, number, string])[],
): Promise<{
  schemeId: string;
  lotByNumber: Map<string, string>;
  personByName: Map<string, string>;
}> {
  schemeSeq += 1;
  const rows = await tdb.db
    .insert(schemes)
    .values({
      name,
      planOfSubdivision: `PS90${String(schemeSeq).padStart(4, "0")}X`,
      addressLine1: `${schemeSeq} Statute St`,
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  const schemeId = rows[0]!.id;
  await tdb.db.insert(funds).values([
    { schemeId, kind: "admin", name: "Admin" },
    { schemeId, kind: "maintenance", name: "Maintenance" },
  ]);

  const lotByNumber = new Map<string, string>();
  const personByName = new Map<string, string>();
  for (const [num, ent, person] of specs) {
    const lotRows = await tdb.db
      .insert(lots)
      .values({ schemeId, lotNumber: num, entitlement: ent, liability: ent })
      .returning();
    lotByNumber.set(num, lotRows[0]!.id);
    if (!personByName.has(person)) {
      const personRows = await tdb.db
        .insert(people)
        .values({
          schemeId,
          givenName: person,
          email: `${person.toLowerCase()}-${schemeSeq}@ex.com`,
        })
        .returning();
      personByName.set(person, personRows[0]!.id);
    }
    await tdb.db.insert(ownerships).values({
      schemeId,
      lotId: lotRows[0]!.id,
      personId: personByName.get(person)!,
      startedOn: "2020-01-01",
    });
  }
  return { schemeId, lotByNumber, personByName };
}

/** Adopt a budget and issue one overdue annual levy run, putting every lot in arrears. */
async function issueOverdueLevies(schemeId: string) {
  const ctxPast = ctxAt("2026-01-01T00:00:00Z");
  const budget = await budgetsService.createBudget(ctxPast, schemeId, {
    fiscalYearStart: "2026-01-01",
    adminCents: 500_000,
    maintenanceCents: 0,
  });
  const meeting = await meetingsService.createMeeting(ctxPast, schemeId, {
    kind: "sgm",
    title: "Annual fees SGM",
    scheduledAt: "2026-01-01T00:00:00Z",
    agenda: [],
  });
  const motion = await meetingsService.addMotion(ctxPast, schemeId, {
    meetingId: meeting.id,
    title: "Adopt annual budget",
    text: "That the owners corporation adopts the annual budget and fees.",
    resolutionType: "ordinary",
  });
  const currentOwnerships = await tdb.db.query.ownerships.findMany({
    where: (table, { and, eq, isNull }) => and(eq(table.schemeId, schemeId), isNull(table.endedOn)),
  });
  for (const owner of currentOwnerships) {
    await meetingsService.recordAttendance(ctxPast, schemeId, meeting.id, owner.personId, "online");
  }
  await meetingsService.openMotion(ctxPast, schemeId, motion.id);
  for (const owner of currentOwnerships) {
    await meetingsService.castVote(ctxPast, schemeId, owner.personId, {
      motionId: motion.id,
      lotId: owner.lotId,
      choice: "for",
    });
  }
  await meetingsService.closeMotion(ctxPast, schemeId, motion.id);
  await budgetsService.adoptBudget(ctxPast, schemeId, budget.id, motion.id);
  const schedule = await leviesService.createLevySchedule(ctxPast, schemeId, {
    budgetId: budget.id,
    frequency: "annual",
    firstDueOn: "2026-02-01",
  });
  await leviesService.issueLevyRun(ctxPast, schemeId, schedule.id, 1);
  return budget;
}

/** Pay a lot's outstanding notice in full via the mock rail, at `paidAt`. */
async function payLotInFull(schemeId: string, lotId: string, paidAt: string) {
  const notices = await leviesService.listNotices(ctxAt(NOW), schemeId);
  const notice = notices.find((n) => n.lotId === lotId)!;
  const provider = integrations.payments;
  const body = provider.buildWebhookBody({
    payid: notice.payid!,
    amountCents: notice.totalCents,
    paidAt,
    payerName: "owner",
  });
  await paymentsService.recordInboundPayment(ctxAt(NOW), "mock", provider.parseWebhook(body));
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

// ---------------------------------------------------------------------------
// s 89(3)–(5): the poll demand window (before OR after the vote)
// ---------------------------------------------------------------------------
describe("poll window (s 89(3)–(5))", () => {
  it("a poll demanded AFTER the vote at a general meeting displaces the declared result (s 89(5))", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Poll displace OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Bike rack SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    // Make the meeting quorate so the ordinary outcome is final (not interim).
    for (const p of ["Ada", "Bo", "Cy"]) {
      await meetingsService.recordAttendance(
        ctx(),
        schemeId,
        meeting.id,
        personByName.get(p)!,
        "online",
      );
    }
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Install a bike rack",
      text: "That the OC installs a bike rack.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);
    // Big lot against; two small lots for. Headcount carries it 2–1.
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Ada")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("1")!,
      choice: "against",
    });
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Bo")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("2")!,
      choice: "for",
    });
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Cy")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("3")!,
      choice: "for",
    });
    const declared = await meetingsService.closeMotion(ctx(), schemeId, motion.id);
    expect(declared).toMatchObject({ carried: true, basis: "headcount", interim: false });

    // Poll demanded after the vote — re-tally by entitlement: 20 for v 30 against.
    const res = await meetingsService.demandPoll(
      ctx(),
      schemeId,
      personByName.get("Ada")!,
      motion.id,
    );
    expect(res.displaced).toBe(true);
    expect(res.result).toMatchObject({
      carried: false,
      basis: "entitlement",
      pollDemanded: true,
      forWeight: 20,
      againstWeight: 30,
    });
    const row = await tdb.db.query.motions.findFirst({ where: (t, { eq }) => eq(t.id, motion.id) });
    expect(row!.status).toBe("lost");
    expect(row!.pollDemanded).toBe(true);
    expect((row!.result as { basis: string }).basis).toBe("entitlement");
  });

  it("a poll cannot be demanded once the meeting has closed (s 89(3) window)", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Poll window OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Window SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    for (const p of ["Ada", "Bo", "Cy"]) {
      await meetingsService.recordAttendance(
        ctx(),
        schemeId,
        meeting.id,
        personByName.get(p)!,
        "online",
      );
    }
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "A thing",
      text: "That the OC does a thing.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Bo")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("2")!,
      choice: "for",
    });
    await meetingsService.closeMotion(ctx(), schemeId, motion.id);
    await meetingsService.appointMeetingChair(ctx(), schemeId, meeting.id, {
      personId: personByName.get("Ada")!,
      aiAssistanceAuthorized: false,
    });
    await meetingsService.closeMeeting(ctx(), schemeId, meeting.id);
    await expect(
      meetingsService.demandPoll(ctx(), schemeId, personByName.get("Ada")!, motion.id),
    ).rejects.toMatchObject({ code: "BAD_STATUS", status: 409 });
  });
});

// ---------------------------------------------------------------------------
// ss 78/97: interim resolutions + ripening
// ---------------------------------------------------------------------------
describe("interim resolutions (ss 78, 97)", () => {
  async function inquorateOrdinaryPassed() {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Interim OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Inquorate SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    // No attendance recorded → inquorate.
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Repaint",
      text: "That the OC repaints the foyer.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Bo")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("2")!,
      choice: "for",
    });
    const tally = await meetingsService.closeMotion(ctx(), schemeId, motion.id);
    return { schemeId, personByName, motionId: motion.id, tally };
  }

  it("s 78: an ordinary resolution passed at an inquorate general meeting is INTERIM and ripens after 29 days", async () => {
    const { schemeId, motionId, tally } = await inquorateOrdinaryPassed();
    expect(tally).toMatchObject({
      carried: true,
      interim: true,
      interimKind: "interim_ordinary",
    });
    const row = await tdb.db.query.motions.findFirst({ where: (t, { eq }) => eq(t.id, motionId) });
    expect(row!.status).toBe("carried");
    expect((row!.result as { interim: boolean; ripensOn: string }).interim).toBe(true);

    // Too early to ripen (closed at NOW, ripens ~29 days on).
    await expect(
      meetingsService.ripenInterimResolution(ctx(), schemeId, motionId),
    ).rejects.toMatchObject({ code: "NOT_YET_RIPE", status: 409 });

    const later = ctxAt("2026-08-10T00:00:00Z");
    const ripened = await meetingsService.ripenInterimResolution(later, schemeId, motionId);
    expect(ripened).toEqual({ ripened: true, outcome: "final" });
    const finalRow = await tdb.db.query.motions.findFirst({
      where: (t, { eq }) => eq(t.id, motionId),
    });
    expect(finalRow!.status).toBe("carried");
    expect((finalRow!.result as { interim: boolean; ripenedAt: string }).interim).toBe(false);
    expect((finalRow!.result as { ripenedAt: string }).ripenedAt).toBeTruthy();
  });

  it("a challenge before ripening sets the interim resolution aside (s 78(4))", async () => {
    const { schemeId, personByName, motionId } = await inquorateOrdinaryPassed();
    const challenge = await meetingsService.challengeInterimResolution(
      ctx(),
      schemeId,
      personByName.get("Ada")!,
      motionId,
    );
    expect(challenge).toEqual({ challenged: true });

    const later = ctxAt("2026-08-10T00:00:00Z");
    const outcome = await meetingsService.ripenInterimResolution(later, schemeId, motionId);
    expect(outcome).toEqual({ ripened: false, outcome: "challenged" });
    const row = await tdb.db.query.motions.findFirst({ where: (t, { eq }) => eq(t.id, motionId) });
    expect(row!.status).toBe("lost");
    expect((row!.result as { interim: boolean }).interim).toBe(false);
  });

  it("ripening a non-interim (final) motion is rejected", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Final OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
    ]);
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Quorate SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    for (const p of ["Ada", "Bo"]) {
      await meetingsService.recordAttendance(
        ctx(),
        schemeId,
        meeting.id,
        personByName.get(p)!,
        "online",
      );
    }
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Final thing",
      text: "That the OC does the final thing.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Ada")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("1")!,
      choice: "for",
    });
    await meetingsService.closeMotion(ctx(), schemeId, motion.id); // quorate → final
    await expect(
      meetingsService.ripenInterimResolution(ctx(), schemeId, motion.id),
    ).rejects.toMatchObject({ code: "NOT_INTERIM", status: 409 });
  });
});

// ---------------------------------------------------------------------------
// ss 85/86(2)(a): circular resolutions (written ballots)
// ---------------------------------------------------------------------------
describe("circular resolutions (ss 85, 86)", () => {
  it("s 85: a circular ballot cannot be closed before its 14-day notice period", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Circular period OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      // no meetingId → circular / written ballot
      title: "Circular thing",
      text: "That the OC resolves the circular thing.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id); // opensAt = NOW
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Ada")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("1")!,
      choice: "for",
    });
    await expect(meetingsService.closeMotion(ctx(), schemeId, motion.id)).rejects.toMatchObject({
      code: "BALLOT_OPEN",
      status: 409,
    });
    // After 14 days it can close; the single big lot (30/50) clears the s 77 floor.
    const later = ctxAt("2026-07-24T00:00:00Z");
    const tally = await meetingsService.closeMotion(later, schemeId, motion.id);
    expect(tally.carried).toBe(true);
    expect(tally.belowQuorumFloor).toBe(false);
  });

  it("s 86(2)(a): a circular ordinary resolution below the returned-votes quorum floor is lost", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Circular floor OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      title: "Under-floor thing",
      text: "That the OC resolves the under-floor thing.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);
    // Only one small lot returns a vote: 10/50 entitlement, 1/3 lots — below floor.
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Cy")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("3")!,
      choice: "for",
    });
    const later = ctxAt("2026-07-24T00:00:00Z");
    const tally = await meetingsService.closeMotion(later, schemeId, motion.id);
    // A majority of returned votes said "for", but the return did not reach quorum.
    expect(tally.carried).toBe(false);
    expect(tally.belowQuorumFloor).toBe(true);
    const row = await tdb.db.query.motions.findFirst({ where: (t, { eq }) => eq(t.id, motion.id) });
    expect(row!.status).toBe("lost");
  });
});

// ---------------------------------------------------------------------------
// ss 89C–89D: proxy controls
// ---------------------------------------------------------------------------
describe("proxy controls (ss 89C, 89D)", () => {
  it("s 89C(6): expiry beyond 12 months is rejected; an omitted expiry defaults to the 12-month lapse", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Proxy lapse OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
    ]);
    await expect(
      meetingsService.submitProxy(ctx(), schemeId, personByName.get("Ada")!, {
        lotId: lotByNumber.get("1")!,
        proxyPersonId: personByName.get("Bo")!,
        expiresOn: "2028-01-01", // > 12 months from NOW
      }),
    ).rejects.toMatchObject({ code: "PROXY_LAPSE", status: 422 });

    const proxy = await meetingsService.submitProxy(ctx(), schemeId, personByName.get("Ada")!, {
      lotId: lotByNumber.get("1")!,
      proxyPersonId: personByName.get("Bo")!,
    });
    expect(proxy.expiresOn).toBe("2027-07-08"); // NOW + 12 months
  });

  it("s 89D: a person cannot hold proxies for more than the cap (1 in a ≤20-lot scheme)", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Proxy cap OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Cap SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    // Ada proxies lot 1 to Cy for the meeting.
    await meetingsService.submitProxy(ctx(), schemeId, personByName.get("Ada")!, {
      lotId: lotByNumber.get("1")!,
      proxyPersonId: personByName.get("Cy")!,
      meetingId: meeting.id,
    });
    // Bo tries to add a SECOND lot to Cy for the same meeting → over the cap.
    await expect(
      meetingsService.submitProxy(ctx(), schemeId, personByName.get("Bo")!, {
        lotId: lotByNumber.get("2")!,
        proxyPersonId: personByName.get("Cy")!,
        meetingId: meeting.id,
      }),
    ).rejects.toMatchObject({ code: "PROXY_CAP", status: 422 });
  });

  it("s 89C(7): a non-owner proxy cannot vote on a manager-appointment motion, but an owner-proxy can", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Manager vote OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    // Rex is a scheme member with no lot (a pure proxy holder).
    const rex = await tdb.db
      .insert(people)
      .values({ schemeId, givenName: "Rex", email: `rex-${schemeSeq}@ex.com` })
      .returning();
    personByName.set("Rex", rex[0]!.id);

    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Manager SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Appoint a manager",
      text: "That the OC appoints Acme Strata as manager.",
      resolutionType: "ordinary",
      managerAppointment: true,
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);

    // Ada proxies lot 1 to Rex (a non-owner) — barred from the manager vote.
    await meetingsService.submitProxy(ctx(), schemeId, personByName.get("Ada")!, {
      lotId: lotByNumber.get("1")!,
      proxyPersonId: personByName.get("Rex")!,
      meetingId: meeting.id,
    });
    await expect(
      meetingsService.castVote(ctx(), schemeId, personByName.get("Rex")!, {
        motionId: motion.id,
        lotId: lotByNumber.get("1")!,
        choice: "for",
      }),
    ).rejects.toMatchObject({ code: "S89C7_INELIGIBLE", status: 403 });

    // Bo proxies lot 2 to Cy, who IS a lot owner — permitted.
    await meetingsService.submitProxy(ctx(), schemeId, personByName.get("Bo")!, {
      lotId: lotByNumber.get("2")!,
      proxyPersonId: personByName.get("Cy")!,
      meetingId: meeting.id,
    });
    const vote = await meetingsService.castVote(ctx(), schemeId, personByName.get("Cy")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("2")!,
      choice: "for",
    });
    expect(vote.viaProxyId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// s 72(2): AGM notice content
// ---------------------------------------------------------------------------
describe("AGM notice content (s 72(2))", () => {
  it("includes special-resolution text, the proposed budget line and the s 159 report summary", async () => {
    const { schemeId } = await seedScheme("Notice OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
    ]);
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "agm",
      title: "2026 AGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [{ title: "Financial statements" }],
    });
    await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Amend the rules",
      text: "That the OC adopts amended rules under s 96.",
      resolutionType: "special",
    });

    memoryEmail.sent.length = 0;
    const result = await meetingsService.sendMeetingNotice(ctx(), schemeId, meeting.id);
    expect(result.recipients).toBe(2);
    // Table headings are uppercased by the email layout — match case-insensitively.
    const body = memoryEmail.sent[0]!.text.toLowerCase();
    expect(body).toContain("special/unanimous resolutions to be moved");
    expect(body).toContain("amend the rules");
    expect(body).toContain("proposed annual budget"); // table title or "to be tabled" fallback
    expect(body).toContain("grievance report (s 159)");
  });
});

// ---------------------------------------------------------------------------
// s 89B(3) / s 89C(10): arrears bars with cleared-funds timing
// ---------------------------------------------------------------------------
describe("arrears eligibility — cleared funds (s 89B(3))", () => {
  it("a payment made <4 business days before the vote does NOT re-enfranchise; a cleared one does", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Cleared funds OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    await issueOverdueLevies(schemeId);
    // Bo pays yesterday (uncleared); Cy paid two weeks ago (cleared). Both notices
    // are paid in full, so neither lot shows as live arrears — only the s 89B(3)
    // clearing timer separates them.
    await payLotInFull(schemeId, lotByNumber.get("2")!, "2026-07-07T00:00:00Z");
    await payLotInFull(schemeId, lotByNumber.get("3")!, "2026-06-25T00:00:00Z");

    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Cleared funds SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Ordinary matter",
      text: "That the OC resolves an ordinary matter.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);

    // Bo's same-week electronic payment has not cleared → still barred.
    await expect(
      meetingsService.castVote(ctx(), schemeId, personByName.get("Bo")!, {
        motionId: motion.id,
        lotId: lotByNumber.get("2")!,
        choice: "for",
      }),
    ).rejects.toMatchObject({ code: "S89B_INELIGIBLE", status: 403 });

    // Cy's cleared payment re-enfranchises the lot.
    const vote = await meetingsService.castVote(ctx(), schemeId, personByName.get("Cy")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("3")!,
      choice: "for",
    });
    expect(vote.choice).toBe("for");
  });
});

describe("arrears eligibility — proxy bar (s 89C(10))", () => {
  it("an owner in arrears cannot vote AS PROXY for another (eligible) lot", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Proxy arrears OC", [
      ["1", 30, "Ada"],
      ["2", 10, "Bo"],
    ]);
    await issueOverdueLevies(schemeId);
    // Bo clears their own lot long ago; Ada never pays and stays in arrears.
    await payLotInFull(schemeId, lotByNumber.get("2")!, "2026-03-01T00:00:00Z");

    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Proxy arrears SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Ordinary matter",
      text: "That the OC resolves an ordinary matter.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);

    // Bo (lot 2, cleared) appoints Ada (in arrears on lot 1) as proxy for lot 2.
    await meetingsService.submitProxy(ctx(), schemeId, personByName.get("Bo")!, {
      lotId: lotByNumber.get("2")!,
      proxyPersonId: personByName.get("Ada")!,
      meetingId: meeting.id,
    });
    // Ada is barred from voting as proxy (s 89C(10)) even though lot 2 is eligible.
    await expect(
      meetingsService.castVote(ctx(), schemeId, personByName.get("Ada")!, {
        motionId: motion.id,
        lotId: lotByNumber.get("2")!,
        choice: "for",
      }),
    ).rejects.toMatchObject({ code: "S89C10_INELIGIBLE", status: 403 });

    // Bo, the owner, can still vote lot 2 directly — proving lot 2 itself is eligible.
    const vote = await meetingsService.castVote(ctx(), schemeId, personByName.get("Bo")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("2")!,
      choice: "for",
    });
    expect(vote.choice).toBe("for");
  });
});

// ---------------------------------------------------------------------------
// ss 79/89A and powers of attorney: human chair + casting vote + representation
// ---------------------------------------------------------------------------
describe("human chair and casting vote (ss 79, 89A)", () => {
  it("records a human owner as chair and lets only that chair break an equal vote", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Casting vote OC", [
      ["1", 50, "Ada"],
      ["2", 50, "Bo"],
    ]);
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Casting vote SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    await meetingsService.appointMeetingChair(ctx(), schemeId, meeting.id, {
      personId: personByName.get("Ada")!,
      aiAssistanceAuthorized: true,
    });
    for (const person of ["Ada", "Bo"]) {
      await meetingsService.recordAttendance(
        ctx(),
        schemeId,
        meeting.id,
        personByName.get(person)!,
        "online",
      );
    }
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Equal motion",
      text: "That the OC resolves an equally divided matter.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Ada")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("1")!,
      choice: "for",
    });
    await meetingsService.castVote(ctx(), schemeId, personByName.get("Bo")!, {
      motionId: motion.id,
      lotId: lotByNumber.get("2")!,
      choice: "against",
    });
    expect(await meetingsService.closeMotion(ctx(), schemeId, motion.id)).toMatchObject({
      carried: false,
      forCount: 1,
      againstCount: 1,
    });
    await expect(
      meetingsService.exerciseCastingVote(ctx(), schemeId, personByName.get("Bo")!, motion.id, {
        choice: "for",
      }),
    ).rejects.toMatchObject({ code: "NOT_MEETING_CHAIR", status: 403 });
    expect(
      await meetingsService.exerciseCastingVote(
        ctx(),
        schemeId,
        personByName.get("Ada")!,
        motion.id,
        { choice: "for" },
      ),
    ).toMatchObject({ carried: true, interim: false });
  });
});

describe("powers of attorney", () => {
  it("requires a retained instrument and counts a current attorney for quorum and voting", async () => {
    const { schemeId, lotByNumber, personByName } = await seedScheme("Attorney OC", [
      ["1", 60, "Ada"],
      ["2", 20, "Bo"],
      ["3", 20, "Cy"],
    ]);
    const rex = await tdb.db
      .insert(people)
      .values({ schemeId, givenName: "Rex", email: `attorney-${schemeSeq}@ex.com` })
      .returning();
    const instrument = await documentsService.uploadDocument(ctx(), schemeId, {
      filename: "power-of-attorney.pdf",
      contentType: "application/pdf",
      content: new TextEncoder().encode("%PDF signed instrument"),
      category: "other",
      accessLevel: "committee",
    });
    const appointment = await meetingsService.submitPowerOfAttorney(
      ctx(),
      schemeId,
      personByName.get("Ada")!,
      {
        lotId: lotByNumber.get("1")!,
        attorneyPersonId: rex[0]!.id,
        startsOn: "2026-01-01",
        documentId: instrument.id,
      },
    );
    expect(appointment.documentId).toBe(instrument.id);

    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "sgm",
      title: "Attorney SGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    await meetingsService.recordAttendance(ctx(), schemeId, meeting.id, rex[0]!.id, "online");
    expect(await meetingsService.quorumStatus(ctx(), schemeId, meeting.id)).toMatchObject({
      representedLotCount: 1,
      representedEntitlement: 60,
      quorate: true,
      quorumBasis: "entitlement",
    });
    const motion = await meetingsService.addMotion(ctx(), schemeId, {
      meetingId: meeting.id,
      title: "Attorney vote",
      text: "That the attorney cast the donor lot vote.",
      resolutionType: "ordinary",
    });
    await meetingsService.openMotion(ctx(), schemeId, motion.id);
    const vote = await meetingsService.castVote(ctx(), schemeId, rex[0]!.id, {
      motionId: motion.id,
      lotId: lotByNumber.get("1")!,
      choice: "for",
    });
    expect(vote.viaPowerOfAttorneyId).toBe(appointment.id);
    expect(vote.viaProxyId).toBeNull();
  });
});

describe("AGM committee election", () => {
  it("replaces the committee with 3–7 owners elected at an issued AGM", async () => {
    const { schemeId, personByName } = await seedScheme("Election OC", [
      ["1", 10, "Ada"],
      ["2", 10, "Bo"],
      ["3", 10, "Cy"],
    ]);
    const electedUserIds: string[] = [];
    for (const name of ["Ada", "Bo", "Cy"]) {
      const userId = `elected-${name.toLowerCase()}-${schemeSeq}`;
      await tdb.db.insert(users).values({
        id: userId,
        name,
        email: `${userId}@example.com`,
      });
      await tdb.db
        .update(people)
        .set({ userId })
        .where(eq(people.id, personByName.get(name)!));
      electedUserIds.push(userId);
    }
    const meeting = await meetingsService.createMeeting(ctx(), schemeId, {
      kind: "agm",
      title: "Election AGM",
      scheduledAt: "2026-08-01T09:00:00Z",
      agenda: [],
    });
    await meetingsService.sendMeetingNotice(ctx(), schemeId, meeting.id);

    const election = await committeeService.recordCommitteeElection(ctx(), schemeId, {
      meetingId: meeting.id,
      electedUserIds,
    });
    expect(election.electedUserIds).toEqual(electedUserIds);
    const committee = await committeeService.listCommittee(ctx(), schemeId);
    expect(committee).toHaveLength(3);
    expect(committee.map((member) => member.userId).sort()).toEqual([...electedUserIds].sort());
    expect(committee.every((member) => member.role === "committee_member")).toBe(true);
  });
});
