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
  "budget.drafted": z.object({
    budgetId: z.string(),
    fiscalYearStart: z.string(),
    totalCents: z.number().int(),
  }),
  "budget.adopted": z.object({ budgetId: z.string() }),
  "levy.period.opened": lax,
  "levy.notice.issued": z.object({
    levyNoticeId: z.string(),
    lotId: z.string(),
    noticeNumber: z.string(),
    totalCents: z.number().int(),
    dueOn: z.string(),
    payid: z.string().nullable(),
  }),
  "levy.notice.overdue": z.object({ levyNoticeId: z.string(), lotId: z.string() }),
  "payment.received": z.object({
    paymentId: z.string(),
    amountCents: z.number().int(),
    payid: z.string().nullable(),
  }),
  "payment.matched": z.object({
    paymentId: z.string(),
    levyNoticeId: z.string(),
    via: z.enum(["payid", "amount"]),
    amountCents: z.number().int(),
  }),
  "payment.unmatched": z.object({ paymentId: z.string(), reason: z.string() }),
  "receipt.issued": z.object({
    receiptId: z.string(),
    paymentId: z.string(),
    receiptNumber: z.string(),
  }),
  "arrears.stage.reached": z.object({
    lotId: z.string(),
    stage: z.number().int().min(1).max(4),
    kind: z.string(),
    daysOverdue: z.number().int(),
    outstandingCents: z.number().int(),
    interestAccruedCents: z.number().int(),
    /** Anchors the arrears episode: a new earliest-due date restarts the ladder. */
    earliestDueOn: z.string(),
  }),
  "arrears.recovery.commenced": z.object({ lotId: z.string(), decisionId: z.string() }),
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
  "message.sent": z.object({
    messageId: z.string(),
    channel: z.string(),
    to: z.string(),
    subject: z.string().nullable(),
    template: z.string().nullable(),
  }),
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
