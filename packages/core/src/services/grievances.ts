/**
 * P0-3 — Grievance / dispute module (OC Act Part 10; Model Rule 7).
 *
 * Every owners corporation must run an approved grievance procedure. A
 * complaint must be dealt with within 28 days of receipt (`meetByDate`);
 * unresolved matters escalate through a notice to rectify (s 155/156, 28-day
 * rectify clock), a final notice (s 157/158), and ultimately VCAT. Every state
 * change is recorded in `complaint_events` for the audit trail, and every
 * mutation publishes a domain event in the same transaction.
 */
import { breachNotices, complaintEvents, complaints, lots, people } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  addDays,
  BREACH_NOTICE_STATUSES,
  BREACH_NOTICE_TYPES,
  type BreachNoticeStatus,
  type BreachNoticeType,
  COMPLAINT_STATUSES,
  type ComplaintEventKind,
  type ComplaintStatus,
  toDateOnly,
} from "@goodstrata/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

export type Complaint = typeof complaints.$inferSelect;
export type BreachNotice = typeof breachNotices.$inferSelect;
export type ComplaintEvent = typeof complaintEvents.$inferSelect;

/** Statutory clock: complaints must be dealt with, and breaches rectified, within 28 days. */
const STATUTORY_DAYS = 28;

export const fileComplaintInput = z.object({
  /** Defaults to the filer's own person record when omitted (self-service intake). */
  complainantPersonId: z.string().uuid().optional(),
  respondentPersonId: z.string().uuid().optional(),
  subject: z.string().min(3).max(200),
  details: z.string().min(3).max(5000),
  approvedForm: z.boolean().default(false),
});
export type FileComplaintInput = z.infer<typeof fileComplaintInput>;

export const advanceComplaintInput = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  note: z.string().max(5000).optional(),
});
export type AdvanceComplaintInput = z.infer<typeof advanceComplaintInput>;

export const issueBreachNoticeInput = z
  .object({
    complaintId: z.string().uuid().optional(),
    subjectLotId: z.string().uuid().optional(),
    subjectPersonId: z.string().uuid().optional(),
    ruleRef: z.string().min(1),
    type: z.enum(BREACH_NOTICE_TYPES),
    details: z.string().min(3).max(5000),
  })
  .refine((v) => v.subjectLotId || v.subjectPersonId, {
    message: "A breach notice must name a subject lot or person",
  });
export type IssueBreachNoticeInput = z.infer<typeof issueBreachNoticeInput>;

/** Outcomes an issued breach notice may be closed with. */
export const BREACH_NOTICE_OUTCOMES = ["rectified", "escalated", "withdrawn"] as const;

export const closeBreachNoticeInput = z.object({
  status: z.enum(BREACH_NOTICE_OUTCOMES),
  note: z.string().max(5000).optional(),
});
export type CloseBreachNoticeInput = z.infer<typeof closeBreachNoticeInput>;

// ---------------------------------------------------------------------------
// Grievance state machine (received → … → resolved/withdrawn/vcat).
// ---------------------------------------------------------------------------

/** Which statuses a complaint may legally move to from each state. */
const ALLOWED_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  received: ["under_discussion", "resolved", "withdrawn"],
  under_discussion: ["notice_to_rectify", "resolved", "withdrawn", "vcat"],
  notice_to_rectify: ["final_notice", "resolved", "withdrawn", "vcat"],
  final_notice: ["vcat", "resolved", "withdrawn"],
  resolved: [],
  withdrawn: [],
  vcat: ["resolved", "withdrawn"],
};

/** Audit-trail kind recorded when a complaint enters a given status. */
const STATUS_EVENT_KIND: Record<ComplaintStatus, ComplaintEventKind> = {
  received: "filed",
  under_discussion: "discussion",
  notice_to_rectify: "notice_issued",
  final_notice: "notice_issued",
  resolved: "resolved",
  withdrawn: "withdrawn",
  vcat: "escalated",
};

/** Statuses that close out a complaint's active clock. */
const CLOSED_STATUSES: readonly ComplaintStatus[] = ["resolved", "withdrawn"];

/** Resolve the filer's person record in this scheme (self-service intake). */
async function personIdForActor(ctx: ServiceContext, schemeId: string): Promise<string> {
  if (ctx.actor.kind !== "user") {
    throw new DomainError(
      "ACTOR_NOT_PERSON",
      "Only a signed-in member can file a complaint on their own behalf",
      403,
    );
  }
  const person = await ctx.db.query.people.findFirst({
    where: and(eq(people.schemeId, schemeId), eq(people.userId, ctx.actor.id)),
  });
  if (!person) {
    const message =
      "Your login isn't linked to a person in this scheme — choose who the complaint is from";
    // Zod-issue-shaped details: the API envelope forwards `details` verbatim,
    // and form clients attach `{path, message}` issues to the matching input.
    throw new DomainError("NO_PERSON", message, 422, [{ path: ["complainantPersonId"], message }]);
  }
  return person.id;
}

async function assertPersonInScheme(ctx: ServiceContext, schemeId: string, personId: string) {
  const person = await ctx.db.query.people.findFirst({
    where: and(eq(people.id, personId), eq(people.schemeId, schemeId)),
  });
  if (!person) throw notFound("Person");
}

/**
 * File a complaint (approved-form intake). Sets receivedAt = now and
 * meetByDate = received + 28 days, records a `filed` complaint event, and
 * publishes `complaint.filed`.
 */
export async function fileComplaint(
  ctx: ServiceContext,
  schemeId: string,
  input: FileComplaintInput,
): Promise<Complaint> {
  const complainantPersonId = input.complainantPersonId ?? (await personIdForActor(ctx, schemeId));
  await assertPersonInScheme(ctx, schemeId, complainantPersonId);
  if (input.respondentPersonId) {
    await assertPersonInScheme(ctx, schemeId, input.respondentPersonId);
  }

  const now = ctx.clock.now();
  const meetByDate = toDateOnly(addDays(now, STATUTORY_DAYS));

  return await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .insert(complaints)
      .values({
        schemeId,
        complainantPersonId,
        respondentPersonId: input.respondentPersonId ?? null,
        subject: input.subject,
        details: input.details,
        approvedForm: input.approvedForm,
        status: "received",
        receivedAt: now,
        meetByDate,
      })
      .returning();
    const complaint = rows[0]!;

    await tx.insert(complaintEvents).values({
      complaintId: complaint.id,
      kind: "filed",
      actor: ctx.actor,
      note: input.approvedForm
        ? "Lodged on the owners corporation's approved grievance form."
        : "Lodged (not on the approved form).",
    });

    await publishEvent(tx, {
      schemeId,
      stream: `complaint:${complaint.id}`,
      type: "complaint.filed",
      payload: {
        complaintId: complaint.id,
        complainantPersonId,
        subject: complaint.subject,
        meetByDate,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return complaint;
  });
}

export async function listComplaints(ctx: ServiceContext, schemeId: string): Promise<Complaint[]> {
  return await ctx.db.query.complaints.findMany({
    where: eq(complaints.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.receivedAt),
  });
}

/**
 * Complaints lodged by the signed-in member (self-service tracking). Members
 * without a linked person record simply have nothing on file yet.
 */
export async function listMyComplaints(
  ctx: ServiceContext,
  schemeId: string,
): Promise<Complaint[]> {
  if (ctx.actor.kind !== "user") return [];
  const person = await ctx.db.query.people.findFirst({
    where: and(eq(people.schemeId, schemeId), eq(people.userId, ctx.actor.id)),
  });
  if (!person) return [];
  return await ctx.db.query.complaints.findMany({
    where: and(eq(complaints.schemeId, schemeId), eq(complaints.complainantPersonId, person.id)),
    orderBy: (t, { desc }) => desc(t.receivedAt),
  });
}

export async function getComplaint(
  ctx: ServiceContext,
  schemeId: string,
  complaintId: string,
): Promise<Complaint | null> {
  const complaint = await ctx.db.query.complaints.findFirst({
    where: and(eq(complaints.id, complaintId), eq(complaints.schemeId, schemeId)),
  });
  return complaint ?? null;
}

export interface ComplaintDetail {
  complaint: Complaint;
  events: ComplaintEvent[];
  breachNotices: BreachNotice[];
}

/** A complaint with its audit trail and any breach notices — for the detail view. */
export async function getComplaintDetail(
  ctx: ServiceContext,
  schemeId: string,
  complaintId: string,
): Promise<ComplaintDetail> {
  const complaint = await getComplaint(ctx, schemeId, complaintId);
  if (!complaint) throw notFound("Complaint");

  const events = await ctx.db.query.complaintEvents.findMany({
    where: eq(complaintEvents.complaintId, complaintId),
    orderBy: (t, { asc }) => asc(t.at),
  });
  const notices = await ctx.db.query.breachNotices.findMany({
    where: and(eq(breachNotices.schemeId, schemeId), eq(breachNotices.complaintId, complaintId)),
    orderBy: (t, { desc }) => desc(t.issuedAt),
  });

  return { complaint, events, breachNotices: notices };
}

/**
 * Transition a complaint's status (with the 28-day meet-and-discuss clock),
 * append an audit event, and publish `complaint.advanced`. Illegal jumps are
 * rejected; closing statuses stamp resolvedAt.
 */
export async function advanceComplaint(
  ctx: ServiceContext,
  schemeId: string,
  complaintId: string,
  input: AdvanceComplaintInput,
): Promise<Complaint> {
  return await ctx.db.transaction(async (tx) => {
    const complaint = await tx.query.complaints.findFirst({
      where: and(eq(complaints.id, complaintId), eq(complaints.schemeId, schemeId)),
    });
    if (!complaint) throw notFound("Complaint");

    const from = complaint.status;
    const to = input.status;
    if (from === to) {
      throw new DomainError("NO_CHANGE", `Complaint is already ${to}`, 409);
    }
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new DomainError(
        "INVALID_TRANSITION",
        `A complaint cannot move from ${from} to ${to}`,
        409,
      );
    }

    await tx
      .update(complaints)
      .set({
        status: to,
        resolvedAt: CLOSED_STATUSES.includes(to) ? ctx.clock.now() : complaint.resolvedAt,
      })
      .where(eq(complaints.id, complaintId));

    await tx.insert(complaintEvents).values({
      complaintId,
      kind: STATUS_EVENT_KIND[to],
      actor: ctx.actor,
      note: input.note ?? null,
    });

    await publishEvent(tx, {
      schemeId,
      stream: `complaint:${complaintId}`,
      type: "complaint.advanced",
      payload: { complaintId, fromStatus: from, toStatus: to },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    const updated = await tx.query.complaints.findFirst({
      where: eq(complaints.id, complaintId),
    });
    return updated!;
  });
}

/**
 * Issue a breach notice — a notice to rectify (s 155/156) or a final notice
 * (s 157/158). Sets rectifyByDate = issuedAt + 28 days, records the step on
 * any linked complaint's trail, and publishes `breach_notice.issued`.
 */
export async function issueBreachNotice(
  ctx: ServiceContext,
  schemeId: string,
  input: IssueBreachNoticeInput,
): Promise<BreachNotice> {
  if (input.subjectPersonId) {
    await assertPersonInScheme(ctx, schemeId, input.subjectPersonId);
  }
  if (input.subjectLotId) {
    const lot = await ctx.db.query.lots.findFirst({
      where: and(eq(lots.id, input.subjectLotId), eq(lots.schemeId, schemeId)),
    });
    if (!lot) throw notFound("Lot");
  }

  const now = ctx.clock.now();
  const rectifyByDate = toDateOnly(addDays(now, STATUTORY_DAYS));

  return await ctx.db.transaction(async (tx) => {
    if (input.complaintId) {
      const complaint = await tx.query.complaints.findFirst({
        where: and(eq(complaints.id, input.complaintId), eq(complaints.schemeId, schemeId)),
      });
      if (!complaint) throw notFound("Complaint");
    }

    const rows = await tx
      .insert(breachNotices)
      .values({
        schemeId,
        complaintId: input.complaintId ?? null,
        subjectLotId: input.subjectLotId ?? null,
        subjectPersonId: input.subjectPersonId ?? null,
        ruleRef: input.ruleRef,
        type: input.type,
        issuedAt: now,
        rectifyByDate,
        status: "issued",
        details: input.details,
      })
      .returning();
    const notice = rows[0]!;

    if (input.complaintId) {
      await tx.insert(complaintEvents).values({
        complaintId: input.complaintId,
        kind: "notice_issued",
        actor: ctx.actor,
        note: `${
          input.type === "final_notice" ? "Final notice" : "Notice to rectify"
        } issued (${input.ruleRef}); 28 days to comply.`,
      });
    }

    await publishEvent(tx, {
      schemeId,
      stream: `breach_notice:${notice.id}`,
      type: "breach_notice.issued",
      payload: {
        breachNoticeId: notice.id,
        complaintId: notice.complaintId,
        type: notice.type,
        ruleRef: notice.ruleRef,
        rectifyByDate,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return notice;
  });
}

/** Audit-trail kind recorded on a linked complaint when a notice closes. */
const NOTICE_OUTCOME_EVENT_KIND: Record<
  (typeof BREACH_NOTICE_OUTCOMES)[number],
  ComplaintEventKind
> = {
  rectified: "rectified",
  escalated: "escalated",
  withdrawn: "note",
};

/**
 * Close out an issued breach notice — rectified (complied within the 28 days),
 * escalated (to a final notice or VCAT), or withdrawn. Records the outcome on
 * any linked complaint's trail and publishes `breach_notice.closed`.
 */
export async function closeBreachNotice(
  ctx: ServiceContext,
  schemeId: string,
  breachNoticeId: string,
  input: CloseBreachNoticeInput,
): Promise<BreachNotice> {
  return await ctx.db.transaction(async (tx) => {
    const notice = await tx.query.breachNotices.findFirst({
      where: and(eq(breachNotices.id, breachNoticeId), eq(breachNotices.schemeId, schemeId)),
    });
    if (!notice) throw notFound("Breach notice");
    if (notice.status !== "issued") {
      throw new DomainError(
        "NOTICE_CLOSED",
        `This notice has already been marked ${notice.status}`,
        409,
      );
    }

    const rows = await tx
      .update(breachNotices)
      .set({ status: input.status as BreachNoticeStatus })
      .where(eq(breachNotices.id, breachNoticeId))
      .returning();
    const updated = rows[0]!;

    if (notice.complaintId) {
      const noticeName = notice.type === "final_notice" ? "Final notice" : "Notice to rectify";
      const outcome =
        input.status === "rectified"
          ? `${noticeName} (${notice.ruleRef}) marked rectified.`
          : input.status === "escalated"
            ? `${noticeName} (${notice.ruleRef}) escalated.`
            : `${noticeName} (${notice.ruleRef}) withdrawn.`;
      await tx.insert(complaintEvents).values({
        complaintId: notice.complaintId,
        kind: NOTICE_OUTCOME_EVENT_KIND[input.status],
        actor: ctx.actor,
        note: input.note ? `${outcome} ${input.note}` : outcome,
      });
    }

    await publishEvent(tx, {
      schemeId,
      stream: `breach_notice:${breachNoticeId}`,
      type: "breach_notice.closed",
      payload: {
        breachNoticeId,
        complaintId: notice.complaintId,
        fromStatus: notice.status,
        toStatus: input.status,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return updated;
  });
}

export async function listBreachNotices(
  ctx: ServiceContext,
  schemeId: string,
): Promise<BreachNotice[]> {
  return await ctx.db.query.breachNotices.findMany({
    where: eq(breachNotices.schemeId, schemeId),
    orderBy: (t, { desc }) => desc(t.issuedAt),
  });
}

// ---------------------------------------------------------------------------
// s 159 report — grievances handled in the period, for the AGM.
//
// s 159(1) requires the OC to report to the AGM the number and nature of
// complaints, actions taken, VCAT applications and outcomes. s 159(2): "The
// report must not identify the person who made a complaint or the lot owner
// or occupier alleged to have committed the breach."
//
// Anonymity is STRUCTURAL, not redactive: every report entry is built by
// picking a fixed set of non-identifying fields — date-only timestamps, enum
// statuses, audit-trail kinds, rule citations and report-local ref numbers.
// No complaint/notice row is ever spread into the report, and no person, lot
// or row id, subject line, details body or event note appears, so the
// artifact is safe to table at the AGM exactly as generated. The identified
// view the committee needs to actually handle a matter stays where it already
// lives: listComplaints / getComplaintDetail behind the officer-gated
// register — never in this report.
// ---------------------------------------------------------------------------

/** One complaint in the AGM report, de-identified per s 159(2). */
export interface S159ComplaintSummary {
  /** 1-based chronological position in this report — NOT the complaint id (row ids join back to people). */
  ref: number;
  receivedOn: string;
  status: ComplaintStatus;
  /** Whether it was lodged on the OC's approved grievance form (s 152(2)). */
  onApprovedForm: boolean;
  /** Audit-trail step kinds in order — the s 159(1) "actions taken". Kinds only; event notes are free text and may identify the parties. */
  actionsTaken: ComplaintEventKind[];
  resolvedOn: string | null;
}

/** One breach notice in the AGM report, de-identified per s 159(2). */
export interface S159BreachNoticeSummary {
  /** 1-based chronological position in this report — NOT the notice id. */
  ref: number;
  /** Report-local ref of the linked complaint when it falls in the period. */
  complaintRef: number | null;
  type: BreachNoticeType;
  /** The contravened rule citation (e.g. "Model Rule 4.1") — the "nature" of the alleged breach. A citation, never a narrative. */
  ruleRef: string;
  issuedOn: string;
  rectifyByDate: string;
  status: BreachNoticeStatus;
}

export interface S159Report {
  schemeId: string;
  periodStart: string | null;
  periodEnd: string;
  generatedAt: string;
  complaints: {
    total: number;
    resolved: number;
    unresolved: number;
    byStatus: Record<ComplaintStatus, number>;
    items: S159ComplaintSummary[];
  };
  breachNotices: {
    total: number;
    byType: Record<BreachNoticeType, number>;
    byStatus: Record<BreachNoticeStatus, number>;
    items: S159BreachNoticeSummary[];
  };
}

/**
 * The s 159 grievance report for the AGM: complaints and breach notices dealt
 * with in the period (defaults to all-time when no window is given), with
 * both parties de-identified per s 159(2) — see the section comment above for
 * how anonymity is guaranteed structurally. Exposed here; wiring it into the
 * AGM agenda is a later item.
 */
/**
 * Resolve an AGM reporting window to millisecond bounds. A date-only `to`
 * (YYYY-MM-DD) parses to that day's MIDNIGHT; a `t > toMs` comparison would then
 * drop every complaint/breach recorded later on the last day of the period.
 * Extend a date-only upper bound to the END of that day so the window is
 * inclusive of its final calendar day; leave explicit timestamps untouched.
 */
export function s159WindowBounds(period?: { from?: string; to?: string }): {
  fromMs: number | null;
  toMs: number | null;
} {
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  const END_OF_DAY_MS = 24 * 60 * 60 * 1000 - 1;
  return {
    fromMs: period?.from ? new Date(period.from).getTime() : null,
    toMs: period?.to
      ? new Date(period.to).getTime() + (DATE_ONLY.test(period.to) ? END_OF_DAY_MS : 0)
      : null,
  };
}

export async function generateS159Report(
  ctx: ServiceContext,
  schemeId: string,
  period?: { from?: string; to?: string },
): Promise<S159Report> {
  const { fromMs, toMs } = s159WindowBounds(period);

  const inWindow = (at: Date | null): boolean => {
    if (!at) return false;
    const t = at.getTime();
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  };

  const allComplaints = await listComplaints(ctx, schemeId);
  const allNotices = await listBreachNotices(ctx, schemeId);

  // Chronological order so report refs read as a timeline ("Complaint 1" was
  // received first in the period).
  const scopedComplaints = allComplaints
    .filter((c) => inWindow(c.receivedAt))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const scopedNotices = allNotices
    .filter((n) => inWindow(n.issuedAt))
    .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());

  // Audit-trail kinds per complaint — the s 159(1) "actions taken". Kinds
  // only: notes are officer-written free text and are never read here.
  const events = scopedComplaints.length
    ? await ctx.db.query.complaintEvents.findMany({
        where: inArray(
          complaintEvents.complaintId,
          scopedComplaints.map((c) => c.id),
        ),
        orderBy: (t, { asc }) => asc(t.at),
      })
    : [];
  const actionsByComplaint = new Map<string, ComplaintEventKind[]>();
  for (const e of events) {
    const kinds = actionsByComplaint.get(e.complaintId) ?? [];
    kinds.push(e.kind as ComplaintEventKind);
    actionsByComplaint.set(e.complaintId, kinds);
  }

  const byStatus = Object.fromEntries(COMPLAINT_STATUSES.map((s) => [s, 0])) as Record<
    ComplaintStatus,
    number
  >;
  for (const c of scopedComplaints) byStatus[c.status] += 1;

  const resolved = byStatus.resolved;
  const unresolved = scopedComplaints.length - resolved - byStatus.withdrawn;

  // Explicit field picks (never a row spread): this closed set of
  // non-identifying fields IS the s 159(2) guarantee.
  const complaintRefById = new Map(scopedComplaints.map((c, i) => [c.id, i + 1]));
  const complaintItems: S159ComplaintSummary[] = scopedComplaints.map((c, i) => ({
    ref: i + 1,
    receivedOn: toDateOnly(c.receivedAt),
    status: c.status,
    onApprovedForm: c.approvedForm,
    actionsTaken: actionsByComplaint.get(c.id) ?? [],
    resolvedOn: c.resolvedAt ? toDateOnly(c.resolvedAt) : null,
  }));

  const noticesByType = Object.fromEntries(BREACH_NOTICE_TYPES.map((t) => [t, 0])) as Record<
    BreachNoticeType,
    number
  >;
  const noticesByStatus = Object.fromEntries(BREACH_NOTICE_STATUSES.map((s) => [s, 0])) as Record<
    BreachNoticeStatus,
    number
  >;
  for (const n of scopedNotices) {
    noticesByType[n.type] += 1;
    noticesByStatus[n.status] += 1;
  }
  const noticeItems: S159BreachNoticeSummary[] = scopedNotices.map((n, i) => ({
    ref: i + 1,
    complaintRef: n.complaintId ? (complaintRefById.get(n.complaintId) ?? null) : null,
    type: n.type,
    ruleRef: n.ruleRef,
    issuedOn: toDateOnly(n.issuedAt),
    rectifyByDate: n.rectifyByDate,
    status: n.status,
  }));

  return {
    schemeId,
    periodStart: period?.from ?? null,
    periodEnd: period?.to ?? toDateOnly(ctx.clock.now()),
    generatedAt: ctx.clock.now().toISOString(),
    complaints: {
      total: scopedComplaints.length,
      resolved,
      unresolved,
      byStatus,
      items: complaintItems,
    },
    breachNotices: {
      total: scopedNotices.length,
      byType: noticesByType,
      byStatus: noticesByStatus,
      items: noticeItems,
    },
  };
}
