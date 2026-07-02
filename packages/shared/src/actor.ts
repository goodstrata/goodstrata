import { z } from "zod";

/** Who performed an action — stamped on every event. */
export const actorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), id: z.string() }),
  z.object({
    kind: z.literal("agent"),
    id: z.string(), // agent name
    agentRunId: z.string(),
  }),
  z.object({ kind: z.literal("system"), id: z.string() }), // e.g. "cron.arrears.daily"
]);

export type Actor = z.infer<typeof actorSchema>;

export const systemActor = (id: string): Actor => ({ kind: "system", id });
export const userActor = (id: string): Actor => ({ kind: "user", id });
export const agentActor = (name: string, agentRunId: string): Actor => ({
  kind: "agent",
  id: name,
  agentRunId,
});
