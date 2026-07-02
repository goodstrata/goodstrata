import type { Subscription } from "@goodstrata/events";
import { chairAgent } from "./agents/chair.js";
import { echoAgent } from "./agents/echo.js";
import { financeAgent } from "./agents/finance.js";
import { maintenanceAgent } from "./agents/maintenance.js";
import { meetingsAgent } from "./agents/meetings.js";
import type { AgentDefinition } from "./types.js";

export const allAgents: AgentDefinition[] = [
  chairAgent,
  echoAgent,
  financeAgent,
  maintenanceAgent,
  meetingsAgent,
];

export function agentQueue(name: string): string {
  return `agent.run.${name}`;
}

/** Build dispatcher subscriptions for a set of agents (with the self-event guard). */
export function agentSubscriptions(agents: AgentDefinition[] = allAgents): Subscription[] {
  return agents.map((agent) => ({
    name: `agent.${agent.name}`,
    queue: agentQueue(agent.name),
    types: agent.subscribedEvents,
    enforceDepthCap: true,
    filter: (evt) => {
      if (evt.actor.kind === "agent" && evt.actor.id === agent.name) {
        return agent.selfTriggers?.includes(evt.type) ?? false;
      }
      return true;
    },
  }));
}
