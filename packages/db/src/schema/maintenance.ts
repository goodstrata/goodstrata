import {
  MAINTENANCE_STATUSES,
  MAINTENANCE_URGENCIES,
  RFQ_CHANNEL_STATUSES,
  RFQ_STATUSES,
  WORK_ORDER_STATUSES,
} from "@goodstrata/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
export const rfqStatusEnum = pgEnum("rfq_status", RFQ_STATUSES);
export const rfqChannelStatusEnum = pgEnum("rfq_channel_status", RFQ_CHANNEL_STATUSES);
export const statutoryMaintenancePlanStatusEnum = pgEnum("statutory_maintenance_plan_status", [
  "draft",
  "approved",
  "review_due",
  "superseded",
]);
export const capitalItemConditionEnum = pgEnum("capital_item_condition", [
  "good",
  "fair",
  "poor",
  "critical",
  "unknown",
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
    /**
     * Set by the HUMAN reporter at creation ("this is an emergency"). The only
     * flag that may gate immediate work-order dispatch — `urgency` below is
     * agent triage (LLM output) and must never authorise spending on its own.
     */
    reportedEmergency: boolean().notNull().default(false),
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

/** One photo attached to a request at intake (mirrors communityPostImages; stored via StorageProvider). */
export const maintenanceRequestImages = pgTable(
  "maintenance_request_images",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    requestId: uuid()
      .notNull()
      .references(() => maintenanceRequests.id),
    storageKey: text().notNull(),
    mime: text().notNull(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("maintenance_request_images_request_idx").on(t.requestId)],
);

/**
 * Request for quotes on a maintenance job. The spec is drafted anonymized:
 * suburb + building type + scope of works only — the exact address and any
 * owner identities are revealed to the winner post-award, never before.
 */
export const rfqs = pgTable(
  "rfqs",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    requestId: uuid()
      .notNull()
      .references(() => maintenanceRequests.id),
    title: text().notNull(),
    /** Agent-drafted anonymized scope (markdown). The ONLY prose that leaves the platform. */
    specMd: text().notNull().default(""),
    category: text().notNull(),
    /** Snapshotted from the scheme at creation — suburb + building type is ALL the location external parties get. */
    suburb: text().notNull(),
    buildingType: text(),
    quotesDueOn: date(),
    status: rfqStatusEnum().notNull().default("draft"),
    /** Winning quote after the committee decision executes. */
    awardedQuoteId: uuid(),
    /** Soft reference to decisions.id (spine.ts is downstream). */
    decisionId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("rfqs_scheme_status_idx").on(t.schemeId, t.status)],
);

/** One dispatch of an RFQ through a TradeMarketProvider (scheme book, invited email, marketplace). */
export const rfqChannels = pgTable(
  "rfq_channels",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    rfqId: uuid()
      .notNull()
      .references(() => rfqs.id),
    /** TradeMarketProvider.name — "scheme_book", "email_rfq", "console", future marketplaces. */
    provider: text().notNull(),
    /** Provider's external id for the posting (idempotency / withdraw / fetch handle). */
    providerRef: text(),
    /** Set for direct scheme-book sends; null for invited-email / marketplace broadcasts. */
    contractorId: uuid().references(() => contractors.id),
    status: rfqChannelStatusEnum().notNull().default("pending"),
    sentAt: timestamp({ withTimezone: true }),
    /**
     * Unguessable per-(rfq, contractor/email) credential for the public
     * /quote/{token} self-service page. Minted at dispatch for direct sends
     * (scheme_book + email_rfq); null for broadcast channels (no self-service).
     * The token is the sole authenticator: it resolves to exactly this channel,
     * hence exactly one rfq + one contractor/email, and nothing else.
     */
    quoteToken: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("rfq_channels_rfq_idx").on(t.rfqId),
    uniqueIndex("rfq_channels_quote_token_idx").on(t.quoteToken),
  ],
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
    /** External respondents get a `pending` contractors row — never a nullable contractor. */
    contractorId: uuid()
      .notNull()
      .references(() => contractors.id),
    /** RFQ this quote answers; null for legacy direct quotes. */
    rfqId: uuid().references(() => rfqs.id),
    /** Channel the quote arrived through; null for manual/phone entry. */
    channelId: uuid().references(() => rfqChannels.id),
    amountCents: bigint({ mode: "number" }).notNull(),
    validUntil: date(),
    documentId: uuid().references(() => documents.id),
    notes: text(),
    /** Respondent attested a current trade licence for the category. */
    licenceConfirmed: boolean().notNull().default(false),
    /** Respondent attested current public-liability insurance. */
    insuranceConfirmed: boolean().notNull().default(false),
    // ZERO HIDDEN MARGIN — always present, default 0, rendered whenever nonzero.
    platformFeeCents: bigint({ mode: "number" }).notNull().default(0),
    referralFeeCents: bigint({ mode: "number" }).notNull().default(0),
    /** Who receives any fee. DB-enforced: required whenever either fee is nonzero. */
    feeRecipient: text(),
    status: quoteStatusEnum().notNull().default("requested"),
    createdAt: createdAt(),
  },
  (t) => [
    index("quotes_request_idx").on(t.requestId),
    index("quotes_rfq_idx").on(t.rfqId),
    check(
      "quotes_fee_disclosure",
      sql`(platform_fee_cents = 0 AND referral_fee_cents = 0) OR fee_recipient IS NOT NULL`,
    ),
  ],
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
    /**
     * Unguessable single-purpose credential for the public /work-order/{token}
     * accept/decline page. Minted when the work order is created (post-award or
     * direct dispatch); a WO exists only after the job is authorised, so the
     * token's existence already implies this contractor was engaged. Resolves
     * to exactly this work order and nothing else.
     */
    acceptToken: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("work_orders_scheme_status_idx").on(t.schemeId, t.status),
    uniqueIndex("work_orders_accept_token_idx").on(t.acceptToken),
  ],
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

/** Approved-form, ten-year capital maintenance plan (distinct from recurring task schedules). */
export const statutoryMaintenancePlans = pgTable(
  "statutory_maintenance_plans",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    title: text().notNull(),
    status: statutoryMaintenancePlanStatusEnum().notNull().default("draft"),
    approvedFormVersion: text().notNull(),
    preparedOn: date().notNull(),
    coverageStartOn: date().notNull(),
    coverageEndOn: date().notNull(),
    /** Soft link avoids the finance -> maintenance schema cycle. Must identify this scheme's maintenance fund. */
    maintenanceFundId: uuid(),
    approvalResolutionId: uuid(),
    approvedOn: date(),
    approvedAtMeetingId: uuid(),
    lastReviewedOn: date(),
    nextReviewOn: date(),
    sourceDocumentId: uuid().references(() => documents.id),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("statutory_maintenance_plans_scheme_idx").on(t.schemeId, t.status)],
);

/** Major capital items and works forecast within a statutory plan's ten-year horizon. */
export const maintenancePlanItems = pgTable(
  "maintenance_plan_items",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    planId: uuid()
      .notNull()
      .references(() => statutoryMaintenancePlans.id),
    assetId: uuid().references(() => assets.id),
    name: text().notNull(),
    presentCondition: capitalItemConditionEnum().notNull().default("unknown"),
    plannedAction: text().notNull(),
    scheduledOn: date().notNull(),
    estimatedCostCents: bigint({ mode: "number" }).notNull(),
    expectedLifeAfterWorksYears: integer().notNull(),
    completedAt: timestamp({ withTimezone: true }),
    completionWorkOrderId: uuid().references(() => workOrders.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("maintenance_plan_items_plan_idx").on(t.planId, t.scheduledOn)],
);
