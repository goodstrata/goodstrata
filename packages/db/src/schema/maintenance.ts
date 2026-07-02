import {
  MAINTENANCE_STATUSES,
  MAINTENANCE_URGENCIES,
  WORK_ORDER_STATUSES,
} from "@goodstrata/shared";
import {
  bigint,
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
import { contractors } from "./contractors.js";
import { documents } from "./documents.js";
import { lots, people, schemes } from "./tenancy.js";

export const maintenanceUrgencyEnum = pgEnum("maintenance_urgency", MAINTENANCE_URGENCIES);
export const maintenanceStatusEnum = pgEnum("maintenance_status", MAINTENANCE_STATUSES);
export const workOrderStatusEnum = pgEnum("work_order_status", WORK_ORDER_STATUSES);
export const quoteStatusEnum = pgEnum("quote_status", [
  "requested",
  "received",
  "selected",
  "declined",
]);

export const maintenanceRequests = pgTable(
  "maintenance_requests",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    /** null = common property. */
    lotId: uuid().references(() => lots.id),
    reportedByPersonId: uuid().references(() => people.id),
    title: text().notNull(),
    description: text().notNull(),
    category: text(), // plumbing | electrical | ... (agent-assigned, free vocab)
    urgency: maintenanceUrgencyEnum(),
    isCommonProperty: boolean(),
    /** Agent triage output: category, urgency, reasoning, confidence. */
    aiTriage: jsonb(),
    photoDocumentIds: uuid().array().notNull().default([]),
    status: maintenanceStatusEnum().notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("maintenance_requests_scheme_status_idx").on(t.schemeId, t.status)],
);

export const quotes = pgTable(
  "quotes",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    requestId: uuid()
      .notNull()
      .references(() => maintenanceRequests.id),
    contractorId: uuid()
      .notNull()
      .references(() => contractors.id),
    amountCents: bigint({ mode: "number" }).notNull(),
    validUntil: date(),
    documentId: uuid().references(() => documents.id),
    status: quoteStatusEnum().notNull().default("requested"),
    createdAt: createdAt(),
  },
  (t) => [index("quotes_request_idx").on(t.requestId)],
);

export const workOrders = pgTable(
  "work_orders",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    requestId: uuid().references(() => maintenanceRequests.id),
    contractorId: uuid()
      .notNull()
      .references(() => contractors.id),
    quoteId: uuid().references(() => quotes.id),
    scope: text().notNull(),
    approvedAmountCents: bigint({ mode: "number" }).notNull(),
    accessNotes: text(),
    status: workOrderStatusEnum().notNull().default("draft"),
    /** Soft reference to decisions.id (spine.ts is downstream). */
    decisionId: uuid(),
    scheduledFor: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    completionPhotoDocumentIds: uuid().array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("work_orders_scheme_status_idx").on(t.schemeId, t.status)],
);

export const maintenancePlans = pgTable(
  "maintenance_plans",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    name: text().notNull(),
    category: text().notNull(),
    contractorId: uuid().references(() => contractors.id),
    /** iCalendar RRULE, e.g. FREQ=MONTHLY;INTERVAL=3 */
    rrule: text().notNull(),
    nextDueOn: date().notNull(),
    /** Essential safety measures — statutory inspections. */
    isEsm: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("maintenance_plans_scheme_idx").on(t.schemeId)],
);

export const assets = pgTable(
  "assets",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    name: text().notNull(),
    category: text().notNull(),
    location: text(),
    installedOn: date(),
    warrantyUntil: date(),
    expectedLifeYears: bigint({ mode: "number" }),
    replacementCostCents: bigint({ mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("assets_scheme_idx").on(t.schemeId)],
);
