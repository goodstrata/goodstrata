import type { Database } from "@goodstrata/db";
import { type DispatchJobData, loadEvent } from "@goodstrata/events";
import type { PgBoss } from "pg-boss";
import { agentQueue } from "./registry.js";
import { type RuntimeDeps, runAgent } from "./runtime.js";
import type { AgentDefinition } from "./types.js";

/**
 * Register one pg-boss worker per agent. Queues are created by the dispatcher
 * (it owns queue setup); handlers re-read the event row from the log.
 */
export async function registerAgentWorkers(
  boss: PgBoss,
  db: Database,
  deps: RuntimeDeps,
  agents: AgentDefinition[],
  onOutcome?: (agent: string, outcome: Awaited<ReturnType<typeof runAgent>>) => void,
): Promise<void> {
  for (const def of agents) {
    await boss.work(agentQueue(def.name), async (jobs) => {
      for (const job of jobs) {
        const data = job.data as DispatchJobData;
        const event = await loadEvent(db, data.eventId);
        if (!event) throw new Error(`event ${data.eventId} not found`);
        const outcome = await runAgent(deps, def, event);
        onOutcome?.(def.name, outcome);
      }
    });
  }
}
