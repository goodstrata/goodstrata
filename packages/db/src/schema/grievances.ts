import {
  type Actor,
  BREACH_NOTICE_STATUSES,
  BREACH_NOTICE_TYPES,
  COMPLAINT_STATUSES,
} from "@goodstrata/shared";
import {
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_common.js";
import { lots, people, schemes } from "./tenancy.js";

export const complaintStatusEnum = pgEnum("complaint_status", COMPLAINT_STATUSES);
export const breachNoticeTypeEnum = pgEnum("breach_notice_type", BREACH_NOTICE_TYPES);
export const breachNoticeStatusEnum = pgEnum("breach_notice_status", BREACH_NOTICE_STATUSES);

/**
 * Grievances / disputes (OC Act Part 10). Every OC must run an approved
 * grievance procedure; a complaint must be dealt with within 28 days of
 * receipt (meetByDate).
 */
export const complaints = pgTable(
  "complaints",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    complainantPersonId: uuid()
      .notNull()
      .references(() => people.id),
    respondentPersonId: uuid().references(() => people.id),
    subject: text().notNull(),
    details: text().notNull(),
    /** Whether it was lodged on the OC's approved grievance form. */
    approvedForm: boolean().notNull().default(false),
    status: complaintStatusEnum().notNull().default("received"),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Statutory deadline to deal with the complaint: receivedAt + 28 days. */
    meetByDate: date().notNull(),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("complaints_scheme_status_idx").on(t.schemeId, t.status)],
);

/**
 * Breach notices issued against a lot or person for a rule contravention.
 * A notice to rectify gives 28 days to comply (rectifyByDate); a final notice
 * precedes escalation to VCAT.
 */
export const breachNotices = pgTable(
  "breach_notices",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    complaintId: uuid().references(() => complaints.id),
    subjectLotId: uuid().references(() => lots.id),
    subjectPersonId: uuid().references(() => people.id),
    /** Reference to the contravened rule (e.g. "Model Rule 4.1"). */
    ruleRef: text().notNull(),
    type: breachNoticeTypeEnum().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Deadline to rectify the breach: issuedAt + 28 days. */
    rectifyByDate: date().notNull(),
    status: breachNoticeStatusEnum().notNull().default("issued"),
    details: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("breach_notices_scheme_status_idx").on(t.schemeId, t.status)],
);

/** Append-only audit trail for a complaint. */
export const complaintEvents = pgTable(
  "complaint_events",
  {
    id: pk(),
    complaintId: uuid()
      .notNull()
      .references(() => complaints.id),
    kind: text().notNull(),
    /** Who acted — user or agent (jsonb Actor, matching event_log/documents). */
    actor: jsonb().$type<Actor>().notNull(),
    note: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("complaint_events_complaint_idx").on(t.complaintId)],
);
