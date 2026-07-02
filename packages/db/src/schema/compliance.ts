import { COMPLIANCE_KINDS, COMPLIANCE_STATUSES } from "@goodstrata/shared";
import { date, index, jsonb, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_common.js";
import { schemes } from "./tenancy.js";

export const complianceKindEnum = pgEnum("compliance_kind", COMPLIANCE_KINDS);
export const complianceStatusEnum = pgEnum("compliance_status", COMPLIANCE_STATUSES);

export const complianceObligations = pgTable(
  "compliance_obligations",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: complianceKindEnum().notNull(),
    title: text().notNull(),
    dueOn: date().notNull(),
    /** Recurrence, if any (iCalendar RRULE). */
    rrule: text(),
    status: complianceStatusEnum().notNull().default("upcoming"),
    /** What generated this: { policyId? meetingId? planId? } */
    sourceRef: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("compliance_obligations_scheme_due_idx").on(t.schemeId, t.dueOn)],
);
