import { agentRuns, eventLog } from "@goodstrata/db";
import { and, asc, desc, eq, notLike, sql } from "drizzle-orm";
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
      // The two ends the UI leads with: what set the agent off (the trigger
      // event) and what it put on the record (every event this run published,
      // minus its own agent.run.* lifecycle noise).
      const [triggerRows, effects] = await Promise.all([
        deps.db
          .select({ type: eventLog.type, stream: eventLog.stream, occurredAt: eventLog.occurredAt })
          .from(eventLog)
          .where(eq(eventLog.id, run.triggerEventId))
          .limit(1),
        deps.db
          .select({
            id: eventLog.id,
            seq: eventLog.seq,
            type: eventLog.type,
            stream: eventLog.stream,
            occurredAt: eventLog.occurredAt,
          })
          .from(eventLog)
          .where(
            and(
              eq(eventLog.schemeId, c.get("schemeId")),
              sql`${eventLog.actor}->>'agentRunId' = ${run.id}`,
              notLike(eventLog.stream, "agent_run:%"),
            ),
          )
          .orderBy(asc(eventLog.seq))
          .limit(50),
      ]);
      return c.json({ run, trigger: triggerRows[0] ?? null, effects });
    });
}
