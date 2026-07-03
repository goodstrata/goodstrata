import { CHAIR_NOTE_KINDS } from "@goodstrata/shared";
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
  "maintenance.request.created": z.object({
    requestId: z.string(),
    title: z.string(),
    description: z.string(),
    lotId: z.string().nullable(),
  }),
  "maintenance.request.triaged": z.object({
    requestId: z.string(),
    category: z.string(),
    urgency: z.string(),
    isCommonProperty: z.boolean(),
  }),
  "quote.received": lax,
  "work_order.created": z.object({
    workOrderId: z.string(),
    requestId: z.string().nullable(),
    contractorId: z.string(),
    amountCents: z.number().int(),
  }),
  "work_order.dispatched": z.object({ workOrderId: z.string(), contractorId: z.string() }),
  "work_order.completed": z.object({ workOrderId: z.string() }),

  // meetings / governance
  "meeting.scheduled": z.object({
    meetingId: z.string(),
    kind: z.string(),
    title: z.string(),
    scheduledAt: z.string(),
  }),
  "meeting.notice.issued": z.object({
    meetingId: z.string(),
    recipients: z.number().int(),
  }),
  "meeting.closed": z.object({
    meetingId: z.string(),
    quorumMet: z.boolean(),
    /** Stored transcript document, when the video meeting was transcribed. */
    transcriptDocumentId: z.string().nullable().optional(),
  }),
  "motion.opened": z.object({ motionId: z.string(), resolutionType: z.string() }),
  "proxy.submitted": z.object({
    proxyId: z.string(),
    lotId: z.string(),
    proxyPersonId: z.string(),
  }),
  "vote.cast": z.object({
    motionId: z.string(),
    lotId: z.string(),
    choice: z.string(),
    entitlementWeight: z.number().int(),
    viaProxy: z.boolean(),
  }),
  "motion.resolved": z.object({
    motionId: z.string(),
    carried: z.boolean(),
    forWeight: z.number().int(),
    againstWeight: z.number().int(),
    abstainWeight: z.number().int(),
  }),
  "minutes.drafted": z.object({ meetingId: z.string(), documentId: z.string() }),
  "meeting.video.started": z.object({ meetingId: z.string(), url: z.string() }),
  /** Synthetic clock tick: the conductor loop publishes one per interval while
   *  the meeting is in progress; the chair agent runs off it. */
  "meeting.conduct.tick": z.object({ meetingId: z.string(), tick: z.number().int().min(1) }),
  /** A note the AI chair posted (also appended to meetings.chair_log). */
  "meeting.chair.note": z.object({
    meetingId: z.string(),
    kind: z.enum(CHAIR_NOTE_KINDS),
    note: z.string(),
  }),

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

  // community board
  "community.post.created": z.object({
    postId: z.string(),
    authorUserId: z.string(),
    imageCount: z.number().int(),
  }),
  "community.post.removed": z.object({ postId: z.string(), removedBy: z.string() }),
  "community.comment.created": z.object({
    commentId: z.string(),
    postId: z.string(),
    authorUserId: z.string(),
  }),
  "community.comment.removed": z.object({
    commentId: z.string(),
    postId: z.string(),
    removedBy: z.string(),
  }),
  /** active=true is a like, false an unlike — one event covers both toggle directions. */
  "community.post.reacted": z.object({
    postId: z.string(),
    userId: z.string(),
    reaction: z.string(),
    active: z.boolean(),
  }),
  "community.comment.reacted": z.object({
    commentId: z.string(),
    postId: z.string(),
    userId: z.string(),
    reaction: z.string(),
    active: z.boolean(),
  }),

  "notification.created": z.object({
    notificationId: z.string(),
    userId: z.string(),
    title: z.string(),
    category: z.string(),
  }),

  // decisions (the human gate)
  "decision.requested": z.object({
    decisionId: z.string(),
    kind: z.string(),
    title: z.string(),
    deciderRole: z.string(),
  }),
  "decision.vote.cast": z.object({
    decisionId: z.string(),
    choice: z.enum(["approve", "decline"]),
    votesFor: z.number().int(),
    votesAgainst: z.number().int(),
    eligible: z.number().int(),
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
