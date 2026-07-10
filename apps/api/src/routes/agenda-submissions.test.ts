import { DomainError, meetingsService } from "@goodstrata/core";
import { lots, memberships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemActor, systemClock } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { meetingsRoutes } from "./meetings.js";

/**
 * Route-level permutations for owner-submitted motions/agenda items:
 *  - any member with a linked person may submit (the statutory owner right)
 *  - a member with no person record gets the NO_PERSON 422
 *  - only officers may accept/reject; accept yields the agenda item + motion
 *  - non-members get 404 (scheme existence never leaked)
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;
let meetingId: string;

const CHAIR = "user-chair-agr";
const OWNER = "user-owner-agr";
const NOPERSON = "user-noperson-agr";
const OUTSIDER = "user-outsider-agr";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

function req(userId: string, path: string, init?: { method?: string; json?: unknown }) {
  return app.request(`/schemes/${schemeId}${path}`, {
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: {
      "x-test-user": userId,
      ...(init?.json !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
}

const submission = (title: string) => ({
  title,
  motionText: `That the owners corporation resolve: ${title}.`,
  rationale: "Raised by an owner through the portal.",
});

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  deps = {
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;

  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user")!;
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", meetingsRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Agenda Route OC",
      planOfSubdivision: "PS888003A",
      addressLine1: "3 Agenda Ave",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, OWNER, NOPERSON, OUTSIDER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2026-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2026-01-01" },
    { schemeId, userId: NOPERSON, role: "owner", startedOn: "2026-01-01" },
  ]);
  await tdb.db.insert(people).values([
    { schemeId, userId: CHAIR, givenName: "Casey", email: `${CHAIR}@example.com` },
    { schemeId, userId: OWNER, givenName: "Olly", email: `${OWNER}@example.com` },
  ]);
  // The meeting-detail read computes quorum, which needs a non-empty roll.
  await tdb.db.insert(lots).values({ schemeId, lotNumber: "1", entitlement: 10, liability: 10 });

  // A draft AGM a year out — its agenda window is open throughout the file.
  const scheduledAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const meeting = await meetingsService.createMeeting(
    deps.serviceContext(systemActor("test")),
    schemeId,
    { kind: "agm", title: "Route Test AGM", scheduledAt, agenda: [] },
  );
  meetingId = meeting.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("submitting (member-level)", () => {
  it("non-member gets 404 (not 403)", async () => {
    const res = await req(OUTSIDER, `/meetings/${meetingId}/agenda-items`, {
      json: submission("Outsider item"),
    });
    expect(res.status).toBe(404);
  });

  it("a member with no linked person gets the NO_PERSON 422", async () => {
    const res = await req(NOPERSON, `/meetings/${meetingId}/agenda-items`, {
      json: submission("Ghost item"),
    });
    expect(res.status).toBe(422);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("NO_PERSON");
  });

  it("422 VALIDATION for a too-short title", async () => {
    const res = await req(OWNER, `/meetings/${meetingId}/agenda-items`, {
      json: { title: "ab", motionText: "That something happens." },
    });
    expect(res.status).toBe(422);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("VALIDATION");
  });

  it("a plain owner can submit; it arrives pending with their person stamped", async () => {
    const res = await req(OWNER, `/meetings/${meetingId}/agenda-items`, {
      json: submission("Install bike hoops"),
    });
    expect(res.status).toBe(201);
    const { agendaItem } = await json<{
      agendaItem: { id: string; status: string; submittedByPersonId: string | null };
    }>(res);
    expect(agendaItem.status).toBe("pending");
    expect(agendaItem.submittedByPersonId).not.toBeNull();
  });
});

describe("review (officer-only)", () => {
  let itemId: string;

  beforeAll(async () => {
    const res = await req(OWNER, `/meetings/${meetingId}/agenda-items`, {
      json: submission("Upgrade intercoms"),
    });
    ({
      agendaItem: { id: itemId },
    } = await json<{ agendaItem: { id: string } }>(res));
  });

  it("a plain owner cannot accept or reject (403 FORBIDDEN)", async () => {
    for (const path of [`accept`, `reject`]) {
      const res = await req(OWNER, `/agenda-items/${itemId}/${path}`, {
        json: path === "reject" ? { reason: "not yours to call" } : {},
      });
      expect(res.status).toBe(403);
      const body = await json<ErrorEnvelope>(res);
      expect(body.error.code).toBe("FORBIDDEN");
    }
  });

  it("chair accepts → agenda item accepted + draft motion on the meeting", async () => {
    const res = await req(CHAIR, `/agenda-items/${itemId}/accept`, { json: {} });
    expect(res.status).toBe(200);
    const { agendaItem, motion } = await json<{
      agendaItem: { status: string };
      motion: { id: string; status: string; meetingId: string; title: string };
    }>(res);
    expect(agendaItem.status).toBe("accepted");
    expect(motion.status).toBe("draft");
    expect(motion.meetingId).toBe(meetingId);

    // It now shows up as a real agenda item + motion in the meeting detail.
    const detail = await json<{
      agenda: { title: string }[];
      motions: { id: string }[];
    }>(await req(OWNER, `/meetings/${meetingId}`));
    expect(detail.agenda.some((a) => a.title === "Upgrade intercoms")).toBe(true);
    expect(detail.motions.some((m) => m.id === motion.id)).toBe(true);
  });

  it("accepting the same item again → 409", async () => {
    const res = await req(CHAIR, `/agenda-items/${itemId}/accept`, { json: {} });
    expect(res.status).toBe(409);
  });

  it("chair rejects a pending item with a reason; rejecting again → 409", async () => {
    const created = await req(OWNER, `/meetings/${meetingId}/agenda-items`, {
      json: submission("Gold-plate the letterboxes"),
    });
    const {
      agendaItem: { id },
    } = await json<{ agendaItem: { id: string } }>(created);

    const noReason = await req(CHAIR, `/agenda-items/${id}/reject`, { json: {} });
    expect(noReason.status).toBe(422);

    const res = await req(CHAIR, `/agenda-items/${id}/reject`, {
      json: { reason: "Beyond this year's budget envelope." },
    });
    expect(res.status).toBe(200);
    const { agendaItem } = await json<{
      agendaItem: { status: string; rejectedReason: string | null };
    }>(res);
    expect(agendaItem.status).toBe("rejected");
    expect(agendaItem.rejectedReason).toContain("budget envelope");

    const again = await req(CHAIR, `/agenda-items/${id}/reject`, {
      json: { reason: "still no" },
    });
    expect(again.status).toBe(409);
  });
});
