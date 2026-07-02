import { DomainError, schemesService } from "@goodstrata/core";
import type { MembershipRole } from "@goodstrata/shared";
import { userActor } from "@goodstrata/shared";
import { createMiddleware } from "hono/factory";
import type { AppDeps } from "./deps.js";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
}

export type Vars = {
  user: AuthedUser;
  schemeId: string;
  roles: MembershipRole[];
};

export type AppEnv = { Variables: Vars };

/** Reject unauthenticated requests; expose the user on context. */
export function requireAuth(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, 401);
    }
    c.set("user", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    });
    await next();
  });
}

/**
 * Scheme scoping: the user must hold an active membership. Non-members get
 * 404 (not 403) so scheme existence is never leaked.
 */
export function requireSchemeMember(deps: AppDeps) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const schemeId = c.req.param("schemeId");
    if (!schemeId) {
      return c.json({ error: { code: "BAD_REQUEST", message: "schemeId missing" } }, 400);
    }
    const user = c.get("user");
    const ctx = deps.serviceContext(userActor(user.id));
    const roles = await schemesService.rolesForUser(ctx, schemeId, user.id);
    if (roles.length === 0) {
      return c.json({ error: { code: "NOT_FOUND", message: "Scheme not found" } }, 404);
    }
    c.set("schemeId", schemeId);
    c.set("roles", roles);
    await next();
  });
}

/** Role guard on top of scheme membership. manager_admin always passes. */
export function requireRole(...allowed: MembershipRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const roles = c.get("roles") ?? [];
    const ok = roles.includes("manager_admin") || roles.some((r) => allowed.includes(r));
    if (!ok) {
      throw new DomainError("FORBIDDEN", `Requires one of: ${allowed.join(", ")}`, 403);
    }
    await next();
  });
}
