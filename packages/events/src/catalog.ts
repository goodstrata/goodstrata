import { ANNOUNCEMENT_AUDIENCES, CHAIR_NOTE_KINDS, COMMENT_ENTITY_TYPES } from "@goodstrata/shared";
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
  // ownership register (transfers end-date the old row and start a new one)
  "ownership.started": z.object({
    ownershipId: z.string(),
    lotId: z.string(),
    personId: z.string(),
    kind: z.string(),
    shareNumerator: z.number().int(),
    shareDenominator: z.number().int(),
    isLevyRecipient: z.boolean(),
    startedOn: z.string(),
  }),
  "ownership.ended": z.object({
    ownershipId: z.string(),
    lotId: z.string(),
    personId: z.string(),
    endedOn: z.string(),
    /** Remaining owner promoted to levy recipient when the ended row held it. */
    promotedLevyRecipientOwnershipId: z.string().nullable(),
  }),
  /** Correction of a current ownership's kind or share (period unchanged). */
  "ownership.updated": z.object({
    ownershipId: z.string(),
    lotId: z.string(),
    personId: z.string(),
    kind: z.string(),
    shareNumerator: z.number().int(),
    shareDenominator: z.number().int(),
  }),
  /** The lot's levy-notice recipient moved to a different current owner. */
  "lot.levy_recipient.changed": z.object({
    lotId: z.string(),
    ownershipId: z.string(),
    personId: z.string(),
    previousOwnershipId: z.string().nullable(),
  }),

  // finance
  /** A scheme's own segregated trust/collection account was provisioned (s 122). */
  "trust_account.provisioned": z.object({
    bankAccountId: z.string(),
    kind: z.string(),
    provider: z.string(),
    providerAccountId: z.string().nullable(),
  }),
  /**
   * Provider account provisioning failed; a PENDING account was recorded so
   * the money loop keeps working on the manual rail. Retried on next ensure.
   */
  "trust_account.provision_deferred": z.object({
    bankAccountId: z.string(),
    kind: z.string(),
    provider: z.string(),
    providerAccountId: z.string().nullable(),
  }),
  "budget.drafted": z.object({
    budgetId: z.string(),
    fiscalYearStart: z.string(),
    totalCents: z.number().int(),
  }),
  "budget.adopted": z.object({ budgetId: z.string() }),
  /** A levy instalment run opened: notices for every lot are about to issue. */
  "levy.period.opened": z.object({
    levyScheduleId: z.string(),
    budgetId: z.string(),
    instalment: z.number().int(),
    dueOn: z.string(),
    noticeCount: z.number().int(),
  }),
  "levy.notice.issued": z.object({
    levyNoticeId: z.string(),
    lotId: z.string(),
    noticeNumber: z.string(),
    totalCents: z.number().int(),
    dueOn: z.string(),
    payid: z.string().nullable(),
  }),
  "levy.notice.overdue": z.object({ levyNoticeId: z.string(), lotId: z.string() }),
  /**
   * A treasurer/officer wrote off an uncollectible levy notice. The balancing
   * ledger adjustment is posted in the same transaction.
   */
  "levy.notice.written_off": z.object({
    levyNoticeId: z.string(),
    lotId: z.string(),
    noticeNumber: z.string(),
    writtenOffCents: z.number().int(),
    /** Stranded penalty interest cleared alongside (0 when none). */
    interestWrittenOffCents: z.number().int(),
    reason: z.string(),
  }),
  "payment.received": z.object({
    paymentId: z.string(),
    amountCents: z.number().int(),
    payid: z.string().nullable(),
    /** Set for treasurer-recorded bank transfers ("manual"). */
    rail: z.string().optional(),
  }),
  "payment.matched": z.object({
    paymentId: z.string(),
    levyNoticeId: z.string(),
    /** "manual" = a treasurer matched/recorded it by hand. */
    via: z.enum(["payid", "amount", "manual"]),
    amountCents: z.number().int(),
  }),
  "payment.unmatched": z.object({
    paymentId: z.string(),
    reason: z.string(),
    amountCents: z.number().int().optional(),
    payid: z.string().nullable().optional(),
  }),
  "receipt.issued": z.object({
    receiptId: z.string(),
    paymentId: z.string(),
    receiptNumber: z.string(),
  }),
  /**
   * A recorded payment was refunded/reversed: allocations, lot-ledger credits
   * and fund splits are reversed in the same transaction.
   */
  "payment.refunded": z.object({
    paymentId: z.string(),
    amountCents: z.number().int(),
    reason: z.string(),
    /** Notices whose allocations were reversed (empty for a parked payment). */
    levyNoticeIds: z.array(z.string()),
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
  /**
   * The daily sweep posted accrued penalty interest to a lot's ledger. The
   * ledger entry (kind "interest") is inserted in the same transaction; the
   * dedupeKey makes the posting once-per-lot-per-day.
   */
  "arrears.interest.posted": z.object({
    lotId: z.string(),
    /** The increment posted by this sweep. */
    amountCents: z.number().int(),
    /** Cumulative interest posted for the current arrears episode. */
    totalInterestPostedCents: z.number().int(),
    daysOverdue: z.number().int(),
    earliestDueOn: z.string(),
  }),
  /** A supplier invoice landed in accounts payable (approval gate opens next). */
  "invoice.received": z.object({
    invoiceId: z.string(),
    supplierName: z.string(),
    invoiceNumber: z.string(),
    amountCents: z.number().int(),
    gstCents: z.number().int(),
    fundKind: z.string(),
    workOrderId: z.string().nullable(),
  }),
  /** The treasurer approved the invoice; a payout was queued by the executor. */
  "invoice.approved": z.object({
    invoiceId: z.string(),
    decisionId: z.string(),
    payoutId: z.string(),
    amountCents: z.number().int(),
  }),
  /** A payout was executed and recorded (manual rail: bank reference + date). */
  "payout.executed": z.object({
    payoutId: z.string(),
    invoiceId: z.string(),
    amountCents: z.number().int(),
    provider: z.string(),
    providerRef: z.string().nullable(),
    fundKind: z.string(),
  }),

  // maintenance
  "maintenance.request.created": z.object({
    requestId: z.string(),
    title: z.string(),
    description: z.string(),
    lotId: z.string().nullable(),
    /** Human origin: the reporter flagged this an emergency at creation. */
    reportedEmergency: z.boolean().optional(),
  }),
  "maintenance.request.triaged": z.object({
    requestId: z.string(),
    category: z.string(),
    urgency: z.string(),
    isCommonProperty: z.boolean(),
  }),
  // trade market (RFQ → quotes → human award)
  "rfq.created": z.object({
    rfqId: z.string(),
    requestId: z.string(),
    title: z.string(),
    category: z.string(),
  }),
  "rfq.spec_drafted": z.object({ rfqId: z.string(), title: z.string(), category: z.string() }),
  /** An open RFQ abandoned — releases the request to be tendered again. */
  "rfq.cancelled": z.object({
    rfqId: z.string(),
    requestId: z.string(),
    reason: z.string().nullable(),
  }),
  "rfq.dispatched": z.object({
    rfqId: z.string(),
    providers: z.array(z.string()),
    channelsSent: z.number().int(),
    channelsFailed: z.number().int(),
  }),
  "rfq.channel.sent": z.object({
    rfqId: z.string(),
    channelId: z.string(),
    provider: z.string(),
    contractorId: z.string().nullable(),
  }),
  "rfq.channel.failed": z.object({
    rfqId: z.string(),
    channelId: z.string(),
    provider: z.string(),
    error: z.string(),
  }),
  // ZERO HIDDEN MARGIN: fee fields are required on the wire — a quote event
  // that omits them fails validation at publish time.
  "quote.received": z.object({
    quoteId: z.string(),
    rfqId: z.string(),
    contractorId: z.string(),
    amountCents: z.number().int(),
    platformFeeCents: z.number().int(),
    referralFeeCents: z.number().int(),
    feeRecipient: z.string().nullable(),
  }),
  "rfq.awarded": z.object({
    rfqId: z.string(),
    quoteId: z.string(),
    workOrderId: z.string(),
    contractorId: z.string(),
    amountCents: z.number().int(),
    platformFeeCents: z.number().int(),
    referralFeeCents: z.number().int(),
    feeRecipient: z.string().nullable(),
  }),
  "work_order.created": z.object({
    workOrderId: z.string(),
    requestId: z.string().nullable(),
    contractorId: z.string(),
    amountCents: z.number().int(),
  }),
  "work_order.dispatched": z.object({ workOrderId: z.string(), contractorId: z.string() }),
  // Contractor self-service accept/decline (public /work-order/{token} page).
  "work_order.accepted": z.object({ workOrderId: z.string(), contractorId: z.string() }),
  "work_order.declined": z.object({ workOrderId: z.string(), contractorId: z.string() }),
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
  /** The AI chair proposed closing a motion; a human officer runs the tally. */
  "motion.close.proposed": z.object({
    motionId: z.string(),
    meetingId: z.string().nullable(),
    title: z.string(),
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
  /** An owner proposed a motion/agenda item for an upcoming meeting (pending officer review). */
  "agenda_item.submitted": z.object({
    agendaItemId: z.string(),
    meetingId: z.string(),
    title: z.string(),
    submittedByPersonId: z.string(),
  }),
  /** An officer accepted a pending submission — now a real agenda item + draft motion. */
  "agenda_item.accepted": z.object({
    agendaItemId: z.string(),
    meetingId: z.string(),
    motionId: z.string(),
    submittedByPersonId: z.string().nullable(),
  }),
  /** An officer rejected a pending submission (reason recorded; submitter notified). */
  "agenda_item.rejected": z.object({
    agendaItemId: z.string(),
    meetingId: z.string(),
    reason: z.string(),
    submittedByPersonId: z.string().nullable(),
  }),

  // documents / compliance / comms
  "document.uploaded": lax,
  "document.classified": lax,
  /** A replacement revision was uploaded; the old row/object stay behind as the audit trail. */
  "document.superseded": z.object({
    /** The old (now superseded) document. */
    documentId: z.string(),
    supersededByDocumentId: z.string(),
    category: z.string(),
    title: z.string(),
  }),
  /** An officer soft-deleted the document; the row survives for retention/audit. */
  "document.deleted": z.object({
    documentId: z.string(),
    category: z.string(),
    title: z.string(),
  }),
  /** The retention sweep deleted the stored object and de-identified the row. */
  "document.retention.purged": z.object({
    documentId: z.string(),
    category: z.string(),
    retentionUntil: z.string(),
  }),
  "compliance.item.due": lax,
  /** An obligation was raised on the compliance calendar (idempotent per dedupeKey). */
  "compliance.obligation.raised": z.object({
    obligationId: z.string(),
    kind: z.string(),
    schemeId: z.string().nullable(),
    organizationId: z.string().nullable(),
    subjectRef: z.string().nullable(),
    dueOn: z.string(),
    periodKey: z.string().nullable(),
  }),
  /** The sweep moved an obligation into a notifying band (t_90/t_60/t_30/due/overdue). */
  "compliance.obligation.due": z.object({
    obligationId: z.string(),
    kind: z.string(),
    dueOn: z.string(),
    status: z.string(),
    escalationState: z.string(),
    responsibleRole: z.string().nullable(),
    schemeId: z.string().nullable(),
    organizationId: z.string().nullable(),
  }),
  /** An obligation was satisfied (or waived). */
  "compliance.obligation.completed": z.object({
    obligationId: z.string(),
    kind: z.string(),
    status: z.string(),
  }),
  "message.sent": z.object({
    messageId: z.string(),
    channel: z.string(),
    to: z.string(),
    subject: z.string().nullable(),
    template: z.string().nullable(),
  }),
  /** A committee notice went out; the notifier fans it out to the audience. */
  "announcement.published": z.object({
    id: z.string(),
    schemeId: z.string(),
    title: z.string(),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    /** Full body — the notifier's email carries it without a re-read. */
    body: z.string(),
  }),

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

  // entity comment threads (maintenance requests / complaints)
  "entity.comment.created": z.object({
    commentId: z.string(),
    entityType: z.enum(COMMENT_ENTITY_TYPES),
    entityId: z.string(),
    authorUserId: z.string(),
  }),
  "entity.comment.removed": z.object({
    commentId: z.string(),
    entityType: z.enum(COMMENT_ENTITY_TYPES),
    entityId: z.string(),
    removedBy: z.string(),
  }),

  // private messaging (DM threads — conversations in schema/messaging.ts)
  /** A message was sent into a private conversation (covers the first message at creation). */
  "conversation.message.sent": z.object({
    conversationId: z.string(),
    messageId: z.string(),
    senderUserId: z.string(),
  }),

  "notification.created": z.object({
    notificationId: z.string(),
    userId: z.string(),
    title: z.string(),
    category: z.string(),
  }),

  // grievances / disputes (OC Act Part 10 — grievance procedure)
  "complaint.filed": z.object({
    complaintId: z.string(),
    complainantPersonId: z.string(),
    subject: z.string(),
    meetByDate: z.string(),
  }),
  "complaint.advanced": z.object({
    complaintId: z.string(),
    fromStatus: z.string(),
    toStatus: z.string(),
  }),
  "breach_notice.issued": z.object({
    breachNoticeId: z.string(),
    complaintId: z.string().nullable(),
    type: z.string(),
    ruleRef: z.string(),
    rectifyByDate: z.string(),
  }),
  "breach_notice.closed": z.object({
    breachNoticeId: z.string(),
    complaintId: z.string().nullable(),
    fromStatus: z.string(),
    toStatus: z.string(),
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
