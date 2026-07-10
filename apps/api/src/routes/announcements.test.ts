import { announcementsService, DomainError } from "@goodstrata/core";
import { memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { systemClock, userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "../deps.js";
import { buildServiceContextFactory } from "../deps.js";
import type { AppEnv } from "../middleware.js";
import { announcementsRoutes } from "./announcements.js";

/**
 * Route-level permutations for the committee noticeboard:
 *  - non-members get 404 (scheme existence never leaked)
 *  - create/publish are officer-tier only (committee_member counts; owner 403)
 *  - the list and single read are audience-filtered by the caller's roles
 *  - edit/delete are author-or-officer; another plain member gets 403
 *  - zv validation failures surface as the 422 envelope
 */

let tdb: TestDatabase;
let app: Hono<AppEnv>;
let deps: AppDeps;
let schemeId: string;

const CHAIR = "user-chair-ar";
const COMMITTEE = "user-committee-ar";
const OWNER = "user-owner-ar";
const TENANT = "user-tenant-ar";
const OUTSIDER = "user-outsider-ar";

const integrations = integrationsFromEnv({
  EMAIL_PROVIDER: "memory",
  SMS_PROVIDER: "memory",
  STORAGE_PROVIDER: "memory",
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface AnnouncementBody {
  announcement: { id: string; title: string; audience: string; publishedAt: string | null };
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

  // Fake session: identity from a header; the REAL scheme-membership and role
  // middleware then run against the real database (same as app.ts wiring).
  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      const id = c.req.header("x-test-user")!;
      c.set("user", { id, email: `${id}@example.com`, name: id });
      await next();
    })
    .route("/schemes", announcementsRoutes(deps));
  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 409);
    }
    throw err;
  });

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Noticeboard Route OC",
      planOfSubdivision: "PS888009A",
      addressLine1: "9 Notice St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
      status: "active",
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(users).values(
    [CHAIR, COMMITTEE, OWNER, TENANT, OUTSIDER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
  );
  await tdb.db.insert(memberships).values([
    { schemeId, userId: CHAIR, role: "chair", startedOn: "2026-01-01" },
    { schemeId, userId: COMMITTEE, role: "committee_member", startedOn: "2026-01-01" },
    { schemeId, userId: OWNER, role: "owner", startedOn: "2026-01-01" },
    { schemeId, userId: TENANT, role: "tenant", startedOn: "2026-01-01" },
  ]);
}, 120_000);

afterAll(async () => {
  await tdb.cleanup();
});

describe("scheme scoping", () => {
  it("non-member gets 404 (not 403) on the list", async () => {
    const res = await req(OUTSIDER, "/announcements");
    expect(res.status).toBe(404);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("create & publish (officer tier only)", () => {
  it.each([[OWNER], [TENANT]])("%s cannot create (403 FORBIDDEN)", async (userId) => {
    const res = await req(userId, "/announcements", {
      json: { title: "Nice try", body: "Not an officer." },
    });
    expect(res.status).toBe(403);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it.each([[CHAIR], [COMMITTEE]])("%s can create a draft and publish it", async (userId) => {
    const create = await req(userId, "/announcements", {
      json: { title: `Draft by ${userId}`, body: "To be published." },
    });
    expect(create.status).toBe(201);
    const { announcement } = await json<AnnouncementBody>(create);
    expect(announcement.publishedAt).toBeNull(); // drafts by default
    expect(announcement.audience).toBe("all");

    const publish = await req(userId, `/announcements/${announcement.id}/publish`, {
      method: "POST",
    });
    expect(publish.status).toBe(200);
    const published = await json<AnnouncementBody>(publish);
    expect(published.announcement.publishedAt).not.toBeNull();

    // Publishing twice is a 409.
    const again = await req(userId, `/announcements/${announcement.id}/publish`, {
      method: "POST",
    });
    expect(again.status).toBe(409);
  });

  it("owner cannot publish someone else's draft (403)", async () => {
    const create = await req(CHAIR, "/announcements", {
      json: { title: "Officer draft", body: "…" },
    });
    const { announcement } = await json<AnnouncementBody>(create);
    const res = await req(OWNER, `/announcements/${announcement.id}/publish`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });

  it("422 with field issues for a too-short title", async () => {
    const res = await req(CHAIR, "/announcements", { json: { title: "ab", body: "valid" } });
    expect(res.status).toBe(422);
    const body = await json<ErrorEnvelope>(res);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details!.some((i) => i.path[0] === "title")).toBe(true);
  });
});

describe("audience filtering on reads", () => {
  let committeeNoticeId: string;
  let allNoticeId: string;

  beforeAll(async () => {
    const svc = deps.serviceContext(userActor(CHAIR));
    committeeNoticeId = (
      await announcementsService.createAnnouncement(svc, schemeId, {
        title: "Committee-only levy talk",
        body: "…",
        audience: "committee",
        publish: true,
      })
    ).id;
    allNoticeId = (
      await announcementsService.createAnnouncement(svc, schemeId, {
        title: "Water off Thursday",
        body: "…",
        audience: "all",
        publish: true,
      })
    ).id;
  });

  it("an owner's list omits committee notices; an officer's includes them", async () => {
    const ownerList = await req(OWNER, "/announcements");
    expect(ownerList.status).toBe(200);
    const ownerBody = await json<{ announcements: { id: string }[] }>(ownerList);
    expect(ownerBody.announcements.some((a) => a.id === allNoticeId)).toBe(true);
    expect(ownerBody.announcements.some((a) => a.id === committeeNoticeId)).toBe(false);

    const officerList = await req(COMMITTEE, "/announcements");
    const officerBody = await json<{ announcements: { id: string }[] }>(officerList);
    expect(officerBody.announcements.some((a) => a.id === committeeNoticeId)).toBe(true);
  });

  it("an owner's single read of a committee notice 404s (existence not leaked)", async () => {
    const res = await req(OWNER, `/announcements/${committeeNoticeId}`);
    expect(res.status).toBe(404);

    const ok = await req(OWNER, `/announcements/${allNoticeId}`);
    expect(ok.status).toBe(200);
  });
});

describe("edit & delete (author or officer)", () => {
  it("author edits; a plain owner is refused; an officer deletes", async () => {
    const create = await req(CHAIR, "/announcements", {
      json: { title: "Editable route notice", body: "v1", publish: true },
    });
    const { announcement } = await json<AnnouncementBody>(create);

    const ownerEdit = await req(OWNER, `/announcements/${announcement.id}`, {
      method: "PATCH",
      json: { body: "vandalised" },
    });
    expect(ownerEdit.status).toBe(403);

    const authorEdit = await req(CHAIR, `/announcements/${announcement.id}`, {
      method: "PATCH",
      json: { body: "v2" },
    });
    expect(authorEdit.status).toBe(200);
    const edited = await json<{ announcement: { id: string; publishedAt: string | null } }>(
      authorEdit,
    );
    expect(edited.announcement.id).toBe(announcement.id);

    const ownerDelete = await req(OWNER, `/announcements/${announcement.id}`, {
      method: "DELETE",
    });
    expect(ownerDelete.status).toBe(403);

    // A different officer (not the author) can remove it.
    const officerDelete = await req(COMMITTEE, `/announcements/${announcement.id}`, {
      method: "DELETE",
    });
    expect(officerDelete.status).toBe(200);

    const gone = await req(CHAIR, `/announcements/${announcement.id}`);
    expect(gone.status).toBe(404);
  });

  it("PATCH with an empty change set is a 422", async () => {
    const create = await req(CHAIR, "/announcements", {
      json: { title: "Empty patch target", body: "…" },
    });
    const { announcement } = await json<AnnouncementBody>(create);
    const res = await req(CHAIR, `/announcements/${announcement.id}`, {
      method: "PATCH",
      json: {},
    });
    expect(res.status).toBe(422);
  });
});
