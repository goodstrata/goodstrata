import { z } from "zod";

/**
 * The typed event catalog. Every event written to event_log has a type listed
 * here; types with a schema get their payload validated at publish time.
 * Schemas are added as each domain slice lands — an entry of `z.unknown()`
 * means "defined but not yet strictly modelled".
 */

const lax = z.unknown();

export const eventDefs = {
  // tenancy / onboarding
  "scheme.created": z.object({
    name: z.string(),
    planOfSubdivision: z.string(),
    tier: z.number().int(),
  }),
  "scheme.activated": z.object({}),
  "lot.created": z.object({
    lotNumber: z.string(),
    entitlement: z.number().int(),
    liability: z.number().int(),
  }),
  "lots.imported": z.object({ count: z.number().int() }),
  "owner.invited": z.object({ personId: z.string(), email: z.string() }),
  "owner.joined": z.object({ personId: z.string(), userId: z.string() }),
  "committee.assigned": z.object({ userId: z.string(), role: z.string() }),

  // finance
  "budget.drafted": lax,
  "budget.adopted": lax,
  "levy.period.opened": lax,
  "levy.notice.issued": lax,
  "levy.notice.overdue": lax,
  "payment.received": lax,
  "payment.matched": lax,
  "payment.unmatched": lax,
  "receipt.issued": lax,
  "arrears.stage.reached": lax,
  "invoice.received": lax,
  "invoice.approved": lax,
  "payout.executed": lax,

  // maintenance
  "maintenance.request.created": lax,
  "maintenance.request.triaged": lax,
  "quote.received": lax,
  "work_order.created": lax,
  "work_order.dispatched": lax,
  "work_order.completed": lax,

  // meetings / governance
  "meeting.scheduled": lax,
  "meeting.notice.issued": lax,
  "proxy.submitted": lax,
  "vote.cast": lax,
  "motion.resolved": lax,
  "minutes.drafted": lax,

  // documents / compliance / comms
  "document.uploaded": lax,
  "document.classified": lax,
  "compliance.item.due": lax,
  "message.sent": lax,
  "announcement.published": lax,

  // decisions (the human gate)
  "decision.requested": z.object({
    decisionId: z.string(),
    kind: z.string(),
    title: z.string(),
    deciderRole: z.string(),
  }),
  "decision.resolved": z.object({
    decisionId: z.string(),
    optionId: z.string(),
    resolvedBy: z.string(), // userId | "system-default"
  }),
  "decision.escalated": z.object({ decisionId: z.string(), newDeciderRole: z.string() }),
  "decision.expired": z.object({ decisionId: z.string() }),

  // agent spine
  "agent.run.completed": z.object({
    agentRunId: z.string(),
    agent: z.string(),
    status: z.string(),
  }),
  "agent.run.failed": z.object({ agentRunId: z.string(), agent: z.string(), error: z.string() }),
  "agent.loop.suppressed": z.object({
    eventId: z.string(),
    type: z.string(),
    causationDepth: z.number().int(),
  }),
} as const;

export type EventType = keyof typeof eventDefs;

export const eventTypes = Object.keys(eventDefs) as EventType[];

export function isKnownEventType(type: string): type is EventType {
  return type in eventDefs;
}

export function validatePayload(type: string, payload: unknown): unknown {
  if (!isKnownEventType(type)) {
    throw new Error(`Unknown event type: ${type}`);
  }
  return eventDefs[type].parse(payload);
}
