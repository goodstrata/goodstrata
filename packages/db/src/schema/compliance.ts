import { COMPLIANCE_KINDS, COMPLIANCE_STATUSES } from "@goodstrata/shared";
import { date, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_common.js";
import { organizations, schemes } from "./tenancy.js";

export const complianceKindEnum = pgEnum("compliance_kind", COMPLIANCE_KINDS);
export const complianceStatusEnum = pgEnum("compliance_status", COMPLIANCE_STATUSES);

/**
 * The compliance calendar. Brought to life by `complianceService`: obligations
 * are raised idempotently (per kind + subject + period via `dedupeKey`), aged
 * by the sweep (which recomputes `status` + `escalationState`), and completed.
 *
 * An obligation is scoped to a `schemeId` (e.g. AGM due, insurance renewal) OR
 * to an `organizationId` (manager-level: registration_renewal, pi_expiry) —
 * exactly one is set. `schemeId` is nullable to allow the manager-level rows.
 */
export const complianceObligations = pgTable(
  "compliance_obligations",
  {
    id: pk(),
    /** Scheme scope (nullable — manager-level obligations use organizationId). */
    schemeId: uuid().references(() => schemes.id),
    /** Manager/organisation scope (registration_renewal, pi_expiry). */
    organizationId: uuid().references(() => organizations.id),
    kind: complianceKindEnum().notNull(),
    title: text().notNull(),
    dueOn: date().notNull(),
    /** Recurrence, if any (iCalendar RRULE). */
    rrule: text(),
    status: complianceStatusEnum().notNull().default("upcoming"),
    /**
     * Finer-grained escalation band recomputed by the sweep from (dueOn − now):
     * none | t_90 | t_60 | t_30 | due | overdue. See COMPLIANCE_ESCALATIONS.
     */
    escalationState: text().notNull().default("none"),
    /** Which membership role is answerable for this obligation (notifier fan-out). */
    responsibleRole: text(),
    /** Stable identity of the subject within its kind (e.g. policyId, planId, "registration"). */
    subjectRef: text(),
    /** The period bucket the obligation belongs to (e.g. "2026", "2026-Q3"). */
    periodKey: text(),
    /**
     * Idempotency key = `${scope}:${kind}:${subjectRef}:${periodKey}`. UNIQUE —
     * re-raising the same obligation is a no-op (onConflictDoNothing).
     */
    dedupeKey: text().unique(),
    /** What generated this: { policyId? meetingId? planId? }. */
    sourceRef: jsonb(),
    /** Free-form context supplied at raise time. */
    meta: jsonb(),
    completedAt: timestamp({ withTimezone: true }),
    /** Actor who completed/waived the obligation. */
    completedBy: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("compliance_obligations_scheme_due_idx").on(t.schemeId, t.dueOn),
    index("compliance_obligations_org_due_idx").on(t.organizationId, t.dueOn),
    index("compliance_obligations_status_due_idx").on(t.status, t.dueOn),
  ],
);
