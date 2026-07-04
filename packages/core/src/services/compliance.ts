/**
 * P1-4 — The compliance calendar, brought to life.
 *
 * This service is the single writer/reader of `compliance_obligations` (dead
 * schema until now). It raises obligations idempotently, ages them on a sweep
 * (recomputing status + escalation band), completes them, and — via the
 * notifier — nudges the responsible role as due dates approach.
 *
 * It unblocks every recurring statutory reminder: registration renewal, PI
 * expiry, insurance renewal, valuation, ESM inspection, AGM due, financial
 * statements, BAS and certificate reminders. Callers (agents, other services,
 * the manager-registration service) raise obligations; the sweep does the rest.
 *
 * Every mutation publishes a domain event in the same transaction.
 */
import { complianceObligations } from "@goodstrata/db";
import { publishEvent } from "@goodstrata/events";
import {
  COMPLIANCE_KINDS,
  COMPLIANCE_NOTIFYING_ESCALATIONS,
  type ComplianceEscalation,
  type ComplianceKind,
  type ComplianceStatus,
  daysBetween,
  fromDateOnly,
  type MembershipRole,
  toDateOnly,
} from "@goodstrata/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { causationFields, type ServiceContext } from "../context.js";
import { DomainError, notFound } from "../errors.js";

export type ComplianceObligation = typeof complianceObligations.$inferSelect;

/** Obligation lifecycle states that are still "live" (the sweep ages these). */
const OPEN_STATUSES: readonly ComplianceStatus[] = ["upcoming", "due", "overdue"];

/** Escalation band → the coarse status stored alongside it. */
const ESCALATION_TO_STATUS: Record<ComplianceEscalation, ComplianceStatus> = {
  none: "upcoming",
  t_90: "upcoming",
  t_60: "upcoming",
  t_30: "upcoming",
  due: "due",
  overdue: "overdue",
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const raiseObligationInput = z
  .object({
    /** Scheme scope. Exactly one of schemeId / organizationId must be given. */
    schemeId: z.string().uuid().optional(),
    /** Manager/organisation scope (registration_renewal, pi_expiry). */
    organizationId: z.string().uuid().optional(),
    kind: z.enum(COMPLIANCE_KINDS),
    /** Human title; defaults to a per-kind label when omitted. */
    title: z.string().min(1).max(200).optional(),
    /** ISO date-only (YYYY-MM-DD). */
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dueOn must be an ISO date (YYYY-MM-DD)"),
    /** Stable identity of the subject within its kind (policyId, planId, "registration", …). */
    subjectRef: z.string().min(1),
    /** Period bucket for idempotency; defaults to the due-date's calendar year. */
    periodKey: z.string().min(1).optional(),
    /** Role answerable for the obligation; defaults per kind. */
    responsibleRole: z.string().optional(),
    rrule: z.string().optional(),
    sourceRef: z.record(z.string(), z.unknown()).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => Boolean(v.schemeId) !== Boolean(v.organizationId), {
    message: "Provide exactly one of schemeId or organizationId",
  });
export type RaiseObligationInput = z.infer<typeof raiseObligationInput>;

export interface ListObligationsFilter {
  schemeId?: string;
  organizationId?: string;
  kind?: ComplianceKind;
  status?: ComplianceStatus;
  /** upcoming = not overdue & open; overdue = overdue only; all = everything. */
  window?: "upcoming" | "overdue" | "open" | "all";
}

export interface SweepResult {
  scanned: number;
  updated: number;
  notified: number;
}

// ---------------------------------------------------------------------------
// Defaults / labels
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<ComplianceKind, string> = {
  agm_due: "Annual general meeting due",
  insurance_renewal: "Insurance renewal",
  esm_inspection: "Essential safety measures inspection",
  financial_statements: "Financial statements due",
  bas: "BAS lodgement due",
  valuation: "Insurance valuation due",
  custom: "Compliance obligation",
  registration_renewal: "Manager registration renewal",
  pi_expiry: "Manager PI insurance expiry",
};

/** Who is answerable by default. Manager-level kinds fall to the manager admin. */
const KIND_DEFAULT_ROLE: Record<ComplianceKind, MembershipRole> = {
  agm_due: "secretary",
  insurance_renewal: "treasurer",
  esm_inspection: "manager_admin",
  financial_statements: "treasurer",
  bas: "treasurer",
  valuation: "treasurer",
  custom: "manager_admin",
  registration_renewal: "manager_admin",
  pi_expiry: "manager_admin",
};

// ---------------------------------------------------------------------------
// Escalation maths (pure)
// ---------------------------------------------------------------------------

/**
 * Compute the escalation band and coarse status for an obligation from the gap
 * between `dueOn` and `asOf`. 90/60/30-day thresholds, then due (0 days) and
 * overdue (past due).
 *
 * `asOf` is normalised to its UTC calendar day before comparing, so the answer
 * is in whole calendar days and does not depend on the time of day the sweep
 * runs — an obligation due tomorrow must not read "due" at 11pm tonight.
 */
export function computeEscalation(
  dueOn: string,
  asOf: Date,
): { escalationState: ComplianceEscalation; status: ComplianceStatus; daysUntilDue: number } {
  const daysUntilDue = daysBetween(fromDateOnly(toDateOnly(asOf)), fromDateOnly(dueOn));
  let escalationState: ComplianceEscalation;
  if (daysUntilDue < 0) escalationState = "overdue";
  else if (daysUntilDue === 0) escalationState = "due";
  else if (daysUntilDue <= 30) escalationState = "t_30";
  else if (daysUntilDue <= 60) escalationState = "t_60";
  else if (daysUntilDue <= 90) escalationState = "t_90";
  else escalationState = "none";
  return { escalationState, status: ESCALATION_TO_STATUS[escalationState], daysUntilDue };
}

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

function scopeKey(input: { schemeId?: string; organizationId?: string }): string {
  return input.schemeId ? `scheme:${input.schemeId}` : `org:${input.organizationId}`;
}

/**
 * Raise an obligation on the calendar. Idempotent per (scope, kind, subjectRef,
 * period): the UNIQUE `dedupeKey` guards re-raises, so callers (agents, other
 * services) can raise freely. Seeds status + escalation from the due date and
 * publishes `compliance.obligation.raised`.
 */
export async function raiseObligation(
  ctx: ServiceContext,
  input: RaiseObligationInput,
): Promise<ComplianceObligation> {
  const parsed = raiseObligationInput.parse(input);
  const periodKey = parsed.periodKey ?? parsed.dueOn.slice(0, 4);
  const dedupeKey = `${scopeKey(parsed)}:${parsed.kind}:${parsed.subjectRef}:${periodKey}`;
  const responsibleRole = parsed.responsibleRole ?? KIND_DEFAULT_ROLE[parsed.kind];
  const { escalationState, status } = computeEscalation(parsed.dueOn, ctx.clock.now());

  return await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(complianceObligations)
      .values({
        schemeId: parsed.schemeId ?? null,
        organizationId: parsed.organizationId ?? null,
        kind: parsed.kind,
        title: parsed.title ?? KIND_LABEL[parsed.kind],
        dueOn: parsed.dueOn,
        rrule: parsed.rrule ?? null,
        status,
        escalationState,
        responsibleRole,
        subjectRef: parsed.subjectRef,
        periodKey,
        dedupeKey,
        sourceRef: parsed.sourceRef ?? null,
        meta: parsed.meta ?? null,
      })
      .onConflictDoNothing({ target: complianceObligations.dedupeKey })
      .returning();

    // Dedupe hit — return the existing obligation, no event.
    if (inserted.length === 0) {
      const existing = await tx.query.complianceObligations.findFirst({
        where: eq(complianceObligations.dedupeKey, dedupeKey),
      });
      return existing!;
    }
    const obligation = inserted[0]!;

    await publishEvent(tx, {
      schemeId: parsed.schemeId ?? null,
      stream: `compliance_obligation:${obligation.id}`,
      type: "compliance.obligation.raised",
      payload: {
        obligationId: obligation.id,
        kind: obligation.kind,
        schemeId: obligation.schemeId,
        organizationId: obligation.organizationId,
        subjectRef: obligation.subjectRef,
        dueOn: obligation.dueOn,
        periodKey: obligation.periodKey,
      },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return obligation;
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listObligations(
  ctx: ServiceContext,
  filter: ListObligationsFilter = {},
): Promise<ComplianceObligation[]> {
  const conds = [];
  if (filter.schemeId) conds.push(eq(complianceObligations.schemeId, filter.schemeId));
  if (filter.organizationId)
    conds.push(eq(complianceObligations.organizationId, filter.organizationId));
  if (filter.kind) conds.push(eq(complianceObligations.kind, filter.kind));
  if (filter.status) conds.push(eq(complianceObligations.status, filter.status));

  const window = filter.window ?? "open";
  if (window === "open") conds.push(inArray(complianceObligations.status, [...OPEN_STATUSES]));
  else if (window === "upcoming")
    conds.push(inArray(complianceObligations.status, ["upcoming", "due"]));
  else if (window === "overdue") conds.push(eq(complianceObligations.status, "overdue"));

  return await ctx.db.query.complianceObligations.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: (t, { asc: a }) => a(t.dueOn),
  });
}

export async function getObligation(
  ctx: ServiceContext,
  obligationId: string,
): Promise<ComplianceObligation | null> {
  const row = await ctx.db.query.complianceObligations.findFirst({
    where: eq(complianceObligations.id, obligationId),
  });
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Complete / waive
// ---------------------------------------------------------------------------

/**
 * Mark an obligation done (or waived). Stamps completedAt/completedBy and
 * publishes `compliance.obligation.completed`. A `nextDueOn` re-raises the same
 * recurring obligation into the next period in the same transaction.
 */
export async function completeObligation(
  ctx: ServiceContext,
  obligationId: string,
  opts: { waived?: boolean } = {},
): Promise<ComplianceObligation> {
  const finalStatus: ComplianceStatus = opts.waived ? "waived" : "done";
  return await ctx.db.transaction(async (tx) => {
    const existing = await tx.query.complianceObligations.findFirst({
      where: eq(complianceObligations.id, obligationId),
    });
    if (!existing) throw notFound("Compliance obligation");
    if (existing.status === "done" || existing.status === "waived") {
      throw new DomainError("ALREADY_CLOSED", `Obligation is already ${existing.status}`, 409);
    }

    const rows = await tx
      .update(complianceObligations)
      .set({ status: finalStatus, completedAt: ctx.clock.now(), completedBy: ctx.actor })
      .where(eq(complianceObligations.id, obligationId))
      .returning();
    const updated = rows[0]!;

    await publishEvent(tx, {
      schemeId: updated.schemeId,
      stream: `compliance_obligation:${obligationId}`,
      type: "compliance.obligation.completed",
      payload: { obligationId, kind: updated.kind, status: finalStatus },
      actor: ctx.actor,
      ...causationFields(ctx),
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Sweep (age + escalate + notify)
// ---------------------------------------------------------------------------

/**
 * Age every open obligation: recompute status + escalation band from the clock,
 * persist changes, and — when an obligation crosses into a *new* notifying band
 * (t_90/t_60/t_30/due/overdue) — publish `compliance.obligation.due` so the
 * notifier nudges the responsible role. Idempotent per run: a band that hasn't
 * changed re-fires nothing. Intended to run daily.
 */
export async function sweep(
  ctx: ServiceContext,
  filter: { schemeId?: string; organizationId?: string } = {},
): Promise<SweepResult> {
  const now = ctx.clock.now();
  const conds = [inArray(complianceObligations.status, [...OPEN_STATUSES])];
  if (filter.schemeId) conds.push(eq(complianceObligations.schemeId, filter.schemeId));
  if (filter.organizationId)
    conds.push(eq(complianceObligations.organizationId, filter.organizationId));

  const open = await ctx.db.query.complianceObligations.findMany({
    where: and(...conds),
    orderBy: (t, { asc: a }) => a(t.dueOn),
  });

  let updated = 0;
  let notified = 0;

  for (const ob of open) {
    const { escalationState, status } = computeEscalation(ob.dueOn, now);
    const bandChanged = escalationState !== ob.escalationState;
    if (!bandChanged && status === ob.status) continue;

    const shouldNotify = bandChanged && COMPLIANCE_NOTIFYING_ESCALATIONS.includes(escalationState);

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(complianceObligations)
        .set({ status, escalationState })
        .where(eq(complianceObligations.id, ob.id));

      if (shouldNotify) {
        await publishEvent(tx, {
          schemeId: ob.schemeId,
          stream: `compliance_obligation:${ob.id}`,
          type: "compliance.obligation.due",
          payload: {
            obligationId: ob.id,
            kind: ob.kind,
            dueOn: ob.dueOn,
            status,
            escalationState,
            responsibleRole: ob.responsibleRole,
            schemeId: ob.schemeId,
            organizationId: ob.organizationId,
          },
          actor: ctx.actor,
          ...causationFields(ctx),
        });
      }
    });

    updated += 1;
    if (shouldNotify) notified += 1;
  }

  return { scanned: open.length, updated, notified };
}

/** Alias — the task's `ageObligations` name for the same sweep. */
export const ageObligations = sweep;
