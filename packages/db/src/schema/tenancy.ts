import { LOT_TYPES, MEMBERSHIP_ROLES, OWNERSHIP_KINDS, SCHEME_STATUSES } from "@goodstrata/shared";
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
import { users } from "./auth.js";

export const schemeStatusEnum = pgEnum("scheme_status", SCHEME_STATUSES);
export const lotTypeEnum = pgEnum("lot_type", LOT_TYPES);
export const membershipRoleEnum = pgEnum("membership_role", MEMBERSHIP_ROLES);
export const ownershipKindEnum = pgEnum("ownership_kind", OWNERSHIP_KINDS);

/** Optional management umbrella (a strata manager or self-managed group). */
export const organizations = pgTable("organizations", {
  id: pk(),
  name: text().notNull(),
  abn: text(),
  contactEmail: text(),
  /**
   * The manager's Business Licensing Authority registration number (registered-
   * manager path). Feeds OC certificates and the s147/148 register of managers.
   * Nullable: self-managed groups have no registration.
   */
  managerRegistrationNumber: text(),
  settings: jsonb().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Per-scheme knobs with sane defaults; stored in schemes.settings. */
export interface SchemeSettings {
  timezone: string; // e.g. "Australia/Melbourne"
  /** Work order auto-approve ceiling, cents. */
  maintenanceAutoApproveCents: number;
  /** Above this, multiple quotes are required, cents. */
  maintenanceMultiQuoteCents: number;
  /** Penalty interest, basis points per annum (default statutory rate). */
  penaltyInterestBps: number;
  /** Days after due date before interest accrues. */
  interestGraceDays: number;
}

export const defaultSchemeSettings: SchemeSettings = {
  timezone: "Australia/Melbourne",
  maintenanceAutoApproveCents: 50_000,
  maintenanceMultiQuoteCents: 200_000,
  penaltyInterestBps: 1000,
  interestGraceDays: 0,
};

/** An owners corporation ("scheme" is the jurisdiction-neutral term). */
export const schemes = pgTable(
  "schemes",
  {
    id: pk(),
    organizationId: uuid().references(() => organizations.id),
    name: text().notNull(),
    planOfSubdivision: text().notNull(), // e.g. "PS543210V"
    addressLine1: text().notNull(),
    addressLine2: text(),
    suburb: text().notNull(),
    state: text().notNull().default("VIC"),
    postcode: text().notNull(),
    tier: integer().notNull(), // 1–5, derived from lot count (OC Act)
    abn: text(),
    gstRegistered: boolean().notNull().default(false),
    /** Month (1-12) the financial year ends; day is last day of that month. */
    financialYearEndMonth: integer().notNull().default(6),
    status: schemeStatusEnum().notNull().default("onboarding"),
    settings: jsonb().$type<SchemeSettings>().notNull().default(defaultSchemeSettings),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("schemes_plan_idx").on(t.planOfSubdivision)],
);

export const lots = pgTable(
  "lots",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    lotNumber: text().notNull(), // as on the plan of subdivision
    unitNumber: text(), // street/door number, if different
    lotType: lotTypeEnum().notNull().default("residential"),
    /** Lot entitlement — voting weight numerator. */
    entitlement: integer().notNull(),
    /** Lot liability — levy share numerator. */
    liability: integer().notNull(),
    streetAddress: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("lots_scheme_lot_number_idx").on(t.schemeId, t.lotNumber)],
);

/**
 * Contact records. A person may never log in; a person optionally links to a
 * login identity (users). Ownership and tenancy hang off people, not users.
 */
export const people = pgTable(
  "people",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    userId: text().references(() => users.id),
    givenName: text(),
    familyName: text(),
    companyName: text(),
    email: text(),
    phone: text(),
    mailingAddress: jsonb(),
    commsPrefs: jsonb().notNull().default({ levy: "email", notices: "email" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("people_scheme_idx").on(t.schemeId), index("people_user_idx").on(t.userId)],
);

export const ownerships = pgTable(
  "ownerships",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    personId: uuid()
      .notNull()
      .references(() => people.id),
    kind: ownershipKindEnum().notNull().default("sole"),
    shareNumerator: integer().notNull().default(1),
    shareDenominator: integer().notNull().default(1),
    /** The person who receives levy notices for the lot. */
    isLevyRecipient: boolean().notNull().default(true),
    startedOn: date().notNull(),
    endedOn: date(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ownerships_lot_idx").on(t.lotId), index("ownerships_person_idx").on(t.personId)],
);

export const tenancies = pgTable(
  "tenancies",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    personId: uuid()
      .notNull()
      .references(() => people.id),
    startedOn: date().notNull(),
    endedOn: date(),
    createdAt: createdAt(),
  },
  (t) => [index("tenancies_lot_idx").on(t.lotId)],
);

/**
 * A login identity's role in a scheme, period-bounded. Chair/secretary/treasurer
 * are statutory offices — history is preserved by closing the period.
 */
export const memberships = pgTable(
  "memberships",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    role: membershipRoleEnum().notNull(),
    startedOn: date().notNull(),
    endedOn: date(),
    /** Soft reference to meetings.id (no FK: meetings.ts imports this file). */
    electedAtMeetingId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    index("memberships_scheme_user_idx").on(t.schemeId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/** Pending email invites for owners/committee to join the portal. */
export const invites = pgTable(
  "invites",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    personId: uuid()
      .notNull()
      .references(() => people.id),
    email: text().notNull(),
    role: membershipRoleEnum().notNull().default("owner"),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invites_scheme_idx").on(t.schemeId)],
);
