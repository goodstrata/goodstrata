import {
  AGENDA_ITEM_STATUSES,
  type ChairLogEntry,
  MEETING_KINDS,
  MEETING_STATUSES,
  MOTION_STATUSES,
  RESOLUTION_TYPES,
  VOTE_CHOICES,
} from "@goodstrata/shared";
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
import { createdAt, pk, updatedAt } from "./_common.js";
import { documents } from "./documents.js";
import { lots, people, schemes } from "./tenancy.js";

export const meetingKindEnum = pgEnum("meeting_kind", MEETING_KINDS);
export const meetingStatusEnum = pgEnum("meeting_status", MEETING_STATUSES);
export const resolutionTypeEnum = pgEnum("resolution_type", RESOLUTION_TYPES);
export const motionStatusEnum = pgEnum("motion_status", MOTION_STATUSES);
export const agendaItemStatusEnum = pgEnum("agenda_item_status", AGENDA_ITEM_STATUSES);
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
    /** Human chair of record. AI may assist, but never occupies this office. */
    chairPersonId: uuid().references(() => people.id),
    /** Display name also covers a registered manager who is not on the people roll. */
    chairName: text(),
    chairAppointedAt: timestamp({ withTimezone: true }),
    /** Records the OC's authorisation for the AI conductor to assist the human chair. */
    chairAssistedByAi: boolean().notNull().default(false),
    minutesDocumentId: uuid().references(() => documents.id),
    /** Append-only log written by the AI chair while it conducts the meeting. */
    chairLog: jsonb().$type<ChairLogEntry[]>().notNull().default([]),
    /** Set when the video provider confirmed transcription started. */
    transcriptionStarted: boolean().notNull().default(false),
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
    /**
     * Officer-created items are "accepted" at birth (the default backfills
     * every pre-existing row); owner-submitted proposals arrive "pending"
     * until an officer accepts (→ real agenda item + draft motion) or rejects.
     */
    status: agendaItemStatusEnum().notNull().default("accepted"),
    /** The proposed motion text carried by an owner submission (used at accept). */
    motionText: text(),
    /** Officer's reason recorded when a pending submission is rejected. */
    rejectedReason: text(),
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
    /**
     * A poll re-tallies an ordinary resolution by lot entitlement rather than a
     * show of hands (OC Act s 89(3)–(5)). Set true when a poll is demanded.
     */
    pollDemanded: boolean().notNull().default(false),
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
    viaPowerOfAttorneyId: uuid(),
    choice: voteChoiceEnum().notNull(),
    /** Snapshot of lot entitlement at cast time. */
    entitlementWeight: integer().notNull(),
    castAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Voting paper/ballot: held for at least 12 months after the vote. */
    retentionUntil: date(),
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
    /** Proxy instrument: held at least 12 months after expiry or revocation. */
    retentionUntil: date(),
    createdAt: createdAt(),
  },
  (t) => [index("proxies_scheme_idx").on(t.schemeId)],
);

/**
 * Written powers of attorney used for attendance, quorum and voting. Kept
 * separately from proxies because the Act applies different formalities and
 * proxy-farming limits do not apply to a genuine attorney appointment.
 */
export const powersOfAttorney = pgTable(
  "powers_of_attorney",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    donorPersonId: uuid()
      .notNull()
      .references(() => people.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    attorneyPersonId: uuid()
      .notNull()
      .references(() => people.id),
    startsOn: date().notNull(),
    endsOn: date(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("powers_of_attorney_scheme_idx").on(t.schemeId, t.attorneyPersonId)],
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

/** Auditable result of the committee election conducted at an AGM. */
export const committeeElectionRecords = pgTable(
  "committee_election_records",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    meetingId: uuid()
      .notNull()
      .references(() => meetings.id),
    electedUserIds: jsonb().$type<string[]>().notNull(),
    /** Required carried ordinary resolution when the committee exceeds 7. */
    expansionMotionId: uuid().references(() => motions.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("committee_election_meeting_idx").on(t.meetingId)],
);
