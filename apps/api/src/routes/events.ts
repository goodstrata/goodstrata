import { eventLog } from "@goodstrata/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

const listQuery = z.object({
  after: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function eventsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get(
    "/:schemeId/events",
    requireSchemeMember(deps),
    zv("query", listQuery),
    async (c) => {
      const { after, limit } = c.req.valid("query");
      const schemeId = c.get("schemeId");
      const where = after
        ? and(eq(eventLog.schemeId, schemeId), gt(eventLog.seq, after))
        : eq(eventLog.schemeId, schemeId);
      const rows = await deps.db
        .select({
          id: eventLog.id,
          seq: eventLog.seq,
          type: eventLog.type,
          stream: eventLog.stream,
          payload: eventLog.payload,
          actor: eventLog.actor,
          correlationId: eventLog.correlationId,
          causationId: eventLog.causationId,
          occurredAt: eventLog.occurredAt,
        })
        .from(eventLog)
        .where(where)
        .orderBy(desc(eventLog.seq))
        .limit(limit);
      return c.json({ events: rows });
    },
  );
}
