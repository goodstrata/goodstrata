import { createSchemeInput, schemesService } from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

export function schemesRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const user = c.get("user");
      const ctx = deps.serviceContext(userActor(user.id));
      const rows = await schemesService.listSchemesForUser(ctx, user.id);
      return c.json({ schemes: rows });
    })
    .post("/", zv("json", createSchemeInput), async (c) => {
      const user = c.get("user");
      const ctx = deps.serviceContext(userActor(user.id));
      const scheme = await schemesService.createScheme(ctx, c.req.valid("json"));
      return c.json({ scheme }, 201);
    })
    .get("/:schemeId", requireSchemeMember(deps), async (c) => {
      const user = c.get("user");
      const ctx = deps.serviceContext(userActor(user.id));
      const scheme = await schemesService.getScheme(ctx, c.get("schemeId"));
      return c.json({ scheme, roles: c.get("roles") });
    });
}
