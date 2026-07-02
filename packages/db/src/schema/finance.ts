import {
  bigint,
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
  BUDGET_STATUSES,
  FUND_KINDS,
  INVOICE_STATUSES,
  LEDGER_ENTRY_KINDS,
  LEVY_FREQUENCIES,
  LEVY_NOTICE_STATUSES,
  PAYMENT_STATUSES,
} from "@goodstrata/shared";
import { createdAt, pk, updatedAt } from "./_common.js";
import { contractors } from "./contractors.js";
import { documents } from "./documents.js";
import { workOrders } from "./maintenance.js";
import { lots, schemes } from "./tenancy.js";

export const fundKindEnum = pgEnum("fund_kind", FUND_KINDS);
export const budgetStatusEnum = pgEnum("budget_status", BUDGET_STATUSES);
export const levyFrequencyEnum = pgEnum("levy_frequency", LEVY_FREQUENCIES);
export const levyNoticeStatusEnum = pgEnum("levy_notice_status", LEVY_NOTICE_STATUSES);
export const ledgerEntryKindEnum = pgEnum("ledger_entry_kind", LEDGER_ENTRY_KINDS);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const invoiceStatusEnum = pgEnum("invoice_status", INVOICE_STATUSES);
export const payoutStatusEnum = pgEnum("payout_status", [
  "queued",
  "sent",
  "settled",
  "failed",
]);
export const bankAccountKindEnum = pgEnum("bank_account_kind", [
  "virtual_collection",
  "operating",
]);

/** Admin fund + maintenance (capital works) fund, per OC Act. */
export const funds = pgTable(
  "funds",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: fundKindEnum().notNull(),
    name: text().notNull(),
    /** Cached; source of truth is fund_transactions. */
    balanceCents: bigint({ mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("funds_scheme_kind_idx").on(t.schemeId, t.kind)],
);

export const fundTransactions = pgTable(
  "fund_transactions",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    fundId: uuid()
      .notNull()
      .references(() => funds.id),
    /** Signed cents: positive = money in. */
    amountCents: bigint({ mode: "number" }).notNull(),
    kind: text().notNull(), // levy_receipt | invoice_payment | interest | transfer | adjustment
    reference: jsonb(), // { paymentId? payoutId? invoiceId? }
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("fund_transactions_fund_idx").on(t.fundId)],
);

export const budgets = pgTable(
  "budgets",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    /** First day of the fiscal year this budget covers. */
    fiscalYearStart: date().notNull(),
    status: budgetStatusEnum().notNull().default("draft"),
    /** Soft reference to meetings.id (meetings.ts is downstream). */
    adoptedAtMeetingId: uuid(),
    /** Soft reference to decisions.id. */
    decisionId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("budgets_scheme_idx").on(t.schemeId)],
);

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: pk(),
    budgetId: uuid()
      .notNull()
      .references(() => budgets.id),
    fundKind: fundKindEnum().notNull(),
    category: text().notNull(),
    description: text(),
    amountCents: bigint({ mode: "number" }).notNull(),
  },
  (t) => [index("budget_lines_budget_idx").on(t.budgetId)],
);

export const levySchedules = pgTable(
  "levy_schedules",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    budgetId: uuid()
      .notNull()
      .references(() => budgets.id),
    frequency: levyFrequencyEnum().notNull().default("quarterly"),
    instalments: integer().notNull().default(4),
    firstDueOn: date().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("levy_schedules_scheme_idx").on(t.schemeId)],
);

export const levyNotices = pgTable(
  "levy_notices",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    levyScheduleId: uuid()
      .notNull()
      .references(() => levySchedules.id),
    /** 1-based instalment number within the schedule. */
    instalment: integer().notNull(),
    noticeNumber: text().notNull(),
    issuedAt: timestamp({ withTimezone: true }),
    dueOn: date().notNull(),
    totalCents: bigint({ mode: "number" }).notNull(),
    status: levyNoticeStatusEnum().notNull().default("draft"),
    /** Unique payment reference for reconciliation (PayID / provider ref). */
    payid: text(),
    documentId: uuid().references(() => documents.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("levy_notices_number_idx").on(t.schemeId, t.noticeNumber),
    uniqueIndex("levy_notices_schedule_lot_instalment_idx").on(
      t.levyScheduleId,
      t.lotId,
      t.instalment,
    ),
    index("levy_notices_lot_idx").on(t.lotId),
  ],
);

export const levyNoticeLines = pgTable(
  "levy_notice_lines",
  {
    id: pk(),
    levyNoticeId: uuid()
      .notNull()
      .references(() => levyNotices.id),
    fundKind: fundKindEnum().notNull(),
    description: text().notNull(),
    amountCents: bigint({ mode: "number" }).notNull(),
  },
  (t) => [index("levy_notice_lines_notice_idx").on(t.levyNoticeId)],
);

/**
 * Per-lot money ledger — arrears, s89 eligibility, and lot statements all read
 * from here. Signed cents: charges positive, payments negative.
 */
export const lotLedgerEntries = pgTable(
  "lot_ledger_entries",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    kind: ledgerEntryKindEnum().notNull(),
    amountCents: bigint({ mode: "number" }).notNull(),
    levyNoticeId: uuid().references(() => levyNotices.id),
    paymentId: uuid(),
    note: text(),
    effectiveOn: date().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("lot_ledger_lot_idx").on(t.lotId, t.effectiveOn)],
);

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    provider: text().notNull(), // monoova | mock | manual
    providerRef: text().notNull(),
    payid: text(),
    amountCents: bigint({ mode: "number" }).notNull(),
    paidAt: timestamp({ withTimezone: true }).notNull(),
    payerName: text(),
    status: paymentStatusEnum().notNull().default("received"),
    raw: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_ref_idx").on(t.provider, t.providerRef),
    index("payments_scheme_status_idx").on(t.schemeId, t.status),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: pk(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    levyNoticeId: uuid()
      .notNull()
      .references(() => levyNotices.id),
    amountCents: bigint({ mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("payment_allocations_payment_idx").on(t.paymentId)],
);

export const receipts = pgTable(
  "receipts",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id),
    receiptNumber: text().notNull(),
    documentId: uuid().references(() => documents.id),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("receipts_number_idx").on(t.schemeId, t.receiptNumber)],
);

/** Accounts payable — contractor/supplier invoices. */
export const invoices = pgTable(
  "invoices",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    contractorId: uuid().references(() => contractors.id),
    supplierName: text().notNull(),
    abn: text(),
    invoiceNumber: text().notNull(),
    amountCents: bigint({ mode: "number" }).notNull(),
    gstCents: bigint({ mode: "number" }).notNull().default(0),
    dueOn: date(),
    status: invoiceStatusEnum().notNull().default("received"),
    workOrderId: uuid().references(() => workOrders.id),
    documentId: uuid().references(() => documents.id),
    /** Soft reference to decisions.id. */
    decisionId: uuid(),
    fundKind: fundKindEnum().notNull().default("admin"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("invoices_scheme_status_idx").on(t.schemeId, t.status)],
);

export const payouts = pgTable(
  "payouts",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id),
    provider: text().notNull(),
    providerRef: text(),
    amountCents: bigint({ mode: "number" }).notNull(),
    status: payoutStatusEnum().notNull().default("queued"),
    executedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("payouts_invoice_idx").on(t.invoiceId)],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    kind: bankAccountKindEnum().notNull(),
    provider: text().notNull(),
    providerAccountRef: text(),
    payid: text(),
    bsb: text(),
    accountNumberMasked: text(),
    createdAt: createdAt(),
  },
  (t) => [index("bank_accounts_scheme_idx").on(t.schemeId)],
);

export const paymentPlans = pgTable(
  "payment_plans",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    lotId: uuid()
      .notNull()
      .references(() => lots.id),
    /** Soft reference to decisions.id (hardship approval). */
    decisionId: uuid(),
    instalmentCents: bigint({ mode: "number" }).notNull(),
    frequency: levyFrequencyEnum().notNull(),
    startsOn: date().notNull(),
    status: text().notNull().default("active"), // active | completed | defaulted
    createdAt: createdAt(),
  },
  (t) => [index("payment_plans_lot_idx").on(t.lotId)],
);
