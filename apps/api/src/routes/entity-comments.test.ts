import { DomainError, grievancesService, maintenanceService } from "@goodstrata/core";
import { memberships, people, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemActor, systemClock, userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { grievancesRoutes } from "./grievances.js";
import { maintenanceRoutes } from "./maintenance.js";

/**
 * Route-level permutations for the comment threads on maintenance requests and
 * complaints:
 *  - non-members get 404 (scheme existence never leaked)
 *  - maintenance: requester + officers converse; another member gets 403
 *  - complaints: complainant + officers converse; the respondent (and any
 *    other member) gets 404 — a complaint's existence is confidential
 *  - soft-delete: author or officer; 404 once gone
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;
let requestId: string;
let complaintId: string;

const CHAIR = "user-chair-ecr";
const REQUESTER = "user-requester-ecr";
const RESPONDENT = "user-respondent-ecr";
const OTHER = "user-other-ecr";
const OUTSIDER = "user-outsider-ecr";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

/** Typed body reader — Response.json() is `unknown` under this tsconfig. */
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

beforeAll(async () => {
  tdb = await provisionTestDatabase();
  deps = {
    db: tdb.db,
    integrations,
    clock: systemClock,
    serviceContext: buildServiceContextFactory(tdb.db, integrations, systemClock),
  } as unknown as AppDeps;

  // Fake session: identity from a header, then the REAL scheme-membership and
  // role middleware run against the real database (same as app.ts wiring).
  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user")!;
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", maintenanceRoutes(deps))
    .route("/schemes", grievancesRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Comment Route OC",
      planOfSubdivision: "PS888002C",
      addressLine1: "2 Reply Rd",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, REQUESTER, RESPONDENT, OTHER, OUTSIDER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2026-01-01" },
    { schemeId, userId: REQUESTER, role: "owner", startedOn: "2026-01-01" },
    { schemeId, userId: RESPONDENT, role: "owner", startedOn: "2026-01-01" },
    { schemeId, userId: OTHER, role: "owner", startedOn: "2026-01-01" },
  ]);
  const personRows = await tdb.db
    .insert(people)
    .values([
      { schemeId, userId: REQUESTER, givenName: "Rita", email: `${REQUESTER}@example.com` },
      { schemeId, userId: RESPONDENT, givenName: "Rex", email: `${RESPONDENT}@example.com` },
    ])
    .returning();
  const requesterPersonId = personRows[0]!.id;
  const respondentPersonId = personRows[1]!.id;

  const svc = deps.serviceContext(systemActor("test"));
  const request = await maintenanceService.createMaintenanceRequest(svc, schemeId, {
    title: "Foyer light flickering",
    description: "Intermittent since the storm.",
    reportedByPersonId: requesterPersonId,
  });
  requestId = request.id;

  const complaint = await grievancesService.fileComplaint(
    deps.serviceContext(userActor(REQUESTER)),
    schemeId,
    {
      complainantPersonId: requesterPersonId,
      respondentPersonId,
      subject: "Parking in my space",
      details: "Lot 9's visitor keeps using my car space.",
      approvedForm: true,
    },
  );
  complaintId = complaint.id;
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("scheme scoping", () => {
  it("non-member gets 404 (not 403) on both threads", async () => {
    for (const path of [
      `/maintenance/${requestId}/comments`,
      `/complaints/${complaintId}/comments`,
    ]) {
      const res = await req(OUTSIDER, path);
      expect(res.status).toBe(404);
      expect((await json<ErrorEnvelope>(res)).error.code).toBe("NOT_FOUND");
    }
  });
});

describe("maintenance-request thread", () => {
  it("requester posts, chair replies, requester reads both", async () => {
    const post = await req(REQUESTER, `/maintenance/${requestId}/comments`, {
      json: { body: "Still flickering — any news?" },
    });
    expect(post.status).toBe(201);

    const reply = await req(CHAIR, `/maintenance/${requestId}/comments`, {
      json: { body: "Electrician booked for Friday." },
    });
    expect(reply.status).toBe(201);

    const list = await req(REQUESTER, `/maintenance/${requestId}/comments`);
    expect(list.status).toBe(200);
    const { comments } = await json<{ comments: { body: string; author: { userId: string } }[] }>(
      list,
    );
    expect(comments.map((c) => c.body)).toEqual([
      "Still flickering — any news?",
      "Electrician booked for Friday.",
    ]);
    expect(comments[1]!.author.userId).toBe(CHAIR);
  });

  it("another member gets 403 on read and write", async () => {
    const read = await req(OTHER, `/maintenance/${requestId}/comments`);
    expect(read.status).toBe(403);
    const write = await req(OTHER, `/maintenance/${requestId}/comments`, {
      json: { body: "nosy" },
    });
    expect(write.status).toBe(403);
  });

  it("422 for an empty body", async () => {
    const res = await req(REQUESTER, `/maintenance/${requestId}/comments`, { json: { body: "" } });
    expect(res.status).toBe(422);
  });
});

describe("complaint thread (confidentiality)", () => {
  it("complainant posts, chair replies, both read the thread", async () => {
    const post = await req(REQUESTER, `/complaints/${complaintId}/comments`, {
      json: { body: "Happened again this morning." },
    });
    expect(post.status).toBe(201);

    const reply = await req(CHAIR, `/complaints/${complaintId}/comments`, {
      json: { body: "We've written to the owner of lot 9." },
    });
    expect(reply.status).toBe(201);

    for (const userId of [REQUESTER, CHAIR]) {
      const list = await req(userId, `/complaints/${complaintId}/comments`);
      expect(list.status).toBe(200);
      const { comments } = await json<{ comments: unknown[] }>(list);
      expect(comments).toHaveLength(2);
    }
  });

  it("the respondent and other members get 404, never 403", async () => {
    for (const userId of [RESPONDENT, OTHER]) {
      const read = await req(userId, `/complaints/${complaintId}/comments`);
      expect(read.status).toBe(404);
      expect((await json<ErrorEnvelope>(read)).error.code).toBe("NOT_FOUND");
      const write = await req(userId, `/complaints/${complaintId}/comments`, {
        json: { body: "let me see" },
      });
      expect(write.status).toBe(404);
    }
  });
});

describe("soft delete", () => {
  it("author deletes their own; a second delete 404s", async () => {
    const post = await req(REQUESTER, `/maintenance/${requestId}/comments`, {
      json: { body: "posted in error" },
    });
    const { comment } = await json<{ comment: { id: string } }>(post);

    const del = await req(REQUESTER, `/maintenance/comments/${comment.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const again = await req(REQUESTER, `/maintenance/comments/${comment.id}`, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });

  it("an officer moderates a member's comment; a non-author member cannot", async () => {
    const post = await req(REQUESTER, `/complaints/${complaintId}/comments`, {
      json: { body: "intemperate remark" },
    });
    const { comment } = await json<{ comment: { id: string } }>(post);

    // OTHER isn't the author and holds no officer role.
    const denied = await req(OTHER, `/complaints/comments/${comment.id}`, { method: "DELETE" });
    expect(denied.status).toBe(403);

    const moderated = await req(CHAIR, `/complaints/comments/${comment.id}`, { method: "DELETE" });
    expect(moderated.status).toBe(200);

    const list = await req(CHAIR, `/complaints/${complaintId}/comments`);
    const { comments } = await json<{ comments: { id: string }[] }>(list);
    expect(comments.some((c) => c.id === comment.id)).toBe(false);
  });
});
