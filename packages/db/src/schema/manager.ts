import {
  bigint,
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
import { documents } from "./documents.js";
import { organizations, schemes } from "./tenancy.js";

export const managerRegistrationStatusEnum = pgEnum("manager_registration_status", [
  "current",
  "suspended",
  "cancelled",
  "unknown",
]);
export const managerAppointmentStatusEnum = pgEnum("manager_appointment_status", [
  "draft",
  "active",
  "expired",
  "terminated",
]);

/**
 * Manager professional-indemnity insurance, tracked at the ORGANISATION level
 * (registered-manager path — OC Act s119(5) / reg 10 require ≥$2M PI cover held
 * continuously). One row per policy period; the compliance calendar raises a
 * `pi_expiry` obligation off the latest `expiresOn`, and continuity is checked
 * across successive rows via `effectiveOn`.
 */
export const managerPiPolicies = pgTable(
  "manager_pi_policies",
  {
    id: pk(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    insurer: text().notNull(),
    policyNumber: text().notNull(),
    /** Cover amount in cents; the ≥$2,000,000 statutory floor is checked in code. */
    coverAmountCents: bigint({ mode: "number" }).notNull(),
    /** Start of cover — used to prove continuous cover across renewals. */
    effectiveOn: date(),
    expiresOn: date().notNull(),
    /** The certificate of currency, if uploaded. */
    documentId: uuid().references(() => documents.id),
    /** Date the manager notified BLA that cover ceased/changed, when applicable. */
    blaNotifiedOn: date(),
    blaNotificationReference: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("manager_pi_policies_org_idx").on(t.organizationId, t.expiresOn)],
);

/** Point-in-time verification against the BLA public register. */
export const managerRegistrationChecks = pgTable(
  "manager_registration_checks",
  {
    id: pk(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    registrationNumber: text().notNull(),
    status: managerRegistrationStatusEnum().notNull(),
    checkedAt: timestamp({ withTimezone: true }).notNull(),
    sourceUrl: text(),
    evidenceDocumentId: uuid().references(() => documents.id),
    blaNotifiedOn: date(),
    blaNotificationReference: text(),
    createdAt: createdAt(),
  },
  (t) => [index("manager_registration_checks_org_idx").on(t.organizationId, t.checkedAt)],
);

/** Scheme-specific appointment and delegation instrument for a manager. */
export const managerAppointments = pgTable(
  "manager_appointments",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    status: managerAppointmentStatusEnum().notNull().default("draft"),
    appointedOn: date().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    approvedFormName: text().notNull(),
    approvedFormVersion: text().notNull(),
    appointmentDocumentId: uuid()
      .notNull()
      .references(() => documents.id),
    appointmentResolutionId: uuid().notNull(),
    delegationDocumentId: uuid()
      .notNull()
      .references(() => documents.id),
    delegationResolutionId: uuid().notNull(),
    delegatedPowers: jsonb().$type<string[]>().notNull().default([]),
    terminatedOn: date(),
    terminationResolutionId: uuid(),
    recordsReturnDueOn: date(),
    changeNotifiedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("manager_appointments_scheme_idx").on(t.schemeId, t.status, t.endsOn)],
);
