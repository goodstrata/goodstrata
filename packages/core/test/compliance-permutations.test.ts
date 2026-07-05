/**
 * Permutation coverage for the compliance-calendar family (P1-4):
 *
 *   - raiseObligation input boundaries (title length, dueOn format, scope
 *     exclusivity) that back the AddObligationDialog,
 *   - per-kind responsibleRole defaults (the dialog's "Default for the
 *     category" sentinel resolves server-side),
 *   - escalation seeding on raise + idempotent re-raises,
 *   - complete/waive permutations incl. the double-complete 409 the UI
 *     surfaces as toast.error,
 *   - list windows (open/all/overdue/upcoming) that drive the show/hide
 *     completed toggle and the stat cards,
 *   - the daily sweep aging bands exactly once per crossing.
 *
 * Officer-only gating of POST /compliance lives in the API middleware and is
 * covered in apps/api/src/grievances-compliance-permutations.test.ts.
 */
import { schemes } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { type Actor, fixedClock, userActor } from "@goodstrata/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { ServiceContext } from "../src/context.js";
import { DomainError } from "../src/errors.js";
import * as compliance from "../src/services/compliance.js";

let tdb: TestDatabase;
let schemeId: string;
let otherSchemeId: string;

const OFFICER = userActor("user-cp-officer");

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

const NOW = "2026-07-01T00:00:00Z";

function ctx(actor: Actor = OFFICER, at: string = NOW): ServiceContext {
  return { db: tdb.db, clock: fixedClock(at), integrations, actor };
}

/** Raise a minimal manual obligation the way the route does. */
function raise(input: Partial<compliance.RaiseObligationInput> & { subjectRef: string }) {
  return compliance.raiseObligation(ctx(), {
    schemeId,
    kind: "custom",
    title: "Fire panel annual service",
    dueOn: "2026-09-01",
    ...input,
  });
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  const rows = await tdb.db
    .insert(schemes)
    .values([
      {
        name: "Compliance Permutation OC",
        planOfSubdivision: "PS777003P",
        addressLine1: "3 Calendar Ct",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 2,
        status: "active",
      },
      {
        name: "Other Compliance OC",
        planOfSubdivision: "PS777004P",
        addressLine1: "4 Elsewhere St",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 1,
        status: "active",
      },
    ])
    .returning();
  schemeId = rows[0]!.id;
  otherSchemeId = rows[1]!.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

// ---------------------------------------------------------------------------
// Input boundaries.
// ---------------------------------------------------------------------------

describe("raiseObligation — input permutations", () => {
  it("accepts a 200-character title and rejects 201", async () => {
    const ok = await raise({ title: "t".repeat(200), subjectRef: "manual:title-200" });
    expect(ok.title).toHaveLength(200);
    await expect(
      raise({ title: "t".repeat(201), subjectRef: "manual:title-201" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects a non-ISO dueOn (what a raw text input could send)", async () => {
    await expect(raise({ dueOn: "01/09/2026", subjectRef: "manual:bad-date" })).rejects.toThrow(
      /ISO date/,
    );
    await expect(raise({ dueOn: "2026-9-1", subjectRef: "manual:bad-date-2" })).rejects.toThrow(
      /ISO date/,
    );
  });

  it("rejects an impossible calendar date and never persists it", async () => {
    // '2026-13-40' satisfies the \d{4}-\d{2}-\d{2} regex; calendar validity
    // is enforced in raiseObligation, so nothing reaches Postgres. The date
    // PICKER can't send this, but the API can be forced.
    await expect(raise({ dueOn: "2026-13-40", subjectRef: "manual:impossible" })).rejects.toThrow();
    const all = await compliance.listObligations(ctx(), { schemeId, window: "all" });
    expect(all.some((o) => o.subjectRef === "manual:impossible")).toBe(false);
  });

  it("maps an impossible calendar date to a fielded 422", async () => {
    const attempt = raise({ dueOn: "2026-13-40", subjectRef: "manual:impossible-422" });
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    await expect(attempt).rejects.toMatchObject({ status: 422 });
  });

  it("requires exactly one of schemeId / organizationId", async () => {
    await expect(
      compliance.raiseObligation(ctx(), {
        kind: "custom",
        title: "No scope",
        dueOn: "2026-09-01",
        subjectRef: "manual:no-scope",
      }),
    ).rejects.toThrow(/exactly one/i);
    await expect(
      compliance.raiseObligation(ctx(), {
        schemeId,
        organizationId: "00000000-0000-4000-8000-000000000010",
        kind: "custom",
        title: "Two scopes",
        dueOn: "2026-09-01",
        subjectRef: "manual:two-scopes",
      }),
    ).rejects.toThrow(/exactly one/i);
  });
});

// ---------------------------------------------------------------------------
// Defaults and seeding.
// ---------------------------------------------------------------------------

describe("raiseObligation — responsibleRole defaults per kind", () => {
  it.each([
    ["custom", "manager_admin"],
    ["insurance_renewal", "treasurer"],
    ["agm_due", "secretary"],
    ["esm_inspection", "manager_admin"],
  ] as const)("kind=%s defaults to %s when the dialog sends 'default'", async (kind, role) => {
    // The route maps the dialog's 'default' sentinel to undefined.
    const ob = await raise({ kind, subjectRef: `manual:role-${kind}` });
    expect(ob.responsibleRole).toBe(role);
  });

  it("honours an explicit responsibleRole over the per-kind default", async () => {
    const ob = await raise({
      kind: "insurance_renewal",
      responsibleRole: "chair",
      subjectRef: "manual:role-explicit",
    });
    expect(ob.responsibleRole).toBe("chair");
  });
});

describe("raiseObligation — escalation seeding and idempotency", () => {
  it("seeds status/escalation from the gap to dueOn", async () => {
    const overdue = await raise({ dueOn: "2026-06-30", subjectRef: "manual:seed-overdue" });
    expect(overdue).toMatchObject({ status: "overdue", escalationState: "overdue" });

    const dueToday = await raise({ dueOn: "2026-07-01", subjectRef: "manual:seed-due" });
    expect(dueToday).toMatchObject({ status: "due", escalationState: "due" });

    const soon = await raise({ dueOn: "2026-07-08", subjectRef: "manual:seed-t30" });
    expect(soon).toMatchObject({ status: "upcoming", escalationState: "t_30" });

    const far = await raise({ dueOn: "2027-06-30", subjectRef: "manual:seed-none" });
    expect(far).toMatchObject({ status: "upcoming", escalationState: "none" });
  });

  it("re-raising the same (kind, subjectRef, period) returns the existing row", async () => {
    const first = await raise({ subjectRef: "manual:dedupe", periodKey: "2026-09-01" });
    const second = await raise({
      subjectRef: "manual:dedupe",
      periodKey: "2026-09-01",
      title: "Different title, same identity",
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe(first.title); // the original row wins

    // A different period is a genuinely new obligation.
    const nextPeriod = await raise({ subjectRef: "manual:dedupe", periodKey: "2027-09-01" });
    expect(nextPeriod.id).not.toBe(first.id);
  });
});

// ---------------------------------------------------------------------------
// Complete / waive.
// ---------------------------------------------------------------------------

describe("completeObligation — permutations", () => {
  it("marks done, stamping completedAt and the acting officer", async () => {
    const ob = await raise({ subjectRef: "manual:complete-done" });
    const done = await compliance.completeObligation(
      ctx(OFFICER, "2026-07-02T03:04:05Z"),
      ob.id,
      {},
    );
    expect(done.status).toBe("done");
    expect(done.completedAt?.toISOString()).toBe("2026-07-02T03:04:05.000Z");
    expect(done.completedBy).toEqual({ kind: "user", id: OFFICER.id });
  });

  it("waives instead when waived:true", async () => {
    const ob = await raise({ subjectRef: "manual:complete-waive" });
    const waived = await compliance.completeObligation(ctx(), ob.id, { waived: true });
    expect(waived.status).toBe("waived");
  });

  it("rejects a second completion with 409 ALREADY_CLOSED (UI shows toast.error)", async () => {
    const ob = await raise({ subjectRef: "manual:complete-twice" });
    await compliance.completeObligation(ctx(), ob.id, {});
    const again = compliance.completeObligation(ctx(), ob.id, { waived: true });
    await expect(again).rejects.toBeInstanceOf(DomainError);
    await expect(again).rejects.toMatchObject({ code: "ALREADY_CLOSED", status: 409 });
  });

  it("404s for an unknown obligation", async () => {
    await expect(
      compliance.completeObligation(ctx(), "00000000-0000-4000-8000-00000000dead", {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

// ---------------------------------------------------------------------------
// Windows (show/hide completed) and stat recompute.
// ---------------------------------------------------------------------------

describe("listObligations — window permutations", () => {
  it("open hides closed rows, all shows them, overdue/upcoming slice by status", async () => {
    // Fresh scheme-scoped fixture set on the OTHER scheme so earlier tests
    // don't disturb the counts.
    const mk = (subjectRef: string, dueOn: string) =>
      compliance.raiseObligation(ctx(), {
        schemeId: otherSchemeId,
        kind: "custom",
        title: subjectRef,
        dueOn,
        subjectRef,
      });
    const overdueOb = await mk("w:overdue", "2026-06-01");
    const dueOb = await mk("w:due", "2026-07-01");
    const upcomingOb = await mk("w:upcoming", "2026-07-20");
    const doneOb = await mk("w:done", "2026-08-01");
    await compliance.completeObligation(ctx(), doneOb.id, {});
    const waivedOb = await mk("w:waived", "2026-08-02");
    await compliance.completeObligation(ctx(), waivedOb.id, { waived: true });

    const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

    const open = await compliance.listObligations(ctx(), {
      schemeId: otherSchemeId,
      window: "open",
    });
    expect(ids(open).sort()).toEqual([overdueOb.id, dueOb.id, upcomingOb.id].sort());

    const all = await compliance.listObligations(ctx(), {
      schemeId: otherSchemeId,
      window: "all",
    });
    expect(ids(all).sort()).toEqual(
      [overdueOb.id, dueOb.id, upcomingOb.id, doneOb.id, waivedOb.id].sort(),
    );

    const overdueOnly = await compliance.listObligations(ctx(), {
      schemeId: otherSchemeId,
      window: "overdue",
    });
    expect(ids(overdueOnly)).toEqual([overdueOb.id]);

    const upcoming = await compliance.listObligations(ctx(), {
      schemeId: otherSchemeId,
      window: "upcoming",
    });
    expect(ids(upcoming).sort()).toEqual([dueOb.id, upcomingOb.id].sort());

    // Stat recompute after a mutation: completing the overdue obligation must
    // drop it from the open window (the tab's Overdue stat card recounts).
    await compliance.completeObligation(ctx(), overdueOb.id, {});
    const openAfter = await compliance.listObligations(ctx(), {
      schemeId: otherSchemeId,
      window: "open",
    });
    expect(ids(openAfter)).not.toContain(overdueOb.id);
    expect(openAfter.filter((o) => o.escalationState === "overdue")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Sweep.
// ---------------------------------------------------------------------------

describe("sweep — band crossings age exactly once", () => {
  it("ages an obligation into 'due' and re-fires nothing on the second run", async () => {
    const ob = await raise({ dueOn: "2026-07-10", subjectRef: "manual:sweep" });
    expect(ob.escalationState).toBe("t_30");

    const first = await compliance.sweep(ctx(OFFICER, "2026-07-10T09:00:00Z"), { schemeId });
    expect(first.updated).toBeGreaterThanOrEqual(1);

    const aged = await compliance.getObligation(ctx(), ob.id);
    expect(aged).toMatchObject({ status: "due", escalationState: "due" });

    // Same clock, second run: idempotent — nothing changes, nothing notifies.
    const second = await compliance.sweep(ctx(OFFICER, "2026-07-10T09:00:00Z"), { schemeId });
    expect(second.updated).toBe(0);
    expect(second.notified).toBe(0);
  });
});
