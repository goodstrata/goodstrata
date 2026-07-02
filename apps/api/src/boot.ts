import {
  agentSubscriptions,
  allAgents,
  type RuntimeDeps,
  registerAgentWorkers,
} from "@goodstrata/agents";
import { EventDispatcher } from "@goodstrata/events";
import { PgBoss } from "pg-boss";
import type { AppDeps } from "./deps.js";

export interface BackgroundServices {
  boss: PgBoss;
  dispatcher: EventDispatcher;
  stop(): Promise<void>;
}

/**
 * Start the background machinery: pg-boss, the event dispatcher, and one
 * worker per agent. Runs in-process with the API by default (self-host floor:
 * one Node process); a split deployment can call this from a separate entry.
 */
export async function startBackground(deps: AppDeps): Promise<BackgroundServices> {
  const boss = new PgBoss({ connectionString: deps.env.DATABASE_URL });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();

  const dispatcher = new EventDispatcher({
    db: deps.db,
    boss,
    connectionString: deps.env.DATABASE_URL,
    subscriptions: agentSubscriptions(allAgents),
  });
  await dispatcher.start();

  const runtimeDeps: RuntimeDeps = {
    resolveModel: deps.resolveModel,
    serviceContext: deps.serviceContext,
  };
  await registerAgentWorkers(boss, deps.db, runtimeDeps, allAgents, (agent, outcome) => {
    if (outcome.kind === "ran") {
      console.log(`[agent:${agent}] run ${outcome.runId} → ${outcome.status}`);
    }
  });

  return {
    boss,
    dispatcher,
    stop: async () => {
      await dispatcher.stop();
      await boss.stop({ graceful: true });
    },
  };
}
