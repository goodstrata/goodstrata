import { DomainError, notificationsService } from "@goodstrata/core";
import { userActor } from "@goodstrata/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

export function notificationsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      "/:schemeId/notifications",
      requireSchemeMember(deps),
      zv("query", z.object({ unreadOnly: z.enum(["true", "false"]).optional() })),
      async (c) => {
        const user = c.get("user");
        const ctx = deps.serviceContext(userActor(user.id));
        const rows = await notificationsService.listNotifications(ctx, c.get("schemeId"), user.id, {
          unreadOnly: c.req.valid("query").unreadOnly === "true",
        });
        return c.json({ notifications: rows });
      },
    )
    .post(
      "/:schemeId/notifications/read",
      requireSchemeMember(deps),
      zv("json", z.object({ notificationId: z.string().optional(), all: z.boolean().optional() })),
      async (c) => {
        const user = c.get("user");
        const { notificationId, all } = c.req.valid("json");
        if (!notificationId && !all) {
          throw new DomainError("VALIDATION", "Provide notificationId or all: true", 422);
        }
        const ctx = deps.serviceContext(userActor(user.id));
        await notificationsService.markRead(
          ctx,
          c.get("schemeId"),
          user.id,
          all ? "all" : notificationId!,
        );
        return c.json({ ok: true });
      },
    );
}
