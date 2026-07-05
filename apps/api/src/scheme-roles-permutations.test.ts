/**
 * Role-gating permutations for the scheme registers family. The web app hides
 * officer forms via useIsOfficer, but the real fence is requireSchemeMember +
 * requireRole — this exercises that fence directly for every role, including
 * the easy-to-get-wrong ones: committee_member (NOT an officer) and the
 * non-member/ended-membership 404 (scheme existence must not leak).
 */
import { DomainError } from "@goodstrata/core";
import { memberships, schemes, users } from "@goodstrata/db";
import { provisionTestDatabase, type TestDatabase } from "@goodstrata/db/testing";
import { integrationsFromEnv } from "@goodstrata/integrations";
import { fixedClock, userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppDeps } from "./deps.js";
import { buildServiceContextFactory } from "./deps.js";
import { type AppEnv, requireRole, requireSchemeMember } from "./middleware.js";

let tdb: TestDatabase;
let schemeId: string;
let app: Hono<AppEnv>;

const ROLE_USERS = {
  owner: "u-owner",
  committee_member: "u-committee",
  chair: "u-chair",
  secretary: "u-secretary",
  treasurer: "u-treasurer",
  manager_admin: "u-manager",
} as const;

beforeAll(async () => {
  tdb = await provisionTestDatabase();

  await tdb.db.insert(users).values([
    ...Object.values(ROLE_USERS).map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
    })),
    { id: "u-outsider", name: "Outsider", email: "u-outsider@example.com" },
    { id: "u-former", name: "Former Chair", email: "u-former@example.com" },
  ]);

  const schemeRows = await tdb.db
    .insert(schemes)
    .values({
      name: "Gate Test OC",
      planOfSubdivision: "PS888888G",
      addressLine1: "1 Fence St",
      suburb: "Fitzroy",
      postcode: "3065",
      tier: 4,
    })
    .returning();
  schemeId = schemeRows[0]!.id;

  await tdb.db.insert(memberships).values([
    ...Object.entries(ROLE_USERS).map(([role, userId]) => ({
      schemeId,
      userId,
      role: role as keyof typeof ROLE_USERS,
      startedOn: "2026-01-01",
    })),
    // A closed membership period must gate like no membership at all.
    {
      schemeId,
      userId: "u-former",
      role: "chair" as const,
      startedOn: "2025-01-01",
      endedOn: "2026-01-01",
    },
  ]);

  const integrations = integrationsFromEnv({
    EMAIL_PROVIDER: "memory",
    SMS_PROVIDER: "memory",
    STORAGE_PROVIDER: "memory",
  });
  const deps = {
    serviceContext: buildServiceContextFactory(
      tdb.db,
      integrations,
      fixedClock("2026-07-04T00:00:00Z"),
    ),
  } as AppDeps;

  // Minimal app mirroring the register routes' middleware stack: a member-read
  // endpoint and an officer-write endpoint, with app.ts's DomainError mapping.
  app = new Hono<AppEnv>()
    .use("*", async (c, next) => {
      // Test-only auth: the caller names itself via header (requireAuth is
      // better-auth's concern; the permutations under test start after it).
      c.set("user", { id: c.req.header("x-test-user") ?? "anonymous", email: "", name: "" });
      await next();
    })
    .onError((err, c) => {
      if (err instanceof DomainError) {
        // biome-ignore lint/suspicious/noExplicitAny: status validated by DomainError
        return c.json({ error: { code: err.code, message: err.message } }, err.status as any);
      }
      throw err;
    })
    .get("/:schemeId/register", requireSchemeMember(deps), (c) => c.json({ roles: c.get("roles") }))
    .post(
      "/:schemeId/officer-action",
      requireSchemeMember(deps),
      requireRole("chair", "secretary", "treasurer"),
      (c) => c.json({ ok: true }, 201),
    );
});

afterAll(async () => {
  await tdb.cleanup();
});

function call(method: "GET" | "POST", path: string, asUser: string) {
  return app.request(path, { method, headers: { "x-test-user": asUser } });
}

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

describe("register reads (requireSchemeMember)", () => {
  it("lets every active member in — owner included — and exposes their roles", async () => {
    for (const [role, userId] of Object.entries(ROLE_USERS)) {
      const res = await call("GET", `/${schemeId}/register`, userId);
      expect(res.status, role).toBe(200);
      expect(await res.json()).toEqual({ roles: [role] });
    }
  });

  it("404s (not 403s) a non-member so scheme existence never leaks", async () => {
    const res = await call("GET", `/${schemeId}/register`, "u-outsider");
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("404s a member whose only membership period has ended", async () => {
    const res = await call("GET", `/${schemeId}/register`, "u-former");
    expect(res.status).toBe(404);
  });
});

describe("officer writes (requireRole chair/secretary/treasurer)", () => {
  it.each(["chair", "secretary", "treasurer"] as const)("%s may write", async (role) => {
    const res = await call("POST", `/${schemeId}/officer-action`, ROLE_USERS[role]);
    expect(res.status).toBe(201);
  });

  it("manager_admin always passes the role guard", async () => {
    const res = await call("POST", `/${schemeId}/officer-action`, ROLE_USERS.manager_admin);
    expect(res.status).toBe(201);
  });

  it("a plain owner is refused with a FORBIDDEN envelope", async () => {
    const res = await call("POST", `/${schemeId}/officer-action`, ROLE_USERS.owner);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("committee_member is NOT an officer — forcing the request past the hidden UI still 403s", async () => {
    const res = await call("POST", `/${schemeId}/officer-action`, ROLE_USERS.committee_member);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("a non-member is 404ed before the role guard even runs", async () => {
    const res = await call("POST", `/${schemeId}/officer-action`, "u-outsider");
    expect(res.status).toBe(404);
  });
});

describe("rolesForUser projection the middleware relies on", () => {
  it("returns only active roles and every role the user holds", async () => {
    const integrations = integrationsFromEnv({
      EMAIL_PROVIDER: "memory",
      SMS_PROVIDER: "memory",
      STORAGE_PROVIDER: "memory",
    });
    const ctx = buildServiceContextFactory(
      tdb.db,
      integrations,
      fixedClock("2026-07-04T00:00:00Z"),
    )(userActor("u-chair"));
    // Give the chair a second concurrent role — both must surface for the UI's
    // useIsOfficer / canDecide logic.
    await tdb.db.insert(memberships).values({
      schemeId,
      userId: "u-chair",
      role: "owner",
      startedOn: "2026-02-01",
    });
    const { schemesService } = await import("@goodstrata/core");
    const roles = await schemesService.rolesForUser(ctx, schemeId, "u-chair");
    expect(roles.sort()).toEqual(["chair", "owner"]);
    expect(await schemesService.rolesForUser(ctx, schemeId, "u-former")).toEqual([]);
  });
});
