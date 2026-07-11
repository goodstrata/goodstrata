import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, pk, updatedAt } from "./_common.js";
import { users } from "./auth.js";
import { schemes } from "./tenancy.js";

/**
 * In-app notifications, one row per recipient user. Written by the notifier
 * (a pure-code event consumer) and by services that address users directly.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: pk(),
    schemeId: uuid()
      .notNull()
      .references(() => schemes.id),
    /** ON DELETE SET NULL: keeps the notification row on the spine; the recipient link severs. */
    userId: text().references(() => users.id, { onDelete: "set null" }),
    title: text().notNull(),
    body: text().notNull(),
    /** finance | maintenance | meeting | decision | general */
    category: text().notNull(),
    /** What this notification is about: { type: "decision", id }. */
    related: jsonb().$type<{ type: string; id: string } | null>(),
    /**
     * Delivery idempotency token, e.g. "<trigger event id>:<userId>". The
     * notifier inserts with onConflictDoNothing on this key so a redelivered
     * pg-boss job cannot duplicate the bell row. Outbound channels use the
     * separate leased delivery-state table below. Null for rows written
     * outside the notifier (the unique index ignores NULLs).
     */
    dedupeKey: text(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_read_idx").on(t.userId, t.readAt),
    uniqueIndex("notifications_dedupe_key_idx").on(t.dedupeKey),
  ],
);

/**
 * Durable delivery state for notifier channels that leave the database
 * (email, SMS, and OS push). These cannot use `notifications.dedupeKey` as
 * their gate: a user may opt out of the visible in-app row while keeping any
 * of the outbound channels enabled.
 *
 * A short owner-token lease serialises concurrent workers. Success is marked
 * permanently; explicit failures release the lease for pg-boss retry, while a
 * crashed worker's lease expires. Push additionally records terminal device
 * targets so a partial Expo batch retry does not resend accepted chunks.
 * `eventId` deliberately has no FK so historical state can survive event-log
 * retention/export changes and tests can use synthetic event records.
 */
export const notificationDeliveryClaims = pgTable(
  "notification_delivery_claims",
  {
    id: pk(),
    eventId: uuid().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** email | sms | push — validated by the notifier. */
    channel: text().notNull(),
    /** Unique owner token: stale workers cannot finish a newer worker's lease. */
    leaseId: uuid().notNull(),
    leaseUntil: timestamp({ withTimezone: true }).notNull(),
    completedAt: timestamp({ withTimezone: true }),
    attempts: integer().notNull().default(0),
    lastError: text(),
    /** Push-only terminal device tokens retained across partial retries. */
    completedTargets: jsonb().$type<string[]>().notNull().default([]),
    claimedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notification_delivery_claims_event_user_channel_idx").on(
      t.eventId,
      t.userId,
      t.channel,
    ),
    index("notification_delivery_claims_user_idx").on(t.userId),
    index("notification_delivery_claims_lease_idx").on(t.completedAt, t.leaseUntil),
  ],
);

/**
 * Per-user notification preferences, keyed (userId, notificationType, channel).
 * Sparse: a row exists only when the user's choice differs from the default —
 * an absent row means "use NOTIFICATION_DEFAULTS[type][channel]". This makes the
 * non-regression rule automatic: a fresh user has zero rows and gets every
 * default, and no channel that fires today can be silenced by accident.
 *
 * `notificationType` ∈ NOTIFICATION_TYPES (the notifier event types) and
 * `channel` ∈ "in_app" | "email" | "sms" | "push" — validated in the app
 * layer, stored as text to stay in step with other enum-as-text columns.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: pk(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notificationType: text().notNull(),
    channel: text().notNull(),
    enabled: boolean().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("notification_preferences_user_type_channel_idx").on(
      t.userId,
      t.notificationType,
      t.channel,
    ),
    index("notification_preferences_user_idx").on(t.userId),
  ],
);

/**
 * Expo push tokens, one row per device install. Per-USER (not per-scheme):
 * a device belongs to a person, and the notifier fans out to every device a
 * recipient has registered. The token itself is unique — a shared device that
 * signs into another account re-points the existing row at the new user
 * (upsert on token), so a stale account can never keep receiving pushes.
 * Rows are pruned when Expo reports DeviceNotRegistered or on sign-out.
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: pk(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Expo push token, e.g. "ExponentPushToken[…]" — one per device install. */
    token: text().notNull().unique(),
    /** ios | android — validated in the app layer, text like other enums. */
    platform: text().notNull(),
    /** Human device label ("Kim's iPhone") for a future device-management UI. */
    deviceName: text(),
    createdAt: createdAt(),
    /** Bumped on every re-registration — a liveness signal for stale-token sweeps. */
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);

/**
 * Expo ticket ids waiting for their asynchronous delivery receipts. Expo
 * recommends checking receipts about 15 minutes after send; keeping the
 * ticket-to-token mapping here lets a short-lived API process restart without
 * losing the ability to prune a receipt-only DeviceNotRegistered token.
 */
export const pushReceiptTickets = pgTable(
  "push_receipt_tickets",
  {
    /** Expo's opaque push receipt id returned by the send endpoint. */
    receiptId: text().primaryKey(),
    // No FK: a concurrent sign-out/token prune must not abort persistence of
    // every other valid ticket in the same Expo batch.
    token: text().notNull(),
    /** First time the receipt should be requested (normally sent + 15 min). */
    availableAt: timestamp({ withTimezone: true }).notNull(),
    /** Expo clears receipts after 24 hours; stale tickets are discarded then. */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    attempts: integer().notNull().default(0),
    lastCheckedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("push_receipt_tickets_available_idx").on(t.availableAt),
    index("push_receipt_tickets_expires_idx").on(t.expiresAt),
    index("push_receipt_tickets_token_idx").on(t.token),
  ],
);
