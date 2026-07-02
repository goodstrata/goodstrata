import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  MEETING_KINDS,
  MEETING_STATUSES,
  MOTION_STATUSES,
  RESOLUTION_TYPES,
  VOTE_CHOICES,
} from "@goodstrata/shared";
import { createdAt, pk, updatedAt } from "./_common.js";
import { documents } from "./documents.js";
import { lots, people, schemes } from "./tenancy.js";

export const meetingKindEnum = pgEnum("meeting_kind", MEETING_KINDS);
export const meetingStatusEnum = pgEnum("meeting_status", MEETING_STATUSES);
export const resolutionTypeEnum = pgEnum("resolution_type", RESOLUTION_TYPES);
export const motionStatusEnum = pgEnum("motion_status", MOTION_STATUSES);
export const voteChoiceEnum = pgEnum("vote_choice", VOTE_CHOICES);
export const proxyScopeEnum = pgEnum("proxy_scope", ["meeting", "standing"]);
export const attendanceModeEnum = pgEnum("attendance_mode", ["in_person", "online", "proxy"]);

export const meetings = pgTable(
  "meetings",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: meetingKindEnum().notNull(),
    title: text().notNull(),
    scheduledAt: timestamp({ withTimezone: true }).notNull(),
    location: text(),
    videoUrl: text(),
    status: meetingStatusEnum().notNull().default("draft"),
    noticeSentAt: timestamp({ withTimezone: true }),
    quorumMet: boolean(),
    minutesDocumentId: uuid().references(() => documents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("meetings_scheme_idx").on(t.schemeId, t.scheduledAt)],
);

export const agendaItems = pgTable(
  "agenda_items",
  {
    id: pk(),
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id),
    order: integer().notNull(),
    title: text().notNull(),
    body: text(),
    submittedByPersonId: uuid().references(() => people.id),
    createdAt: createdAt(),
  },
  (t) => [index("agenda_items_meeting_idx").on(t.meetingId)],
);

/** meetingId null = circular/written resolution (out-of-session ballot). */
export const motions = pgTable(
  "motions",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    meetingId: uuid().references(() => meetings.id),
    agendaItemId: uuid().references(() => agendaItems.id),
    title: text().notNull(),
    text: text().notNull(),
    resolutionType: resolutionTypeEnum().notNull().default("ordinary"),
    opensAt: timestamp({ withTimezone: true }),
    closesAt: timestamp({ withTimezone: true }),
    status: motionStatusEnum().notNull().default("draft"),
    /** { for, against, abstain } entitlement totals + eligibility snapshot. */
    result: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("motions_scheme_idx").on(t.schemeId)],
);

export const votes = pgTable(
  "votes",
  {
    id: pk(),
    motionId: uuid()
      .notNull()
      .references(() => motions.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    castByPersonId: uuid()
      .notNull()
      .references(() => people.id),
    viaProxyId: uuid(),
    choice: voteChoiceEnum().notNull(),
    /** Snapshot of lot entitlement at cast time. */
    entitlementWeight: integer().notNull(),
    castAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("votes_motion_lot_idx").on(t.motionId, t.lotId)],
);

export const proxies = pgTable(
  "proxies",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    grantorPersonId: uuid()
      .notNull()
      .references(() => people.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    proxyPersonId: uuid()
      .notNull()
      .references(() => people.id),
    scope: proxyScopeEnum().notNull().default("meeting"),
    meetingId: uuid().references(() => meetings.id),
    expiresOn: date(),
    documentId: uuid().references(() => documents.id),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("proxies_scheme_idx").on(t.schemeId)],
);

export const meetingAttendance = pgTable(
  "meeting_attendance",
  {
    id: pk(),
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id),
    personId: uuid()
      .notNull()
      .references(() => people.id),
    lotId: uuid().references(() => lots.id),
    mode: attendanceModeEnum().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("meeting_attendance_idx").on(t.meetingId, t.personId)],
);
