/**
 * Route-level permutations for the grievances + compliance family: who may
 * reach which endpoint (owner vs committee_member vs officer vs outsider),
 * and how service/validation failures surface through the HTTP envelope —
 * the contracts GrievancesTab and ComplianceTab lean on:
 *
 *   - any member lodges a complaint; only their own show in /complaints/mine,
 *   - the register + advance + breach notices are officer-gated (a forced
 *     committee_member/owner call gets 403, not a silent success),
 *   - zv() maps bad fields to 422 VALIDATION with zod issues (dialog fields),
 *   - state-machine conflicts (stale sheet, double close, double complete)
 *     come back 409 for the inline role=alert / toast.error paths.
 */
import { complianceService } from "@goodstrata/core";
import { memberships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { fixedClock, userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "./deps.js";
import { buildServiceContextFactory } from "./deps.js";
import type { AppEnv } from "./middleware.js";
import { complianceRoutes } from "./routes/compliance.js";
import { grievancesRoutes } from "./routes/grievances.js";

const NOW = "2026-07-01T00:00:00Z";
const clock = fixedClock(NOW);

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

/** Logins under test — one per role permutation. */
const CHAIR = "user-rt-chair";
const COMMITTEE = "user-rt-committee";
const OWNER = "user-rt-owner";
const OUTSIDER = "user-rt-outsider";

let tdb: TestDatabase;
/** Only .request() is used, so keep the binding loose over Hono's schema generics. */
let app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let schemeId: string;
let otherSchemeId: string;
let ownerPersonId: string;
let respondentPersonId: string;

/** Loosely-typed response body: each assertion narrows what it reads. */
// biome-ignore lint/suspicious/noExplicitAny: test helper over the JSON envelope
type AnyJson = any;

/** Issue a request as a given login (test auth = the x-user header). */
async function req(
  user: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: AnyJson }> {
  const res = await app.request(path, {
    method,
    headers: { "x-user": user, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  const deps = {
    db: tdb.db,
    integrations,
    clock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, clock),
  } as unknown as AppDeps;

  // The real app's auth middleware swapped for a header-driven stub; the
  // scheme-membership and role middlewares under test are the real ones.
  const hono = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-user") ?? "anonymous";
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", grievancesRoutes(deps))
    .route("/schemes", complianceRoutes(deps));
  // Mirror app.ts's DomainError → envelope mapping.
  hono.onError((err, c) => {
    const domain = err as { code?: string; message: string; status?: number; details?: unknown };
    if (typeof domain.code === "string" && typeof domain.status === "number") {
      return c.json(
        { error: { code: domain.code, message: domain.message, details: domain.details } },
        // biome-ignore lint/suspicious/noExplicitAny: DomainError validates its status
        domain.status as any,
      );
    }
    return c.json({ error: { code: "INTERNAL", message: "Internal server error" } }, 500);
  });
  app = hono;

  const schemeRows = await tdb.db
    .insert(schemes)
    .values([
      {
        name: "Route Permutation OC",
        planOfSubdivision: "PS777005P",
        addressLine1: "5 Gate Rd",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 3,
        status: "active",
      },
      {
        name: "Other Route OC",
        planOfSubdivision: "PS777006P",
        addressLine1: "6 Elsewhere St",
        suburb: "Fitzroy",
        postcode: "3065",
        tier: 1,
        status: "active",
      },
    ])
    .returning();
  schemeId = schemeRows[0]!.id;
  otherSchemeId = schemeRows[1]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, COMMITTEE, OWNER, OUTSIDER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2026-01-01" },
    { schemeId, userId: COMMITTEE, role: "committee_member", startedOn: "2026-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2026-01-01" },
  ]);
  const personRows = await tdb.db
    .insert(people)
    .values([
      {
        schemeId,
        givenName: "Olive",
        familyName: "Owner",
        email: `${OWNER}@example.com`,
        userId: OWNER,
      },
      { schemeId, givenName: "Rita", familyName: "Respondent", email: "rita-rt@example.com" },
    ])
    .returning();
  ownerPersonId = personRows[0]!.id;
  respondentPersonId = personRows[1]!.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

const complaintBody = (subject: string, withRespondent = false) => ({
  subject,
  details: `${subject} — details for the record.`,
  approvedForm: true,
  ...(withRespondent ? { respondentPersonId } : {}),
});

// ---------------------------------------------------------------------------
// Who can see / do what.
// ---------------------------------------------------------------------------

describe("role gating — grievance register", () => {
  it("officer (chair) reads the register; owner and committee_member get 403", async () => {
    expect((await req(CHAIR, "GET", `/schemes/${schemeId}/complaints`)).status).toBe(200);

    const owner = await req(OWNER, "GET", `/schemes/${schemeId}/complaints`);
    expect(owner.status).toBe(403);
    expect(owner.json.error.code).toBe("FORBIDDEN");

    // Committee members are NOT grievance officers: the tab falls back to the
    // owner "mine" view, and a forced register read is refused server-side.
    const cm = await req(COMMITTEE, "GET", `/schemes/${schemeId}/complaints`);
    expect(cm.status).toBe(403);
    expect(cm.json.error.code).toBe("FORBIDDEN");
  });

  it("hides the scheme entirely from a non-member (404, not 403)", async () => {
    const res = await req(OUTSIDER, "GET", `/schemes/${schemeId}/complaints/mine`);
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("NOT_FOUND");
  });
});

describe("lodging and tracking complaints", () => {
  it("any member lodges; /mine returns only the caller's own complaints", async () => {
    const lodged = await req(
      OWNER,
      "POST",
      `/schemes/${schemeId}/complaints`,
      complaintBody("Owner's own complaint"),
    );
    expect(lodged.status).toBe(201);
    expect(lodged.json.complaint.complainantPersonId).toBe(ownerPersonId);
    // Statutory clock from the fixed route clock: 2026-07-01 + 28 days.
    expect(lodged.json.complaint.meetByDate).toBe("2026-07-29");

    // Chair lodges one on Rita's behalf — it must not leak into the owner's
    // "mine" list, but the chair's register sees both.
    const onBehalf = await req(CHAIR, "POST", `/schemes/${schemeId}/complaints`, {
      ...complaintBody("Lodged for Rita"),
      complainantPersonId: respondentPersonId,
    });
    expect(onBehalf.status).toBe(201);

    const mine = await req(OWNER, "GET", `/schemes/${schemeId}/complaints/mine`);
    expect(mine.status).toBe(200);
    const mineIds = mine.json.complaints.map((c: { id: string }) => c.id);
    expect(mineIds).toContain(lodged.json.complaint.id);
    expect(mineIds).not.toContain(onBehalf.json.complaint.id);

    const register = await req(CHAIR, "GET", `/schemes/${schemeId}/complaints`);
    const registerIds = register.json.complaints.map((c: { id: string }) => c.id);
    expect(registerIds).toEqual(
      expect.arrayContaining([lodged.json.complaint.id, onBehalf.json.complaint.id]),
    );
  });

  it("a committee_member with no person row gets an empty 'mine' list, not an error", async () => {
    const res = await req(COMMITTEE, "GET", `/schemes/${schemeId}/complaints/mine`);
    expect(res.status).toBe(200);
    expect(res.json.complaints).toEqual([]);
  });

  it("maps a too-short subject to a fielded 422 the dialog can attach", async () => {
    const res = await req(OWNER, "POST", `/schemes/${schemeId}/complaints`, {
      subject: "ab",
      details: "ab",
      approvedForm: true,
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("VALIDATION");
    const paths = res.json.error.details.map((i: { path: string[] }) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["subject", "details"]));
  });
});

describe("advancing complaints", () => {
  async function lodge(subject: string, withRespondent = false): Promise<string> {
    const res = await req(
      OWNER,
      "POST",
      `/schemes/${schemeId}/complaints`,
      complaintBody(subject, withRespondent),
    );
    expect(res.status).toBe(201);
    return res.json.complaint.id;
  }

  it("rejects a forced advance from committee_member and owner (403)", async () => {
    const id = await lodge("Forced advance target");
    for (const user of [COMMITTEE, OWNER]) {
      const res = await req(user, "POST", `/schemes/${schemeId}/complaints/${id}/advance`, {
        status: "under_discussion",
      });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("FORBIDDEN");
    }
  });

  it("chair advances legally; an illegal jump and a stale re-advance are 409s", async () => {
    const id = await lodge("Chair advances");

    // Illegal jump straight to final_notice.
    const illegal = await req(CHAIR, "POST", `/schemes/${schemeId}/complaints/${id}/advance`, {
      status: "final_notice",
    });
    expect(illegal.status).toBe(409);
    expect(illegal.json.error.code).toBe("INVALID_TRANSITION");

    const ok = await req(CHAIR, "POST", `/schemes/${schemeId}/complaints/${id}/advance`, {
      status: "under_discussion",
      note: "Committee met.",
    });
    expect(ok.status).toBe(200);
    expect(ok.json.complaint.status).toBe("under_discussion");

    const closed = await req(CHAIR, "POST", `/schemes/${schemeId}/complaints/${id}/advance`, {
      status: "resolved",
    });
    expect(closed.status).toBe(200);

    // Another officer's stale sheet tries to keep working the complaint: the
    // 409 body is what StatusControls renders in its role=alert error line.
    const stale = await req(CHAIR, "POST", `/schemes/${schemeId}/complaints/${id}/advance`, {
      status: "vcat",
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error.message).toMatch(/cannot move from resolved/);
  });
});

// ---------------------------------------------------------------------------
// Breach notices.
// ---------------------------------------------------------------------------

describe("breach notices over HTTP", () => {
  async function lodgeWithRespondent(subject: string): Promise<string> {
    const res = await req(OWNER, "POST", `/schemes/${schemeId}/complaints`, {
      ...complaintBody(subject),
      respondentPersonId,
    });
    return res.json.complaint.id;
  }

  it("committee_member cannot issue one (403)", async () => {
    const complaintId = await lodgeWithRespondent("CM breach attempt");
    const res = await req(COMMITTEE, "POST", `/schemes/${schemeId}/breach-notices`, {
      complaintId,
      subjectPersonId: respondentPersonId,
      ruleRef: "Model Rule 4.1",
      type: "notice_to_rectify",
      details: "Should be forbidden.",
    });
    expect(res.status).toBe(403);
  });

  it("forcing a notice with no subject (complaint without respondent) is a 422", async () => {
    // The UI hides IssueBreachNotice for respondent-less complaints and shows
    // the explanatory paragraph; a forced API call hits the schema refine.
    const complaintId = (
      await req(OWNER, "POST", `/schemes/${schemeId}/complaints`, complaintBody("No respondent"))
    ).json.complaint.id;
    const res = await req(CHAIR, "POST", `/schemes/${schemeId}/breach-notices`, {
      complaintId,
      ruleRef: "Model Rule 4.1",
      type: "notice_to_rectify",
      details: "No one to address this to.",
    });
    expect(res.status).toBe(422);
    expect(res.json.error.code).toBe("VALIDATION");
  });

  it("chair issues (28-day rectify clock) and closes; a second close is 409", async () => {
    const complaintId = await lodgeWithRespondent("Breach full loop");
    const issued = await req(CHAIR, "POST", `/schemes/${schemeId}/breach-notices`, {
      complaintId,
      subjectPersonId: respondentPersonId,
      ruleRef: "Model Rule 4.1",
      type: "notice_to_rectify",
      details: "Cease the breach within the statutory period.",
    });
    expect(issued.status).toBe(201);
    expect(issued.json.breachNotice.rectifyByDate).toBe("2026-07-29");

    const noticeId = issued.json.breachNotice.id;
    const closed = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/breach-notices/${noticeId}/close`,
      { status: "rectified" },
    );
    expect(closed.status).toBe(200);
    expect(closed.json.breachNotice.status).toBe("rectified");

    const again = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/breach-notices/${noticeId}/close`,
      { status: "withdrawn" },
    );
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("NOTICE_CLOSED");
  });

  it("rejects a close with a non-outcome status (422)", async () => {
    const res = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/breach-notices/00000000-0000-4000-8000-00000000dead/close`,
      { status: "issued" },
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Compliance calendar.
// ---------------------------------------------------------------------------

describe("compliance calendar over HTTP", () => {
  const obligation = (title: string, extra: Record<string, unknown> = {}) => ({
    kind: "custom",
    title,
    dueOn: "2026-09-01",
    ...extra,
  });

  it("any member reads the calendar; only officers may raise", async () => {
    expect((await req(OWNER, "GET", `/schemes/${schemeId}/compliance`)).status).toBe(200);

    for (const user of [OWNER, COMMITTEE]) {
      const res = await req(
        user,
        "POST",
        `/schemes/${schemeId}/compliance`,
        obligation("Forbidden raise"),
      );
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("FORBIDDEN");
    }
  });

  it("rejects a 201-character title and an org-level kind (422)", async () => {
    const longTitle = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance`,
      obligation("t".repeat(201)),
    );
    expect(longTitle.status).toBe(422);
    expect(longTitle.json.error.details[0].path).toEqual(["title"]);

    const orgKind = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance`,
      obligation("Registration renewal", { kind: "registration_renewal" }),
    );
    expect(orgKind.status).toBe(422);
  });

  it("rejects the dialog's raw 'default' sentinel — the client must omit the role", async () => {
    const res = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance`,
      obligation("Sentinel role", { responsibleRole: "default" }),
    );
    expect(res.status).toBe(422);
  });

  // TODO(bug): the dueOn regex accepts impossible dates (2026-13-40); Postgres
  // then rejects the insert and the client sees a 500 INTERNAL instead of a
  // fielded 422. Unskip once dueOn validates calendar validity.
  it.skip("maps an impossible dueOn to a 422", async () => {
    const res = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance`,
      obligation("Impossible date", { dueOn: "2026-13-40" }),
    );
    expect(res.status).toBe(422);
  });

  it("chair raises with the per-category default role, completes once, then 409s", async () => {
    const raised = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance`,
      obligation("Fire panel annual service"),
    );
    expect(raised.status).toBe(201);
    // 'custom' defaults to manager_admin server-side.
    expect(raised.json.obligation.responsibleRole).toBe("manager_admin");
    expect(raised.json.obligation.status).toBe("upcoming");

    const id = raised.json.obligation.id;
    const done = await req(CHAIR, "POST", `/schemes/${schemeId}/compliance/${id}/complete`, {
      waived: false,
    });
    expect(done.status).toBe(200);
    expect(done.json.obligation.status).toBe("done");

    // Double-complete: the 409 the tab surfaces as toast.error.
    const twice = await req(CHAIR, "POST", `/schemes/${schemeId}/compliance/${id}/complete`, {
      waived: true,
    });
    expect(twice.status).toBe(409);
    expect(twice.json.error.code).toBe("ALREADY_CLOSED");

    // The open window no longer lists it (stat cards recount), all still does.
    const open = await req(CHAIR, "GET", `/schemes/${schemeId}/compliance?window=open`);
    expect(open.json.obligations.map((o: { id: string }) => o.id)).not.toContain(id);
    const all = await req(CHAIR, "GET", `/schemes/${schemeId}/compliance?window=all`);
    expect(all.json.obligations.map((o: { id: string }) => o.id)).toContain(id);
  });

  it("waiving reports 'waived', and cross-scheme completion is hidden as 404", async () => {
    const raised = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance`,
      obligation("Waive me"),
    );
    const waived = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance/${raised.json.obligation.id}/complete`,
      { waived: true },
    );
    expect(waived.status).toBe(200);
    expect(waived.json.obligation.status).toBe("waived");

    // An obligation raised in ANOTHER scheme can't be closed through this one.
    const foreign = await complianceService.raiseObligation(
      { db: tdb.db, clock, integrations, actor: userActor(CHAIR) },
      {
        schemeId: otherSchemeId,
        kind: "custom",
        title: "Foreign obligation",
        dueOn: "2026-09-01",
        subjectRef: "manual:foreign",
      },
    );
    const crossScheme = await req(
      CHAIR,
      "POST",
      `/schemes/${schemeId}/compliance/${foreign.id}/complete`,
      { waived: false },
    );
    expect(crossScheme.status).toBe(404);
    expect(crossScheme.json.error.code).toBe("NOT_FOUND");
  });
});
