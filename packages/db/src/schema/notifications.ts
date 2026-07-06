import {
  boolean,
  index,
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
    readAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_read_idx").on(t.userId, t.readAt)],
);

/**
 * Per-user notification preferences, keyed (userId, notificationType, channel).
 * Sparse: a row exists only when the user's choice differs from the default —
 * an absent row means "use NOTIFICATION_DEFAULTS[type][channel]". This makes the
 * non-regression rule automatic: a fresh user has zero rows and gets every
 * default, and no channel that fires today can be silenced by accident.
 *
 * `notificationType` ∈ NOTIFICATION_TYPES (the notifier event types) and
 * `channel` ∈ "in_app" | "email" | "sms" — validated in the app layer, stored
 * as text to stay in step with the other enum-as-text columns.
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
