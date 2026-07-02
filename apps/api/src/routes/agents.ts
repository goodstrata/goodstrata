import { agentRuns } from "@goodstrata/db";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { type AppEnv, requireSchemeMember } from "../middleware.js";
import { zv } from "../validate.js";

export function agentRunsRoutes(deps: AppDeps) {
  return new Hono<AppEnv>()
    .get(
      "/:schemeId/agent-runs",
      requireSchemeMember(deps),
      zv("query", z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) })),
      async (c) => {
        const rows = await deps.db
          .select({
            id: agentRuns.id,
            agent: agentRuns.agent,
            status: agentRuns.status,
            model: agentRuns.model,
            triggerEventId: agentRuns.triggerEventId,
            inputTokens: agentRuns.inputTokens,
            outputTokens: agentRuns.outputTokens,
            startedAt: agentRuns.startedAt,
            finishedAt: agentRuns.finishedAt,
            error: agentRuns.error,
          })
          .from(agentRuns)
          .where(eq(agentRuns.schemeId, c.get("schemeId")))
          .orderBy(desc(agentRuns.startedAt))
          .limit(c.req.valid("query").limit);
        return c.json({ runs: rows });
      },
    )
    .get("/:schemeId/agent-runs/:runId", requireSchemeMember(deps), async (c) => {
      const run = await deps.db.query.agentRuns.findFirst({
        where: eq(agentRuns.id, c.req.param("runId")),
      });
      if (!run || run.schemeId !== c.get("schemeId")) {
        return c.json({ error: { code: "NOT_FOUND", message: "Run not found" } }, 404);
      }
      return c.json({ run });
    });
}
